import "server-only";

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { findArtwork, type Artwork } from "./artwork";
import { downloadMissingArtwork } from "./auto-artwork";
import { db } from "./db";
import { driveName, volumeOf } from "./drive";
import { hasJackett } from "./jackett";
import { notifyJobs } from "./job-events";
import { startSweep } from "./upgrade-sweep";
import { searchWishlist } from "./wishlist-search";
import { pruneOwnedWishes } from "./wishlist";
import { getDoviScans, scanDovi } from "./dovi";
import { getShows, seasonYear } from "./shows";
import { enrichShow } from "./tv";
import { runEnrich } from "./enrich";
import { fetchDisc, hasDisc } from "./disc";
import { fetchSeasonDisc, hasSeasonDisc } from "./tv-disc";
import { deriveAll, getLibrary, getMovies } from "./library";
import { probe, VIDEO_EXTENSIONS } from "./media";
import { hasCredentials } from "./tmdb";

export type ScanState = {
  /** "matching" is the TMDb phase that runs automatically after probing. */
  status:
    | "idle"
    | "scanning"
    | "dovi"
    | "matching"
    | "artwork"
    | "discs"
    | "wishlist"
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
  /** Roots that could not be read — an unplugged drive, most likely. */
  skipped?: string[];
  /** Dolby Vision RPU head scans, one per DV film we have not read yet. */
  doviTotal: number;
  doviDone: number;
  /** Artwork gaps being filled from TMDb — entries, not individual images. */
  artTotal: number;
  artDone: number;
  /** Images actually downloaded, for the summary line. */
  artSaved: number;
  /** Blu-ray.com lookups. */
  discTotal: number;
  discDone: number;
  /** Indexer searches for the films on the wishlist — the final phase. */
  wishTotal: number;
  wishDone: number;
  /** Wants something was actually found for, for the summary line. */
  wishFound: number;
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
  artTotal: 0,
  artDone: 0,
  artSaved: 0,
  discTotal: 0,
  discDone: 0,
  wishTotal: 0,
  wishDone: 0,
  wishFound: 0,
};

/**
 * Read from globalThis every time rather than kept in a module-local variable.
 * A save mid-scan replaces this module while the scan is still running, and a
 * local copy would be frozen at whatever the progress was when that happened.
 */
const globalForScan = globalThis as unknown as {
  medlibScan?: ScanState;
  /** The timer set by `watchForRoots`; on globalThis for the reason above. */
  medlibRootWatch?: ReturnType<typeof setInterval>;
};

/**
 * Laid over `IDLE` rather than returned bare, so a counter added to this type
 * is zero on a state written before it existed.
 *
 * The state outlives the code: it sits on globalThis precisely so a save
 * mid-scan does not lose it, which means a reload can hand the new build an
 * object shaped by the old one. Reading `wishDone` off such a state gave
 * `undefined`, and the rail formats its counters without asking — one added
 * field took the whole layout down with it.
 */
const current = (): ScanState => ({ ...IDLE, ...globalForScan.medlibScan });

function setState(next: ScanState) {
  globalForScan.medlibScan = next;
  notifyJobs();
}

export function getScanState(): ScanState {
  return current();
}

/**
 * Every status a scan passes through, which is what "a scan is running" means.
 *
 * Not `status === "scanning"` alone. That is the walk and the probing — the
 * first minute of a pass that then spends an hour reading RPUs, matching
 * against TMDb, fetching artwork, looking up discs and searching for wants,
 * each under a status of its own. A guard naming only the first phase read
 * every one of those as "nothing is running", which is how a second scan came
 * to be started on top of a first, and a third on top of that: each one
 * holding its own file list, its own derive and its own requests in flight.
 *
 * The same list the rail draws from — see `BUSY` in app/scan-provider.tsx,
 * which cannot share this one: that file is a client component and this module
 * is server-only.
 */
const WORKING: ScanState["status"][] = [
  "scanning",
  "dovi",
  "matching",
  "artwork",
  "discs",
  "wishlist",
];

/** Whether a scan is under way, in any of its phases. */
const working = (): boolean => WORKING.includes(current().status);

