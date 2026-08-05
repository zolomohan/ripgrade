import "server-only";

import path from "node:path";

import { db } from "./db";
import { duplicateKey } from "./derive";
import { getDisc } from "./disc";
import { notifyJobs } from "./job-events";
import { getMovies, type LibraryItem } from "./library";
import { guessFromTitle } from "./release-title";
import { bestUpgrade, type ScoredRelease } from "./upgrades";

/**
 * The library-wide upgrade sweep.
 *
 * Finding a better copy was a per-film gesture: open the film, press Upgrade,
 * read the list. Useful when you already suspect a film; useless for the
 * question the app actually exists to answer, which is "across everything I
 * own, what is worth replacing?" The sweep runs that per-film search over
 * every film that wants attention and keeps the single best answer per film,
 * so the queue page can rank the library by what upgrading would gain —
 * without a search in sight.
 *
 * It runs like the Dolby Vision pass: one background job, progress over the
 * job stream, cancellable, resumable in effect because every film's result is
 * written as it lands and fresh checks are skipped on the next run.
 */

export type SweepJob = {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  total: number;
  done: number;
  /** Films where something better turned up, so far. */
  found: number;
  /** Checked recently enough to skip — see FRESH_MS. */
  skipped: number;
  current?: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
};

const IDLE: SweepJob = {
  status: "idle",
  total: 0,
  done: 0,
  found: 0,
  skipped: 0,
};

/**
 * A check younger than this is not repeated. Indexer listings churn daily,
 * not hourly — and it is what makes a cancelled sweep resume where it left
 * off rather than starting over.
 */
const FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * This many films failing in a row is not bad luck with titles, it is Jackett
 * being down — and four hundred more attempts against a dead proxy would take
 * an hour to say so.
 */
const ABORT_AFTER_FAILURES = 3;

/** On globalThis so a dev-reload mid-sweep keeps reporting; see scanner.ts. */
const globalForSweep = globalThis as unknown as {
  medlibSweep?: SweepJob;
  medlibSweepCancel?: boolean;
};

const current = (): SweepJob => globalForSweep.medlibSweep ?? IDLE;

function setJob(next: SweepJob) {
  globalForSweep.medlibSweep = next;
  notifyJobs();
}

export function getSweepJob(): SweepJob {
  return current();
}

/**
 * The one best release, trimmed to what the queue row draws. Stored rather
 * than recomputed because each one cost an indexer search to learn.
 */
export type StoredHit = {
  title: string;
  /** Predicted, on the same scale as the film's own score. */
  score: number;
  relative: boolean;
  /** Above the copy at check time — recomputed live against today's score. */
  delta: number;
  seeders?: number;
  sizeBytes?: number;
  magnet?: string;
  detailsUrl?: string;
  indexer?: string;
  resolution?: string;
  hdr?: string;
  releaseType?: string;
  /** Optional because older rows predate them; the compare page shows "—". */
  scores?: { video: number; audio: number; release: number };
  audio?: string;
};

function trim(release: ScoredRelease): StoredHit {
  const { facts, scores } = release.guess;
  const bestAudio = facts.audio[0];
  return {
    title: release.title,
    score: release.score,
    relative: release.relative,
    delta: release.delta ?? 0,
    seeders: release.seeders,
    sizeBytes: release.sizeBytes,
    magnet: release.magnet,
    detailsUrl: release.detailsUrl,
    indexer: release.indexer,
    resolution: facts.resolution !== "unknown" ? facts.resolution : undefined,
    hdr: facts.hdr !== "SDR" ? facts.hdr : undefined,
    releaseType: facts.releaseType !== "UNKNOWN" ? facts.releaseType : undefined,
    scores: {
      video: scores.video,
      audio: scores.audio,
      release: scores.release,
    },
    audio: bestAudio
      ? [bestAudio.label, bestAudio.channels && `${bestAudio.channels}ch`]
          .filter(Boolean)
          .join(" · ")
      : undefined,
  };
}

