import "server-only";

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { DATA_DIR } from "./data-dir";
import { db } from "./db";
import { notifyJobs } from "./job-events";
import { ended, recordRun } from "./job-history";

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
 * One libvips thread per resize, rather than one per core per resize.
 *
 * Sharp's default gives every operation as many threads as the machine has
 * cores, which is right when operations arrive one at a time. They do not here
 * — a cold shelf asks for a hundred at once, and the gate below still lets
 * three run together — so the default would put two dozen compute threads on
 * an eight-core machine and spend the difference on contention. Held at one
 * each, how many run at once is the gate's to say, and this is the unit it
 * deals in.
 */
sharp.concurrency(1);

/**
 * The widths that may be asked for, so a malformed query cannot fill the
 * cache with one file per pixel. Chosen at roughly 2× the largest size each
 * bucket is drawn at, which is what a retina screen actually samples.
 *
 * 1920 is the hero's, and it is the one that is a cap rather than a doubling.
 * Backdrops and logos were served whole for a long time on the reasoning that
 * full resolution is the drive's to give — true, and it made every detail page
 * a page that could not be drawn without the drive awake. What it was giving
 * was a 2880×1773 backdrop behind a gradient and a 2561px title treatment
 * drawn at 384: about a megabyte each on the wire and thirty-four megabytes of
 * decoded bitmap in the browser, for a picture nobody inspects at native size.
 */
export const THUMB_WIDTHS = new Set([160, 640, 1280, 1920]);

const CACHE_DIR = path.join(DATA_DIR, "thumbs");
mkdirSync(CACHE_DIR, { recursive: true });

const hashOf = (filePath: string) =>
  createHash("sha1").update(filePath).digest("hex");

/**
 * One thumb per source × width, with a freshness stamp in the name.
 *
 * Two kinds of stamp, and which one is used decides whether serving a poster
 * touches the external drive at all.
 *
 * `v` is the artwork row's `found_at` — when the folder was last read — and it
 * arrives on the request as `?v=`, because it is already what tells a browser
 * its copy of `poster.jpeg` is a different picture now. The app has it in hand
 * before it looks at anything, so a thumbnail already made under that stamp is
 * served off the internal disk without the drive being consulted.
 *
 * `m` is the source file's own mtime, for a request that carries no version.
 * It is correct and it is expensive: the mtime can only be had by asking the
 * drive, which is the whole problem — see `getThumb`.
 *
 * Prefixed so the two cannot be confused for one another. Both are epoch
 * milliseconds and a bare number could plausibly be either, which would mean
 * serving a thumbnail that is current by one reckoning and stale by the other.
 */
const cacheName = (
  hash: string,
  width: number,
  stamp: { kind: "v" | "m"; at: number },
) => `${hash}-w${width}-${stamp.kind}${Math.floor(stamp.at)}.webp`;

/**
 * How many thumbnails may be made at once, however many are asked for.
 *
 * Making one is a full-size decode of a file on the external drive, and a
 * shelf that has never been browsed asks for a hundred in the same breath.
 * Unthrottled, all hundred start: they contend for libvips threads, and — the
 * part that is easy to miss — they occupy libuv's file thread pool, which is
 * four threads and is the same pool every other read in the process waits on.
 * The page you asked for is then slow because of its own pictures, and the
 * page you ask for next is slow because of the page before it.
 *
 * Three, the number the rebuild pass had already settled on, and now the same
 * three: both routes generate through this gate, so a rebuild running while
 * you browse cannot put twice the load on one drive.
 */
const GENERATE_CONCURRENCY = 3;

type ThumbGate = {
  /** Generations under way, by the file each is making. */
  inFlight: Map<string, Promise<string | null>>;
  active: number;
  waiting: (() => void)[];
};

/** On globalThis for the reason the job is: this module can exist twice. */
const globalForGate = globalThis as unknown as { medlibThumbGate?: ThumbGate };