/**
 * The same question, for callers outside this module — the actions layer asks
 * it before offering anything that would end in a restart.
 */
export function scanBusy(): boolean {
  return working();
}

/** Windows/NAS bookkeeping folders that appear on exFAT and NTFS drives. */
const SKIP_DIRS = new Set([
  "System Volume Information",
  "$RECYCLE.BIN",
  "@eaDir",
  "lost+found",
]);

/** "Season 2", "S02" — a folder that names a season rather than a show. */
const SEASON_DIR = /^(?:season[\s._-]*|s)(\d{1,2})$/i;

const SAMPLE_OR_TRAILER =
  /(^|[.\s_-])(sample|trailer|featurette|extras?)([.\s_-]|$)/i;

export type FoundFile = { path: string; size: number; mtimeMs: number };

/**
 * Whether a root is there to be walked.
 *
 * The difference between "this folder is empty" and "this folder is not
 * mounted" is the difference between pruning nothing and pruning everything,
 * and `readdir` reports both as a failure to produce files.
 */
async function reachable(root: string): Promise<boolean> {
  return (await whyUnreachable(root)) === null;
}

/**
 * Why a root cannot be walked, or null when it can.
 *
 * The reason used to be thrown away and every failure called "not reachable",
 * which is the same phrase for a drive sitting on a desk unplugged and for one
 * plugged in that this process is not allowed to read. Those are opposite
 * problems — wait for the first, grant permission for the second — and a
 * person reading "not reachable" about a drive they can see mounted has been
 * told the one thing they already know.
 */
async function whyUnreachable(root: string): Promise<string | null> {
  try {
    return (await stat(root)).isDirectory() ? null : "not a folder";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "not plugged in";
    if (code === "EACCES" || code === "EPERM") return "permission refused";
    return code ? `unreadable (${code})` : "unreadable";
  }
}

/**
 * One unreachable root as a sentence about a drive.
 *
 * `whyUnreachable` answers in the app's own shorthand, and the pair was
 * reported as it stood: "/Volumes/Expansion/Movies (not plugged in)". Every
 * word of that is true and none of it is addressed to a person — a path they
 * did not type, a reason in brackets, and the one word that would tell them
 * what to do buried at the end of both. What they have in front of them is a
 * drive with a name on it, so that is what this says.
 *
 * The whole path is still there to be had: it is what the rail shows while the
 * scan runs, and what the folder list in Settings is made of.
 */
function unreachableSentence({
  root,
  why,
}: {
  root: string;
  why: string;
}): string {
  // A drive is named as itself, because that is what is written on the thing
  // you plug in. Anything else — a bind mount inside the container, a folder
  // on the internal disk — is named as a folder, or "movies is not plugged in"
  // would be said about a directory nobody can plug in or out of.
  const volume = volumeOf(root);
  const it = volume ? volume.name : `the folder ${driveName(root)}`;
  // The same words at the head of a sentence. A drive's name is already
  // capitalised by whoever formatted it; "the folder" is not.
  const opens = it[0].toUpperCase() + it.slice(1);

  if (why === "not plugged in")
    return volume ? `${opens} is not plugged in` : `${opens} is not there`;
  if (why === "permission refused")
    return `RipGrade is not allowed to read ${it}`;
  if (why === "readable but empty")
    return `${opens} is there, but nothing is on it`;
  if (why === "not a folder") return `${opens} is not a folder`;
  return `${opens} could not be read`;
}

/**
 * Whether a root would actually give a scan something, which is the question
 * the watcher has to ask and `reachable` cannot answer.
 *
 * A root reaches the missing list for two different reasons: the drive is not
 * there, or the drive is there and yields nothing — `readable but empty`,
 * which is a folder that stats as a directory and walks to no files. A drive
 * ejected and re-mounted by macOS under another name leaves exactly that
 * behind, and so does one that is spun down or erroring on read.
 *
 * Asked with a stat, the second kind answers "I am back" the instant it is
 * asked, every time. The watcher started a scan, the scan found the folder as
 * empty as before and re-armed the watcher on its way out, and twenty seconds
 * later the whole thing happened again — a full pass over the library every
 * twenty seconds for as long as the process lived, each begun on top of the
 * last, until the machine gave out.
 *
 * So recovery is tested the way the scan itself tests it: can this be read,
 * and is there a film under it. Asked of the first file rather than all of
 * them — a populated drive answers on the first folder it opens, and an empty
 * one has nothing to walk.
 */