const upsertCheck = () =>
  db.prepare(`
    INSERT INTO upgrade_checks (path, checked_at, current_score, best)
    VALUES (@path, @checked_at, @current_score, @best)
    ON CONFLICT(path) DO UPDATE SET
      checked_at = excluded.checked_at,
      current_score = excluded.current_score,
      best = excluded.best
  `);

/** The films a sweep would look at: matched, and with something to gain. */
export function sweepCandidates(): LibraryItem[] {
  return getMovies().filter((m) => m.tmdb?.id && m.priority !== "None");
}

export function startSweep(): SweepJob {
  if (current().status === "running") return current();

  globalForSweep.medlibSweepCancel = false;
  setJob({ ...IDLE, status: "running", startedAt: Date.now() });

  // Not awaited: the caller returns at once and the job stream reports.
  void (async () => {
    try {
      const candidates = sweepCandidates();

      const checked = new Map(
        (
          db.prepare("SELECT path, checked_at FROM upgrade_checks").all() as {
            path: string;
            checked_at: number;
          }[]
        ).map((r) => [r.path, r.checked_at]),
      );

      const now = Date.now();
      const stale = candidates
        .filter((m) => now - (checked.get(m.path) ?? 0) > FRESH_MS)
        // Never-checked first, then oldest check first: the films the queue
        // knows least about are the ones a cancelled sweep should have
        // reached before it stopped.
        .sort(
          (a, b) => (checked.get(a.path) ?? 0) - (checked.get(b.path) ?? 0),
        );

      setJob({
        ...current(),
        total: stale.length,
        skipped: candidates.length - stale.length,
      });

      const stmt = upsertCheck();
      let failures = 0;

      for (const movie of stale) {
        if (globalForSweep.medlibSweepCancel) {
          setJob({
            ...current(),
            status: "cancelled",
            current: undefined,
            finishedAt: Date.now(),
          });
          return;
        }

        setJob({ ...current(), current: movie.tmdb?.title ?? movie.title });

        try {
          // The same target the film's own Upgrade button builds, so the
          // queue and the modal can never disagree about what "better" means.
          const best = await bestUpgrade({
            kind: "movie",
            title: movie.tmdb?.title ?? movie.title,
            year: movie.tmdb?.year ?? movie.year,
            imdbId: movie.imdbId,
            runtimeMinutes:
              movie.tmdb?.runtimeMinutes ??
              (movie.durationSec
                ? Math.round(movie.durationSec / 60)
                : undefined),
            currentScore: movie.scores.overall,
            disc: getDisc(movie.tmdb!.id),
          });

          const hit =
            best && best.delta !== undefined && best.delta > 0
              ? trim(best)
              : null;

          stmt.run({
            path: movie.path,
            checked_at: Date.now(),
            current_score: movie.scores.overall,
            best: hit ? JSON.stringify(hit) : null,
          });

          failures = 0;
          setJob({
            ...current(),
            done: current().done + 1,
            found: current().found + (hit ? 1 : 0),
          });
        } catch (err) {
          failures += 1;
          if (failures >= ABORT_AFTER_FAILURES) {
            setJob({
              ...current(),
              status: "error",
              current: undefined,
              error: `Search keeps failing — is Jackett reachable? (${
                err instanceof Error ? err.message : String(err)
              })`,
              finishedAt: Date.now(),
            });
            return;
          }
          // One bad title should not end the sweep; it counts as done and
          // stays unchecked, so the next run tries it again.
          setJob({ ...current(), done: current().done + 1 });
        }
      }

      setJob({
        ...current(),
        status: "done",
        current: undefined,
        finishedAt: Date.now(),
      });
    } catch (err) {
      setJob({
        ...current(),
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      });
    }
  })();

  return current();
}

