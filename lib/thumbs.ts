import "server-only";

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { db } from "./db";
import { notifyJobs } from "./job-events";

/**
 * Downscaled artwork, cached on the internal disk.
 *
 * The library's artwork lives beside the films on an external drive, so before
 * this every grid tile was a full-resolution poster read off a spinning disk —
 * and with the drive unplugged, off nothing at all. A thumbnail generated once
 * and kept under `data/` makes the shelf fast from then on, and keeps showing
 * *your* chosen artwork when the drive is away rather than falling back to
 * whatever TMDb serves.
 *
 * The cache key is the source path hashed, the width, and the source file's
 * mtime — replace a poster and the next request regenerates; the stale
 * versions for that path and width are removed as the new one lands. Nothing
 * here is precious: the whole directory can be deleted and it refills itself.
 */

/**
 * Never hold the drive open.
 *
 * libvips reads a source image by memory-mapping it, and its operation cache
 * keeps that mapping alive after the call returns — a mapped file counts as in
 * use, so macOS refuses to eject the drive it lives on. The cache is a plain
 * LRU with no expiry: entries leave only when later work pushes them out, or
 * when the process ends. An idle server is therefore the worst case, and the
 * rebuild below is the very worst of it — the last posters it touches have
 * nothing behind them to do the pushing, so they stay mapped indefinitely.
 * That is the button you press *before* unplugging the drive.
 *
 * Turning it off costs nothing worth having. Every job here is a distinct
 * source × width, so there is little for an operation cache to hit, and each
 * result is already kept as a file — the second ask for a thumbnail never
 * reaches sharp at all. Measured over a rebuild-shaped run, on and off are
 * indistinguishable inside the run-to-run noise.
 */
sharp.cache(false);

/**
 * The widths that may be asked for, so a malformed query cannot fill the
 * cache with one file per pixel. Chosen at roughly 2× the largest size each
 * bucket is drawn at, which is what a retina screen actually samples.
 */
export const THUMB_WIDTHS = new Set([160, 640, 1280]);

const CACHE_DIR = path.join(process.cwd(), "data", "thumbs");
mkdirSync(CACHE_DIR, { recursive: true });

const hashOf = (filePath: string) =>
  createHash("sha1").update(filePath).digest("hex");

/** One thumb per source × width; the mtime in the name is the freshness. */
const cacheName = (hash: string, width: number, mtimeMs: number) =>
  `${hash}-w${width}-${Math.floor(mtimeMs)}.webp`;

/**
 * The cached thumbnail for a source image, generating it on first ask.
 *
 * Returns the path of a file that is current with the source — or, when the
 * source cannot be read at all (the drive is unplugged), whatever cached copy
 * exists from when it could. `null` means there is nothing to serve and the
 * caller should fall back to the original.
 */
export async function getThumb(
  source: string,
  width: number,
): Promise<string | null> {
  const hash = hashOf(source);
  const prefix = `${hash}-w${width}-`;

  let mtimeMs: number;
  try {
    mtimeMs = (await stat(source)).mtimeMs;
  } catch {
    // The drive is not there. A stale thumb of your own artwork beats the
    // remote fallback, and far beats an empty frame.
    return findExisting(prefix);
  }

  const target = path.join(CACHE_DIR, cacheName(hash, width, mtimeMs));
  try {
    await stat(target);
    return target;
  } catch {
    // Not cached yet — fall through to generate.
  }

  try {
    // Written beside its final name and renamed into place, so a request that
    // arrives mid-write never reads half an image. `rotate()` bakes in any
    // EXIF orientation, which the <img> tag would otherwise apply twice.
    const tmp = `${target}.${process.pid}.tmp`;
    await sharp(source)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(tmp);
    await rename(tmp, target);
  } catch {
    // Unreadable or unsupported image — let the caller serve the original.
    return null;
  }

  // The poster changed, so every thumb made from its previous versions is
  // now unreachable by name. Swept here, where the replacement just landed.
  void sweepStale(prefix, path.basename(target));

  return target;
}

/** Any cached thumb for this source and width, freshness unknown. */
async function findExisting(prefix: string): Promise<string | null> {
  try {
    const entries = await readdir(CACHE_DIR);
    const hit = entries.find((name) => name.startsWith(prefix));
    return hit ? path.join(CACHE_DIR, hit) : null;
  } catch {
    return null;
  }
}

async function sweepStale(prefix: string, keep: string): Promise<void> {
  try {
    const entries = await readdir(CACHE_DIR);
    await Promise.all(
      entries
        .filter((name) => name.startsWith(prefix) && name !== keep)
        .map((name) => unlink(path.join(CACHE_DIR, name)).catch(() => {})),
    );
  } catch {
    // A missed sweep costs disk, not correctness.
  }
}

// ---------------------------------------------------------------------------
// Cache management, for the Settings page
// ---------------------------------------------------------------------------