async function answers(root: string): Promise<boolean> {
  if (!(await reachable(root))) return false;
  return (await walk(root).next()).done !== true;
}

/** How often the watcher below looks, and how long it keeps looking. */
const WATCH_EVERY_MS = 20_000;
const WATCH_FOR_MS = 30 * 60_000;

/**
 * Waits for a missing drive to turn up, and scans when it does.
 *
 * The scan on start-up races the drive and loses more often than not: the
 * server is up seconds after login, an external disk mounts when it is ready,
 * and the scan in between fails in under a fifth of a second having walked
 * nothing. That failure then stood for the lifetime of the process — the state
 * lives on globalThis, nothing re-ran it, and every page load since re-read
 * the same frozen error and drew it. The drive had been plugged in the whole
 * time; the app had simply asked once, at the only moment the answer was no.
 *
 * So the failure arms this: the roots that were missing are looked at again
 * every so often, and the first time one of them answers, the scan is run for
 * real. Bounded, because a folder that is gone for good is not worth a timer
 * until the process ends — after that the button in Settings is the way back.
 * Unreferenced, so a pending look never holds the process open by itself.
 */
function watchForRoots(missing: string[], roots: string[]): void {
  if (globalForScan.medlibRootWatch || missing.length === 0) return;

  let waited = 0;
  const timer = setInterval(async () => {
    waited += WATCH_EVERY_MS;

    // Aged out first, and unconditionally. Checked after the two returns below
    // it, a scan that never ends — or a folder that answers only sometimes —
    // kept the timer alive past the limit it was given, which is the one thing
    // a bounded watcher must not do.
    if (waited >= WATCH_FOR_MS) return stopWatchingRoots();

    // A scan already under way will report on these roots itself, and arms
    // this again on its way out if any of them are still missing. Every phase
    // of one counts — see `working`.
    if (working()) return;

    const back: boolean[] = await Promise.all(missing.map(answers));
    if (back.some(Boolean)) {
      stopWatchingRoots();
      startScan(roots);
    }
  }, WATCH_EVERY_MS);

  timer.unref?.();
  globalForScan.medlibRootWatch = timer;
}

function stopWatchingRoots(): void {
  if (globalForScan.medlibRootWatch) {
    clearInterval(globalForScan.medlibRootWatch);
  }
  globalForScan.medlibRootWatch = undefined;
}

