import "server-only";

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { findArtwork, type Artwork } from "./artwork";
import { db } from "./db";
import { getDoviScans, scanDovi } from "./dovi";
import { recordRun } from "./jobs";
import { runEnrich } from "./enrich";
import { fetchDisc, hasDisc } from "./disc";
import { deriveAll, getLibrary } from "./library";
import { probe, VIDEO_EXTENSIONS } from "./media";
import { hasCredentials } from "./tmdb";

export type ScanState = {
  /** "matching" is the TMDb phase that runs automatically after probing. */
  status:
    | "idle"
    | "scanning"
    | "dovi"
    | "matching"
    | "discs"
    | "done"
    | "error";
  root?: string;
  discovered: number;
  probed: number;
  cached: number;
  failed: number;
  current?: string;
  /** TMDb phase counters, filled once probing finishes. */
  matchTotal: number;
  matchDone: number;
  matched: number;
  needsReview: number;
  /** Files that vanished from disk since the last scan. */
  removed: number;
  /** Dolby Vision RPU head scans, one per DV film we have not read yet. */
  doviTotal: number;
  doviDone: number;
  /** Blu-ray.com lookups, the final phase. */
  discTotal: number;
  discDone: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
};

const IDLE: ScanState = {
  status: "idle",
  discovered: 0,
  probed: 0,
  cached: 0,
  failed: 0,
  matchTotal: 0,
  matchDone: 0,
  matched: 0,
  needsReview: 0,
  removed: 0,
  doviTotal: 0,
  doviDone: 0,
  discTotal: 0,
  discDone: 0,
};

/**
 * Read from globalThis every time rather than kept in a module-local variable.
 * A save mid-scan replaces this module while the scan is still running, and a
 * local copy would be frozen at whatever the progress was when that happened.
 */
const globalForScan = globalThis as unknown as { medlibScan?: ScanState };

const current = (): ScanState => globalForScan.medlibScan ?? IDLE;

function setState(next: ScanState) {
  globalForScan.medlibScan = next;
}

export function getScanState(): ScanState {
  return current();
}

/** Windows/NAS bookkeeping folders that appear on exFAT and NTFS drives. */
const SKIP_DIRS = new Set([
  "System Volume Information",
  "$RECYCLE.BIN",
  "@eaDir",
  "lost+found",
]);

const SAMPLE_OR_TRAILER =
  /(^|[.\s_-])(sample|trailer|featurette|extras?)([.\s_-]|$)/i;

export type FoundFile = { path: string; size: number; mtimeMs: number };

async function* walk(dir: string): AsyncGenerator<FoundFile> {
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable folder — skip it rather than abandoning the whole scan.
    return;
  }

  for (const dirent of dirents) {
    // Skips .DS_Store, .Spotlight-V100, and crucially the `._` AppleDouble
    // stubs macOS writes beside every file on exFAT — they are not real media.
    if (dirent.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(dirent.name)) continue;

    const full = path.join(dir, dirent.name);

    if (dirent.isDirectory()) {
      yield* walk(full);
      continue;
    }
    if (!dirent.isFile()) continue;
    if (!VIDEO_EXTENSIONS.has(path.extname(dirent.name).toLowerCase()))
      continue;
    if (SAMPLE_OR_TRAILER.test(path.parse(dirent.name).name)) continue;

    try {
      const stats = await stat(full);
      yield {
        path: full,
        size: stats.size,
        mtimeMs: Math.floor(stats.mtimeMs),
      };
    } catch {
      // Vanished between readdir and stat.
    }
  }
}

const selectCached = () =>
  db.prepare("SELECT size, mtime_ms FROM probes WHERE path = ?");

const upsertProbe = () =>
  db.prepare(`
    INSERT INTO probes (path, size, mtime_ms, probed_at, mediainfo, error)
    VALUES (@path, @size, @mtime_ms, @probed_at, @mediainfo, @error)
    ON CONFLICT(path) DO UPDATE SET
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      probed_at = excluded.probed_at,
      mediainfo = excluded.mediainfo,
      error = excluded.error,
      -- Only reached when size or mtime changed, so the RPU reading stored
      -- against this path describes a file that no longer exists.
      dovi = NULL
  `);

/**
 * Re-reads one file that changed under us — after a conversion rewrites it in
 * place, for instance. The stored RPU reading is dropped with it, since it
 * described the stream that has just been replaced.
 */