/** What the cache is currently holding, for the setting to report. */
export async function thumbCacheStats(): Promise<{
  files: number;
  bytes: number;
}> {
  try {
    const entries = await readdir(CACHE_DIR);
    let bytes = 0;
    for (const name of entries) {
      try {
        bytes += (await stat(path.join(CACHE_DIR, name))).size;
      } catch {
        // Swept between readdir and stat — count what remains.
      }
    }
    return { files: entries.length, bytes };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

/**
 * Empties the cache. Purely reclamation: everything here is derived, and the
 * next browse regenerates whatever is still looked at — which is also what
 * makes this the cure for a cache grown fat with thumbs of films since
 * deleted or re-organised, whose keys nothing will ever ask for again.
 */
export async function clearThumbCache(): Promise<{
  files: number;
  bytes: number;
}> {
  const removed = await thumbCacheStats();
  try {
    const entries = await readdir(CACHE_DIR);
    await Promise.all(
      entries.map((name) =>
        unlink(path.join(CACHE_DIR, name)).catch(() => {}),
      ),
    );
  } catch {
    // Nothing to clear.
  }
  return removed;
}

/** A spinning drive thrashes under parallel reads, exactly as in the scan. */
const REBUILD_CONCURRENCY = 3;

/**
 * The rebuild, as a job the rail can draw.
 *
 * It reads every poster in the library off the external drive, which on a
 * spinning disk is minutes rather than seconds — long enough that running it
 * silently behind a button that says "Rebuilding…" left no way to tell a slow
 * pass from a stuck one, and no way to stop it. Counted in thumbnails rather
 * than posters, because that is the unit of work: three widths each.
 */
export type ThumbJob = {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  total: number;
  done: number;
  /** Thumbnails now on disk, and sources sharp could not read. */
  ready: number;
  failed: number;
  /** The folder being read — a film or show name, not `poster.jpeg`. */
  current?: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
};

const IDLE_JOB: ThumbJob = {
  status: "idle",
  total: 0,
  done: 0,
  ready: 0,
  failed: 0,
};

/** On globalThis so a dev-reload mid-rebuild keeps reporting; see scanner.ts. */
const globalForThumbs = globalThis as unknown as {
  medlibThumbs?: ThumbJob;
  medlibThumbsCancel?: boolean;
};

const currentJob = (): ThumbJob => globalForThumbs.medlibThumbs ?? IDLE_JOB;

function setJob(next: ThumbJob) {
  globalForThumbs.medlibThumbs = next;
  notifyJobs();
}

export function getThumbJob(): ThumbJob {
  return currentJob();
}

/**
 * Generates every thumbnail the app could ask for, ahead of being asked.
 *
 * The cache fills lazily as shelves are browsed, which is fine until the
 * drive is about to be unplugged — a shelf never visited has no thumbs to
 * survive on. This walks every poster the library knows at every width the
 * app draws, so the whole grid works offline afterwards. Posters only:
 * backdrops and logos are drawn at full resolution, which is the drive's to
 * give.
 *
 * Returns as soon as the work is under way; the job stream carries the rest.
 */
export function startThumbRebuild(): ThumbJob {
  if (currentJob().status === "running") return currentJob();

  globalForThumbs.medlibThumbsCancel = false;
  setJob({ ...IDLE_JOB, status: "running", startedAt: Date.now() });

  // Not awaited: the caller returns at once and the job stream reports.
  void (async () => {
    try {
      const rows = db
        .prepare("SELECT poster FROM artwork WHERE poster IS NOT NULL")
        .all() as { poster: string }[];

      const jobs = rows.flatMap((row) =>
        [...THUMB_WIDTHS].map((width) => ({ source: row.poster, width })),
      );

      setJob({ ...currentJob(), total: jobs.length });

      let cursor = 0;

      async function worker() {
        while (cursor < jobs.length) {
          if (globalForThumbs.medlibThumbsCancel) return;

          const job = jobs[cursor++];
          // The folder, not the file: every source here is called
          // `poster.jpeg`, so the name of the film is the only useful label.
          setJob({
            ...currentJob(),
            current: path.basename(path.dirname(job.source)),
          });

          const made = await getThumb(job.source, job.width);
          setJob({
            ...currentJob(),
            done: currentJob().done + 1,
            ready: currentJob().ready + (made ? 1 : 0),
            failed: currentJob().failed + (made ? 0 : 1),
          });
        }
      }

      await Promise.all(
        Array.from(
          { length: Math.min(REBUILD_CONCURRENCY, jobs.length) },
          worker,
        ),
      );

      // Cancelling stops the workers taking new jobs, so this is reached
      // either way — what is already on disk stays, and a later run picks up
      // from there rather than starting over.
      setJob({
        ...currentJob(),
        status: globalForThumbs.medlibThumbsCancel ? "cancelled" : "done",
        current: undefined,
        finishedAt: Date.now(),
      });
    } catch (err) {
      setJob({
        ...currentJob(),
        status: "error",
        current: undefined,
        error: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      });
    }
  })();

  return currentJob();
}

export function cancelThumbRebuild(): ThumbJob {
  if (currentJob().status !== "running") return currentJob();
  globalForThumbs.medlibThumbsCancel = true;
  return currentJob();
}