const gate = (): ThumbGate =>
  (globalForGate.medlibThumbGate ??= {
    inFlight: new Map(),
    active: 0,
    waiting: [],
  });

/**
 * Runs `work` when there is room, and hands its place straight to whoever is
 * next rather than releasing it into the open. Released, a caller arriving in
 * the same tick could take the slot ahead of something already queued — which
 * is how a limit of three becomes a limit of three most of the time.
 */
async function admitted<T>(work: () => Promise<T>): Promise<T> {
  const g = gate();
  if (g.active >= GENERATE_CONCURRENCY) {
    await new Promise<void>((go) => g.waiting.push(go));
  } else {
    g.active += 1;
  }

  try {
    return await work();
  } finally {
    const next = g.waiting.shift();
    if (next) next();
    else g.active -= 1;
  }
}

/**
 * Makes one thumbnail, and makes it once.
 *
 * A page draws the same poster in two places often enough to matter, and a
 * browser asks for both in the same moment. Without this, each ask is its own
 * decode of the same file, writing the same bytes to the same path — work
 * doubled to produce a file that already had an author.
 */
function generate(
  source: string,
  width: number,
  target: string,
  prefix: string,
): Promise<string | null> {
  const g = gate();
  const already = g.inFlight.get(target);
  if (already) return already;

  const work = admitted(() => encode(source, width, target, prefix)).finally(
    () => {
      g.inFlight.delete(target);
    },
  );
  g.inFlight.set(target, work);
  return work;
}

/** The encode itself, once the gate has said when. */
async function encode(
  source: string,
  width: number,
  target: string,
  prefix: string,
): Promise<string | null> {
  try {
    // Written beside its final name and renamed into place, so a request that
    // arrives mid-write never reads half an image. `rotate()` bakes in any
    // EXIF orientation, which the <img> tag would otherwise apply twice.
    const tmp = `${target}.${process.pid}.tmp`;
    const image = sharp(source).rotate();

    /*
     * A logo is a cut-out, and it is read as an edge rather than as a picture.
     * Lossy compression puts its error where the contrast is, which on a title
     * treatment is the whole of the lettering — so the one kind of artwork
     * with transparency in it is also the one where 82 shows. Costs nothing on
     * a backdrop, which has no alpha and never takes this branch.
     */
    const { hasAlpha } = await image.metadata();

    await image
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: hasAlpha ? 92 : 82 })
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

/**
 * The cached thumbnail for a source image, generating it on first ask.
 *
 * Returns the path of a file that is current with the source — or, when the
 * source cannot be read at all (the drive is unplugged), whatever cached copy
 * exists from when it could. `null` means there is nothing to serve and the
 * caller should fall back to the original.
 *
 * `version` is what keeps a hit off the drive, and it is the point of the
 * whole arrangement. Without it this had to stat the original before it could
 * so much as name the file it wanted, because the mtime it stats for is half
 * of that name — so every poster on a shelf woke a sleeping disk to be told
 * something the internal disk already knew.
 *
 * That is not a slow request; it is a stalled application. macOS spins an idle
 * disk down after ten minutes, a shelf asks for a hundred images at once, and
 * `stat` runs on libuv's thread pool — four threads by default. A hundred
 * blocked stats behind four threads is every other file operation in the
 * process queued behind a drive that is still getting up to speed, page
 * navigations included. The server is doing nothing and answering nothing.
 *
 * So a request that knows its version asks the internal disk first and stops
 * there when the answer is yes. The drive is touched only to make a thumbnail
 * that does not exist yet, which is work that has to read the original anyway.
 */