export async function reprobeFile(filePath: string): Promise<void> {
  const stats = await stat(filePath);
  const result = await probe(filePath);

  upsertProbe().run({
    path: filePath,
    size: stats.size,
    mtime_ms: Math.floor(stats.mtimeMs),
    probed_at: Date.now(),
    mediainfo: result.mediainfo ? JSON.stringify(result.mediainfo) : null,
    error: result.error ?? null,
  });
}

/** A spinning external drive thrashes under parallel reads; keep this low. */
const CONCURRENCY = 3;

/** Artwork is a directory-level fact, so each folder is only read once. */
async function indexArtwork(files: FoundFile[]) {
  const dirs = [...new Set(files.map((f) => path.dirname(f.path)))];

  const upsert = db.prepare(`
    INSERT INTO artwork (dir, poster, fanart, found_at)
    VALUES (@dir, @poster, @fanart, @found_at)
    ON CONFLICT(dir) DO UPDATE SET
      poster = excluded.poster,
      fanart = excluded.fanart,
      found_at = excluded.found_at
  `);

  const found = await Promise.all(
    dirs.map(async (dir) => ({ dir, ...(await findArtwork(dir)) })),
  );

  const write = db.transaction((rows: (Artwork & { dir: string })[]) => {
    for (const row of rows) {
      upsert.run({
        dir: row.dir,
        poster: row.poster ?? null,
        fanart: row.fanart ?? null,
        found_at: Date.now(),
      });
    }
  });

  write(found);
  return found.filter((f) => f.poster || f.fanart).length;
}

/**
 * Drops rows for files that no longer exist on disk.
 *
 * Without this a deleted film lingers forever: `deriveAll` derives from every
 * probe row and re-stamps `last_seen`, so the `present = 0` fallback never
 * triggers while the stale probe is still there.
 *
 * Scoped to the scanned root, so a folder that is merely unmounted or outside
 * this scan is left untouched. Match rows are deliberately kept — they are
 * keyed by path, cost nothing, and preserve any manual correction should the
 * file come back.
 */
function pruneMissing(root: string, files: FoundFile[]): number {
  const found = new Set(files.map((f) => f.path));
  const prefix = root.endsWith("/") ? root : `${root}/`;

  const stale = (
    db.prepare("SELECT path FROM probes").all() as { path: string }[]
  )
    .map((r) => r.path)
    .filter((p) => p.startsWith(prefix) && !found.has(p));

  if (stale.length === 0) return 0;

  const dropProbe = db.prepare("DELETE FROM probes WHERE path = ?");
  const dropMovie = db.prepare("DELETE FROM movies WHERE path = ?");

  db.transaction((paths: string[]) => {
    for (const p of paths) {
      dropProbe.run(p);
      dropMovie.run(p);
    }
  })(stale);

  return stale.length;
}