export function cancelSweep(): SweepJob {
  if (current().status !== "running") return current();
  globalForSweep.medlibSweepCancel = true;
  return current();
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export type UpgradeQueueItem = {
  path: string;
  /** The duplicate-group key, which is the compare page's address. */
  compareKey: string;
  title: string;
  year?: number;
  /** Local poster file and its TMDb source, exactly as a shelf tile gets. */
  poster?: string;
  posterRemote?: string;
  artAt?: number;
  currentScore: number;
  checkedAt: number;
  hit: StoredHit;
};

/**
 * Every film the last sweep found something better for, best gain first.
 *
 * The delta is recomputed against the film's score *today*, not the score at
 * check time — replace the file and rescan, and the entry falls out of the
 * queue by itself instead of celebrating an upgrade you already made.
 */
export function getUpgradeQueue(): UpgradeQueueItem[] {
  const rows = db
    .prepare(
      "SELECT path, checked_at, best FROM upgrade_checks WHERE best IS NOT NULL",
    )
    .all() as { path: string; checked_at: number; best: string }[];

  const byPath = new Map(getMovies().map((m) => [m.path, m]));

  const items: UpgradeQueueItem[] = [];
  for (const row of rows) {
    const movie = byPath.get(row.path);
    if (!movie) continue; // Deleted or unplugged since the sweep.

    const hit = JSON.parse(row.best) as StoredHit;
    const delta = hit.score - movie.scores.overall;
    if (delta <= 0) continue;

    items.push({
      path: movie.path,
      compareKey: duplicateKey(movie),
      title: movie.tmdb?.title ?? movie.title,
      year: movie.tmdb?.year ?? movie.year,
      poster: movie.poster,
      posterRemote: movie.art.poster,
      artAt: movie.artAt,
      currentScore: movie.scores.overall,
      checkedAt: row.checked_at,
      hit: { ...hit, delta },
    });
  }

  return items.sort((a, b) => {
    // Releases that would reach 100 come first, whatever their gain: a 100
    // is the disc matched (or the rubric maxed) — the film is *finished*,
    // taken off the hunt for good, and finishing outranks improving. Within
    // each band, best gain first as before.
    const finishes =
      Number(b.hit.score >= 100) - Number(a.hit.score >= 100);
    if (finishes !== 0) return finishes;

    return (
      b.hit.delta - a.hit.delta ||
      (b.hit.seeders ?? 0) - (a.hit.seeders ?? 0) ||
      path.basename(a.path).localeCompare(path.basename(b.path))
    );
  });
}

/**
 * Fills the fields a row written by an older sweep never stored.
 *
 * The whole prediction is read off the release name, and the name is stored —
 * so the sub-scores and audio it lacked are re-read here, the same reading
 * the sweep itself made. Only the headline score is left as stored: it may be
 * disc-relative, which a bare name cannot reproduce.
 */
function hydrate(hit: StoredHit): StoredHit {
  if (hit.scores) return hit;

  const guess = guessFromTitle(hit.title, { sizeBytes: hit.sizeBytes });
  const { facts, scores } = guess;
  const bestAudio = facts.audio[0];

  return {
    ...hit,
    scores: {
      video: scores.video,
      audio: scores.audio,
      release: scores.release,
    },
    audio:
      hit.audio ??
      (bestAudio
        ? [bestAudio.label, bestAudio.channels && `${bestAudio.channels}ch`]
            .filter(Boolean)
            .join(" · ")
        : undefined),
  };
}

/**
 * The sweep's best find for any of these paths — the compare page passes a
 * duplicate group's copies, and the strongest stored hit stands for the film.
 */
export function storedHitFor(paths: string[]): StoredHit | null {
  if (paths.length === 0) return null;

  const rows = db
    .prepare(
      `SELECT best FROM upgrade_checks
       WHERE best IS NOT NULL AND path IN (${paths.map(() => "?").join(",")})`,
    )
    .all(...paths) as { best: string }[];

  const hits = rows.map((r) => JSON.parse(r.best) as StoredHit);
  const best = hits.sort((a, b) => b.score - a.score)[0];
  return best ? hydrate(best) : null;
}

/** How many films have ever been checked, for the page to say so. */
export function checkedCount(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM upgrade_checks")
    .get() as { n: number };
  return row.n;
}