export async function getThumb(
  source: string,
  width: number,
  /**
   * The artwork row's `found_at`, from the request's own `?v=`. Absent for a
   * caller that does not know it, which falls back to the mtime and pays the
   * drive for it.
   */
  version?: number,
): Promise<string | null> {
  const hash = hashOf(source);
  const prefix = `${hash}-w${width}-`;

  // The fast path, and the common one: a shelf being browsed a second time,
  // a library that no scan has touched since. Nothing below here runs.
  if (version) {
    const versioned = path.join(
      CACHE_DIR,
      cacheName(hash, width, { kind: "v", at: version }),
    );
    try {
      await stat(versioned);
      return versioned;
    } catch {
      // Not made yet, or made before this folder was last read. Either way the
      // original has to be opened, so the drive is unavoidable from here.
    }
  }

  let mtimeMs: number;
  try {
    mtimeMs = (await stat(source)).mtimeMs;
  } catch {
    // The drive is not there. A stale thumb of your own artwork beats the
    // remote fallback, and far beats an empty frame.
    return findExisting(prefix);
  }

  const stamp = version
    ? ({ kind: "v", at: version } as const)
    : ({ kind: "m", at: mtimeMs } as const);

  const target = path.join(CACHE_DIR, cacheName(hash, width, stamp));
  try {
    await stat(target);
    return target;
  } catch {
    // Not cached yet — fall through to generate.
  }

  return generate(source, width, target, prefix);
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
  const was = currentJob();
  globalForThumbs.medlibThumbs = next;

  if (was.status === "running" && ended(next.status)) {
    recordRun({
      kind: "thumbs",
      title: "Thumbnail rebuild",
      outcome: next.status,
      startedAt: next.startedAt,
      finishedAt: next.finishedAt ?? Date.now(),
      detail:
        next.error ||
        [
          `${next.ready} made`,
          next.failed ? `${next.failed} unreadable` : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
    });
  }

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
 * survive on. This walks every image the library knows at every width the app
 * draws it, so the whole thing works offline afterwards.
 *
 * All three kinds, where it used to be posters alone. That was correct while
 * backdrops and logos were served whole and uncached — there was nothing to
 * make — and it meant this pass left the shelves working and every film page
 * behind them blank. A hero is what you see one click after the grid this was
 * run for.
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
      // `found_at` alongside the files, because it is half the name of every
      // thumbnail this makes. Generating under the mtime instead would fill
      // the cache with thumbnails no request ever asks for by name — the pages
      // ask by version — and the pass would look like it worked while leaving
      // the shelves exactly as cold as it found them.
      const rows = db
        .prepare(
          "SELECT poster, fanart, logo, found_at FROM artwork WHERE poster IS NOT NULL OR fanart IS NOT NULL OR logo IS NOT NULL",
        )
        .all() as {
        poster: string | null;
        fanart: string | null;
        logo: string | null;
        found_at: number;
      }[];

      /*
       * Each kind at the widths it is actually asked for, rather than every
       * kind at every width. A backdrop has no tile to be drawn in and a
       * poster has no hero, so generating the cross product would triple the
       * pass and the cache to make files nothing will ever request.
       */
      const POSTER_WIDTHS = [160, 640, 1280];
      const BACKDROP_WIDTHS = [1920];
      // A logo is drawn at 384 across beside a backdrop that fills the window;
      // see `thumb` in app/art.tsx for why the two part company here.
      const LOGO_WIDTHS = [1280];

      const jobs = rows.flatMap((row) =>
        (
          [
            [row.poster, POSTER_WIDTHS],
            [row.fanart, BACKDROP_WIDTHS],
            [row.logo, LOGO_WIDTHS],
          ] as const
        ).flatMap(([source, widths]) =>
          source
            ? widths.map((width) => ({
                source,
                width,
                version: row.found_at,
              }))
            : [],
        ),
      );

      setJob({ ...currentJob(), total: jobs.length });

      let cursor = 0;

      async function worker() {
        while (cursor < jobs.length) {
          if (globalForThumbs.medlibThumbsCancel) return;

          const job = jobs[cursor++];
          // The folder, not the file: the sources here are called `poster.jpeg`
          // and `fanart.jpeg`, so the name of the film is the only useful
          // label — and naming the file would make the rail count to three per
          // film in words nobody is reading.
          setJob({
            ...currentJob(),
            current: path.basename(path.dirname(job.source)),
          });

          const made = await getThumb(job.source, job.width, job.version);
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
