import "server-only";

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { findArtwork, type Artwork } from "./artwork";
import { db } from "./db";
import { deriveAll } from "./library";
import { probe, VIDEO_EXTENSIONS } from "./media";

export type ScanState = {
  status: "idle" | "scanning" | "done" | "error";
  root?: string;
  discovered: number;
  probed: number;
  cached: number;
  failed: number;
  current?: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
};

const IDLE: ScanState = { status: "idle", discovered: 0, probed: 0, cached: 0, failed: 0 };

// Survives HMR so a save mid-scan doesn't orphan the running scan's progress.
const globalForScan = globalThis as unknown as { medlibScan?: ScanState };
let state: ScanState = globalForScan.medlibScan ?? IDLE;

function setState(next: ScanState) {
  state = next;
  globalForScan.medlibScan = next;
}

export function getScanState(): ScanState {
  return state;
}

/** Windows/NAS bookkeeping folders that appear on exFAT and NTFS drives. */
const SKIP_DIRS = new Set([
  "System Volume Information",
  "$RECYCLE.BIN",
  "@eaDir",
  "lost+found",
]);

const SAMPLE_OR_TRAILER = /(^|[.\s_-])(sample|trailer|featurette|extras?)([.\s_-]|$)/i;

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
    if (!VIDEO_EXTENSIONS.has(path.extname(dirent.name).toLowerCase())) continue;
    if (SAMPLE_OR_TRAILER.test(path.parse(dirent.name).name)) continue;

    try {
      const stats = await stat(full);
      yield { path: full, size: stats.size, mtimeMs: Math.floor(stats.mtimeMs) };
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
      error = excluded.error
  `);

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

async function probeAll(files: FoundFile[]) {
  const cachedStmt = selectCached();
  const upsertStmt = upsertProbe();

  let cursor = 0;

  async function worker() {
    while (cursor < files.length) {
      const file = files[cursor++];

      const existing = cachedStmt.get(file.path) as
        | { size: number; mtime_ms: number }
        | undefined;

      if (existing && existing.size === file.size && existing.mtime_ms === file.mtimeMs) {
        setState({ ...state, cached: state.cached + 1 });
        continue;
      }

      setState({ ...state, current: file.path });
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
          ? { ...state, failed: state.failed + 1 }
          : { ...state, probed: state.probed + 1 },
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker),
  );
}

export function startScan(root: string): ScanState {
  if (state.status === "scanning") return state;

  setState({
    status: "scanning",
    root,
    discovered: 0,
    probed: 0,
    cached: 0,
    failed: 0,
    startedAt: Date.now(),
  });

  // Deliberately not awaited: the caller returns immediately and the UI polls.
  void (async () => {
    try {
      const files: FoundFile[] = [];
      for await (const file of walk(root)) {
        files.push(file);
        setState({ ...state, discovered: files.length });
      }

      await probeAll(files);
      await indexArtwork(files);
      deriveAll();

      setState({ ...state, status: "done", current: undefined, finishedAt: Date.now() });
    } catch (err) {
      setState({
        ...state,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      });
    }
  })();

  return state;
}