async function probeAll(files: FoundFile[]) {
  const cachedStmt = selectCached();
  const upsertStmt = upsertProbe();

  let cursor = 0;

  async function worker() {
    while (cursor < files.length) {
      const file = files[cursor++];

      const existing = cachedStmt.get(file.path) as
        { size: number; mtime_ms: number } | undefined;

      if (
        existing &&
        existing.size === file.size &&
        existing.mtime_ms === file.mtimeMs
      ) {
        setState({ ...current(), cached: current().cached + 1 });
        continue;
      }

      setState({ ...current(), current: file.path });
      const result = await probe(file.path);

      upsertStmt.run({
        path: file.path,
        size: file.size,
        mtime_ms: file.mtimeMs,
        probed_at: Date.now(),
        mediainfo: result.mediainfo ? JSON.stringify(result.mediainfo) : null,
        error: result.error ?? null,
      });

      setState(
        result.error
          ? { ...current(), failed: current().failed + 1 }
          : { ...current(), probed: current().probed + 1 },
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker),
  );
}

export function startScan(roots: string[]): ScanState {
  if (current().status === "scanning") return current();

  setState({
    ...IDLE,
    status: "scanning",
    root: roots[0],
    startedAt: Date.now(),
  });

  // Deliberately not awaited: the caller returns immediately and the UI polls.
  void (async () => {
    try {
      // Every folder into one list: the probe cache is keyed by path, so the
      // scan does not care which root a file came from — only pruning does.
      const files: FoundFile[] = [];
      for (const root of roots) {
        setState({ ...current(), root });
        for await (const file of walk(root)) {
          files.push(file);
          setState({ ...current(), discovered: files.length });
        }
      }

      // Pruned per root against the whole set, so a file is only dropped when
      // the folder it lives under was walked and did not turn it up.
      const removed = roots.reduce(
        (n, root) => n + pruneMissing(root, files),
        0,
      );
      setState({ ...current(), removed });

      await probeAll(files);
      await indexArtwork(files);
      deriveAll();

      // Dolby Vision details MediaInfo cannot see. A head scan reads only the
      // start of the file, so this costs well under a second per film — cheap
      // enough to belong in every scan rather than being a separate chore.
      //
      // Films that failed are skipped on later scans just as failed disc
      // lookups are: the result is stored, error and all. The full pass on the
      // film's own page is how you retry one.
      const alreadyRead = getDoviScans();
      const dolbyVision = getLibrary().filter(
        (m) => m.hdr === "Dolby Vision" && !alreadyRead.has(m.path),
      );

      if (dolbyVision.length > 0) {
        setState({
          ...current(),
          status: "dovi",
          doviTotal: dolbyVision.length,
          doviDone: 0,
          current: undefined,
        });

        let doviDone = 0;
        for (const film of dolbyVision) {
          setState({ ...current(), current: film.title });
          // Never throws — a failure is recorded on the film and the pass
          // carries on to the next one.
          await scanDovi(film.path, { depth: "head" });
          doviDone += 1;
          setState({ ...current(), doviDone });
        }

        // Fold the RPU readings into the stored rows.
        deriveAll();
      }

      // Matching is part of a scan, not a separate job. Without a token it is
      // simply skipped — the scan still completes normally.
      if (hasCredentials()) {
        setState({ ...current(), status: "matching", current: undefined });

        const summary = await runEnrich(getLibrary(), {
          onProgress: (p) =>
            setState({
              ...current(),
              matchTotal: p.total,
              matchDone: p.done,
              matched: p.matched,
              needsReview: p.needsReview,
              current: p.current,
            }),
        });

        // Re-derive so the new TMDb facts reach the stored rows.
        deriveAll();
        setState({
          ...current(),
          matchTotal: summary.total,
          matchDone: summary.done,
          matched: summary.matched,
          needsReview: summary.needsReview,
        });

        // Disc lookups need a TMDb match to know what to search for, so this
        // runs last. Results are cached permanently, which is what keeps a
        // repeat scan from hammering someone else's server.
        const films = getLibrary().filter((m) => m.tmdb?.id);
        const pending = films.filter((m) => !hasDisc(m.tmdb!.id));

        setState({
          ...current(),
          status: "discs",
          discTotal: pending.length,
          discDone: 0,
          current: undefined,
        });

        let done = 0;
        for (const film of pending) {
          setState({ ...current(), current: film.title });
          try {
            await fetchDisc(film.tmdb!.id, film.tmdb!.title, film.tmdb!.year);
          } catch {
            // A single failed lookup should not end the scan.
          }
          done += 1;
          setState({ ...current(), discDone: done });
        }

        if (pending.length > 0) deriveAll();
      }

      recordRun({
        kind: "scan",
        label: roots.length === 1 ? roots[0] : `${roots.length} folders`,
        startedAt: current().startedAt ?? Date.now(),
        finishedAt: Date.now(),
        status: "done",
        detail: [
          `${current().probed} probed`,
          `${current().cached} unchanged`,
          ...(current().removed ? [`${current().removed} removed`] : []),
          ...(current().failed ? [`${current().failed} failed`] : []),
          ...(current().doviTotal ? [`${current().doviTotal} DV streams read`] : []),
        ].join(" · "),
      });

      setState({
        ...current(),
        status: "done",
        current: undefined,
        finishedAt: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordRun({
        kind: "scan",
        label: roots.length === 1 ? roots[0] : `${roots.length} folders`,
        startedAt: current().startedAt ?? Date.now(),
        finishedAt: Date.now(),
        status: "error",
        detail: message,
      });
      setState({
        ...current(),
        status: "error",
        error: message,
        finishedAt: Date.now(),
      });
    }
  })();

  return current();
}