async function* walk(
  dir: string,
  /** Folders that could not be read, collected as the walk goes. */
  failed: string[] = [],
): AsyncGenerator<FoundFile> {
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable folder — skip it rather than abandoning the whole scan, but
    // remember it: everything under it is unknown, not gone.
    failed.push(dir);
    return;
  }

  for (const dirent of dirents) {
    // Skips .DS_Store, .Spotlight-V100, and crucially the `._` AppleDouble
    // stubs macOS writes beside every file on exFAT — they are not real media.
    if (dirent.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(dirent.name)) continue;

    const full = path.join(dir, dirent.name);

    if (dirent.isDirectory()) {
      yield* walk(full, failed);
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
      -- The RPU reading describes a stream, not a path. A file whose size or
      -- mtime has moved is a different stream under the same name, so what was
      -- read out of the old one goes with it.
      --
      -- The scan only reaches this statement for a file that changed, so the
      -- test always fails there and the reading always goes, exactly as it did
      -- when this was a plain NULL. The test is here for reprobeFile, which is
      -- also asked to re-read files that have not changed at all: dropping the
      -- reading unconditionally would make "read this file again" cost an hour
      -- of full-stream RPU scanning to get back to where it started.
      dovi = CASE
        WHEN probes.size = excluded.size AND probes.mtime_ms = excluded.mtime_ms
          THEN probes.dovi
        ELSE NULL
      END
  `);

/**
 * Re-reads one file, whether or not it changed under us — after a conversion
 * rewrites it in place, or because the page showing its streams was asked to
 * read them again. The stored RPU reading is dropped along with the stream it
 * described; see the upsert above for when that is.
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
  // Both the folders holding files and the folders above any season folder:
  // a show's artwork sits with the show, not inside Season 01.
  const dirs = [
    ...new Set(
      files.flatMap((f) => {
        const dir = path.dirname(f.path);
        return SEASON_DIR.test(path.basename(dir))
          ? [dir, path.dirname(dir)]
          : [dir];
      }),
    ),
  ];

  const upsert = db.prepare(`
    INSERT INTO artwork (dir, poster, fanart, logo, found_at)
    VALUES (@dir, @poster, @fanart, @logo, @found_at)
    ON CONFLICT(dir) DO UPDATE SET
      poster = excluded.poster,
      fanart = excluded.fanart,
      logo = excluded.logo,
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
        logo: row.logo ?? null,
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
/** How many files the library already believes are under a root. */
function knownUnder(root: string): number {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM probes WHERE path LIKE ?")
    .get(`${prefix}%`) as { n: number };
  return row.n;
}

function pruneMissing(
  root: string,
  files: FoundFile[],
  /** Folders the walk could not read; their contents are unknown, not gone. */
  unread: string[] = [],
): number {
  const found = new Set(files.map((f) => f.path));
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const blind = unread.map((d) => (d.endsWith("/") ? d : `${d}/`));

  const stale = (
    db.prepare("SELECT path FROM probes").all() as { path: string }[]
  )
    .map((r) => r.path)
    .filter(
      (p) =>
        p.startsWith(prefix) &&
        !found.has(p) &&
        !blind.some((d) => p.startsWith(d)),
    );

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

/**
 * The wishlist pass: what the indexers have for the films you want.
 *
 * Its own function because it is reached from two places — the end of a good
 * scan, and the point where a scan gives up because the drive is not there.
 * Everything else in a scan is about the drive; this is about what is not on
 * it, so it is the one phase an absent drive has no bearing on.
 *
 * Needs Jackett and nothing else. Its absence is no more a failed scan than a
 * missing TMDb token is, and it needs nothing further from TMDb either — a
 * want is already a TMDb film by the time it reaches the list.
 *
 * @param deferred The search belongs to somebody else, so only the pruning
 *   runs here. Two callers mean it: a scan ending in a forced sweep, which
 *   asks about every want itself — the same questions put to the same indexers
 *   twice, a minute apart — and a scan asked to read the drive and stop, where
 *   the search belongs to nobody and the shelf's Scan menu is how it is asked
 *   for. The pruning stays in both: it reads the drive's own rows, costs
 *   nothing, and no sweep does it.
 */
async function runWishlistPass(deferred = false): Promise<void> {
  /*
   * Wants the drive has answered come off the list first, and unconditionally:
   * this is the app reading its own library, so it is right with no indexer,
   * no key and no network — and doing it before the search means nothing is
   * looked up for a film that is already here.
   */
  pruneOwnedWishes();

  if (deferred || !hasJackett()) return;

  setState({ ...current(), status: "wishlist", current: undefined });

  const wishes = await searchWishlist({
    onProgress: (p) =>
      setState({
        ...current(),
        wishTotal: p.total,
        wishDone: p.done,
        wishFound: p.found,
        current: p.current,
      }),
  });

  setState({
    ...current(),
    wishTotal: wishes.total,
    wishDone: wishes.done,
    wishFound: wishes.found,
    current: undefined,
  });
}

/**
 * The sweep, started the moment a scan is over.
 *
 * A scan settles what is on the drive; the sweep settles what the outside world
 * has that is better. The second question only becomes answerable once the
 * first one has been — a film's score is what a release is measured against —
 * so the two belong in that order, and asking someone to press a button for the
 * half that cannot run first made the queue something you had to remember to
 * fill. Opening the app scans, and now finishes the thought.
 *
 * Reached from both ends of a scan, including the one where the drive was not
 * there: the sweep reads the library's stored rows and the indexers, never the
 * drive, which is the same reason the wishlist pass runs in that case too.
 *
 * Nothing is awaited and nothing is returned — `startSweep` hands back the
 * moment the job is running, it is a no-op while one already is, and it skips
 * anything checked in the last day, so a scan on every start does not mean a
 * full search on every start.
 *
 * Unless the scan was asked for by name: see `force` on `startScan`.
 */
function sweepAfterScan(force: boolean): void {
  if (!hasJackett()) return;
  startSweep({ force });
}

export function startScan(
  roots: string[],
  /**
   * Whether the sweep at the end asks about every film and want, however
   * recently it asked.
   *
   * False for the scan that runs itself at start-up, which nobody requested and
   * which should stay cheap. It has no bearing on the shelf's Scan any more:
   * that press ends when the drive has been read — see `sweep` below — and the
   * forced searches it used to drag behind it are their own items in the menu
   * it opens, so "ask about everything again" is now a thing you ask for
   * rather than a thing that happens to you.
   */
  {
    force = false,
    sweep = true,
  }: {
    force?: boolean;
    /**
     * Whether the searches that normally follow the drive pass run at all.
     *
     * True for every scan that has ever run here: reading the drive and then
     * asking what beats what it found is one thought, and a scan that stopped
     * halfway through it left the queue to be filled by a button nobody
     * remembered to press.
     *
     * False for the library shelf's Scan, which is now the drive and only the
     * drive — the searches are the other items in the menu behind it, each a
     * forced pass somebody asked for by name. The wants are still pruned
     * against what the drive turned out to hold; that is the library reading
     * itself, not a question for an indexer.
     */
    sweep?: boolean;
  } = {},
): ScanState {
  if (working()) return current();

  // Whether the wants are somebody else's to search. Either a forced sweep is
  // really coming — without Jackett there is no sweep at all, and deferring to
  // one that will not run would drop the wants on the floor — or no sweep
  // follows this scan whatsoever, which is the shelf's drive-only press and
  // the same answer for the opposite reason.
  const searchedLater = !sweep || (force && hasJackett());

  setState({
    ...IDLE,
    status: "scanning",
    root: roots[0],
    startedAt: Date.now(),
  });

  // Deliberately not awaited: the caller returns immediately and the UI
  // follows the job stream.
  void (async () => {
    try {
      // Every folder into one list: the probe cache is keyed by path, so the
      // scan does not care which root a file came from — only pruning does.
      const files: FoundFile[] = [];
      const walked: string[] = [];
      const unreachable: { root: string; why: string }[] = [];
      const unread: string[] = [];

      for (const root of roots) {
        setState({ ...current(), root });

        // A root that cannot be read is not an empty root. With the drive
        // unplugged every folder under it simply is not there, and walking it
        // returns nothing — which the prune below would read as "every file
        // you own has been deleted". It wiped a 416-file library once; the
        // whole probe cache went with it.
        const why = await whyUnreachable(root);
        if (why) {
          unreachable.push({ root, why });
          continue;
        }

        const before = files.length;
        for await (const file of walk(root, unread)) {
          files.push(file);
          setState({ ...current(), discovered: files.length });
        }

        // A root that is mounted but yields nothing is the same signal as one
        // that is missing: a drive that mounts empty, the wrong volume at the
        // same path, permissions gone. A library folder that is genuinely
        // empty loses nothing by being left alone — remove it in Settings.
        if (files.length === before && knownUnder(root) > 0) {
          unreachable.push({ root, why: "readable but empty" });
          continue;
        }

        walked.push(root);
      }

      // Nothing was walked, so nothing can be trusted to be missing. Failing
      // loudly is the whole point: the alternative is a scan that reports
      // success having deleted the library.
      //
      // The wishlist still runs. It is the one pass that never touches the
      // drive — it asks indexers about films that are, by definition, not on
      // it — so an unplugged drive is no reason to skip it, and is in fact
      // when you are most likely to be looking for something to fetch. The
      // failure is still reported exactly as loudly afterwards.
      if (walked.length === 0) {
        const message = `${unreachable
          .map(unreachableSentence)
          .join(" · ")}. Nothing was scanned, and the library is untouched.`;

        await runWishlistPass(searchedLater);

        setState({
          ...current(),
          status: "error",
          current: undefined,
          error: message,
          finishedAt: Date.now(),
        });
        if (sweep) sweepAfterScan(force);

        // Said once, and then watched for rather than left standing: this is
        // the answer at one instant, and the drive it is about is the kind of
        // thing that turns up a minute later.
        watchForRoots(
          unreachable.map((u) => u.root),
          roots,
        );
        return;
      }

      // Pruned per root against the whole set, so a file is only dropped when
      // the folder it lives under was walked and did not turn it up — and only
      // for the roots that were actually walked.
      const removed = walked.reduce(
        (n, root) => n + pruneMissing(root, files, unread),
        0,
      );
      setState({
        ...current(),
        removed,
        skipped: unreachable.map(unreachableSentence),
      });

      // One folder of several missing is the same problem as all of them, and
      // it goes stale the same way — the scan finishes, the banner names the
      // folder that was left out, and it says so long after the drive holding
      // it came back. Watched on the same terms; cleared when there is nothing
      // left to wait for, so a clean scan never leaves a timer behind it.
      if (unreachable.length > 0) {
        watchForRoots(
          unreachable.map((u) => u.root),
          roots,
        );
      } else {
        stopWatchingRoots();
      }

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

        const summary = await runEnrich(getMovies(), {
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

        // Shows are matched once each, not once per episode, and only the
        // seasons actually held are pulled down.
        const shows = getShows();
        if (shows.length > 0) {
          setState({
            ...current(),
            status: "matching",
            matchTotal: summary.total + shows.length,
            matchDone: summary.done,
          });

          let showDone = 0;
          for (const show of shows) {
            setState({ ...current(), current: show.title });
            await enrichShow(
              show.key,
              show.title,
              show.seasons.map((s) => s.number),
            );
            showDone += 1;
            setState({ ...current(), matchDone: summary.done + showDone });
          }
          deriveAll();
        }

        // Anything matched but still bare on disk gets TMDb's top image for
        // each missing kind — poster, fanart, logo — downloaded into its own
        // folder as if picked by hand. Runs after matching for the same reason
        // discs do: without a match there is nothing to fetch.
        setState({ ...current(), status: "artwork", current: undefined });
        const art = await downloadMissingArtwork({
          onProgress: (p) =>
            setState({
              ...current(),
              artTotal: p.total,
              artDone: p.done,
              artSaved: p.saved,
              current: p.current,
            }),
        });
        // Fold the new files into the stored rows.
        if (art.saved > 0) deriveAll();

        // Disc lookups need a TMDb match to know what to search for, so this
        // runs last. Results are cached permanently, which is what keeps a
        // repeat scan from hammering someone else's server.
        const films = getMovies().filter((m) => m.tmdb?.id);
        const pending = films.filter((m) => !hasDisc(m.tmdb!.id));

        setState({
          ...current(),
          status: "discs",
          discTotal: pending.length,
          discDone: 0,
          current: undefined,
        });

        // A series is sold a season at a time, so each season is looked up on
        // its own — a show has no single release to compare against.
        const seasons = getShows()
          .filter((show) => show.tmdb)
          .flatMap((show) =>
            show.seasons
              .filter((season) => !hasSeasonDisc(show.key, season.number))
              .map((season) => ({ show, season })),
          );

        setState({
          ...current(),
          discTotal: pending.length + seasons.length,
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

        for (const { show, season } of seasons) {
          setState({
            ...current(),
            current: `${show.title} — season ${season.number}`,
          });
          try {
            await fetchSeasonDisc(
              show.key,
              season.number,
              show.tmdb!.name,
              seasonYear(season),
            );
          } catch {
            // As above.
          }
          done += 1;
          setState({ ...current(), discDone: done });
        }

        if (pending.length > 0) deriveAll();
      }

      await runWishlistPass(searchedLater);

      setState({
        ...current(),
        status: "done",
        current: undefined,
        finishedAt: Date.now(),
      });
      if (sweep) sweepAfterScan(force);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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
