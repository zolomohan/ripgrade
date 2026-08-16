import "server-only";

import type { RemovedTrack } from "./audio-plan";
import { db } from "./db";

/**
 * What the long jobs did, after they stopped doing it.
 *
 * The rail answers "what is running"; this answers "what ran". They are
 * different questions and only one of them can be answered by looking at the
 * corner of the screen at the right moment — which is the whole argument for
 * writing the second one down.
 *
 * Recorded from each job module's own `setJob`, at the moment it leaves
 * "running" for anything else. One place per module, and every way a job can
 * end passes through it: there is no path to a finished job that does not set
 * the job.
 *
 * One kind of row is not a job at all. Throwing away the original a conversion
 * or a track removal set aside is an `rm` and nothing else — there is nothing
 * to watch while it happens, and the rail would never have time to draw it. It
 * is also the only thing this app does that cannot be walked back, and the
 * question it leaves is asked long afterwards and by someone with no way left
 * to answer it: where did the ninety gigabytes go, and was that film's
 * Profile 7 copy among them. So it is written down at the moment of the delete
 * instead — see `recordDiscardedBackup`.
 *
 * The leftovers swept up beside those originals are not written down. Every one
 * of them is half-written output that outlived a crash, nothing was lost when
 * one went, and a row per file would bury the rows where something was.
 *
 * The scan is not among them, on purpose. It runs on a timer as much as on a
 * click, it ends by describing itself in the rail's own closing line, and a
 * log filled with a hundred identical "scanned 418 files" rows is a log with
 * the interesting rows buried in it.
 *
 * Nor is the upgrade sweep, for the first of those reasons and one of its own:
 * one starts behind every scan, so it wrote a row per boot, and what it found
 * is the queue — a page that still holds the answer a week later, where the
 * row only ever held the count. See `setJob` in lib/upgrade-sweep.ts.
 *
 * Rows written by the version that did log them are still in the table, so the
 * read below excludes the kind rather than trusting that nothing writes it.
 */

export type JobKind = "convert" | "strip" | "dovi" | "thumbs" | "cleanup";

/** How it ended. "Running" is the rail's business, not this table's. */
export type JobOutcome = "done" | "cancelled" | "error";

/**
 * Whether a status is an ending worth writing down, narrowing it to one as it
 * goes. Every job shares the same status union, and every one of them has an
 * "idle" in it that is the value before anything has happened rather than a
 * way for something to finish.
 */
export const ended = (status: string): status is JobOutcome =>
  status === "done" || status === "cancelled" || status === "error";

export type JobRun = {
  id: number;
  kind: JobKind;
  /** What it was, in the words the list shows. */
  title: string;
  /** The film it worked on, where it worked on one. */
  path?: string;
  outcome: JobOutcome;
  startedAt?: number;
  finishedAt: number;
  /** The closing sentence: what it did, or why it stopped. */
  detail?: string;
  /**
   * What was spawned, as it could be pasted into a shell — for the jobs that
   * are a tool being driven rather than work this app does itself.
   *
   * Kept beside the output rather than left to the running job, because the
   * question the log is asked afterwards is "what did it actually do to that
   * file", and the tail of a tool's output only makes sense against the command
   * that produced it. It is also the one thing here that can be acted on: a
   * conversion that failed is a line you can run yourself and watch fail.
   */
  command?: string;
  /** The tail of what the tool printed, for the runs that had one. */
  output?: string[];
  /**
   * Which tracks a removal actually took, named.
   *
   * The one fact in this table that cannot be recovered from anywhere else. A
   * conversion can be read off the file it produced and a cleanup off the
   * space that came back, but a removed track leaves nothing behind — the
   * counts in `detail` say five went, and this is the only record of which
   * five. Null on every other kind of run, and on the removals logged before
   * it was kept.
   */
  removedTracks?: RemovedTrack[];
};

/**
 * How many runs are kept. A cap rather than a sweep by age, because what makes
 * a run worth keeping is being recent *among the others* — a library that runs
 * one conversion a month should still be able to see the last twenty.
 */
const KEEP = 200;

type RunRow = {
  id: number;
  kind: string;
  title: string;
  path: string | null;
  outcome: string;
  started_at: number | null;
  finished_at: number;
  detail: string | null;
  command: string | null;
  output: string | null;
  removed_tracks: string | null;
};

const runOf = (row: RunRow): JobRun => ({
  id: row.id,
  kind: row.kind as JobKind,
  title: row.title,
  path: row.path ?? undefined,
  outcome: row.outcome as JobOutcome,
  startedAt: row.started_at ?? undefined,
  finishedAt: row.finished_at,
  detail: row.detail ?? undefined,
  command: row.command ?? undefined,
  output: parseOutput(row.output),
  removedTracks: parseTracks(row.removed_tracks),
});

/** As tolerant as `parseOutput`, and for the same reason. */
function parseTracks(raw: string | null): RemovedTrack[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RemovedTrack[]) : undefined;
  } catch {
    return undefined;
  }
}

function parseOutput(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : undefined;
  } catch {
    // A row written by a version that stored something else must not take the
    // page down with it.
    return undefined;
  }
}

/**
 * Writes one finished run, and trims the log back to its cap.
 *
 * Swallows its own errors on purpose. This is called from inside the state
 * change that ends a job, and a log that cannot be written is not a reason for
 * a conversion to report failure — the work it is describing has already
 * happened either way.
 */
export function recordRun(run: Omit<JobRun, "id">): void {
  try {
    db.prepare(
      `INSERT INTO job_runs
         (kind, title, path, outcome, started_at, finished_at, detail, command, output, removed_tracks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      run.kind,
      run.title,
      run.path ?? null,
      run.outcome,
      run.startedAt ?? null,
      run.finishedAt,
      run.detail ?? null,
      run.command ?? null,
      run.output?.length ? JSON.stringify(run.output) : null,
      run.removedTracks?.length ? JSON.stringify(run.removedTracks) : null,
    );

    db.prepare(
      `DELETE FROM job_runs WHERE id NOT IN (
         SELECT id FROM job_runs ORDER BY finished_at DESC, id DESC LIMIT ?
       )`,
    ).run(KEEP);
  } catch {
    // See above: the job is what matters, not the note about it.
  }
}

/**
 * Writes the row for an original that was thrown away.
 *
 * Called from all three places one can go — a film's own console has a button
 * per kind of original, and the queue's cleanup list sweeps up both kinds
 * together — because each of them is a different `rm` on a different path, and
 * there is no single moment further down they all pass through. What they share
 * is this row, so the wording of it lives here rather than three times over.
 *
 * Only a delete that happened. All three callers throw when the file is not
 * there or will not go, and the caller of *those* puts the failure in front of
 * whoever pressed the button — a log row saying an original could not be
 * deleted describes a file that is still on the drive.
 *
 * The size is read before the delete rather than found afterwards, for the
 * obvious reason. It is optional because a stat that fails is not a reason to
 * lose the row: what the row is for is saying the file is gone.
 *
 * No `startedAt`, so the log prints no duration for it. It is one system call,
 * and "0s" is not a fact anybody wants.
 */
export function recordDiscardedBackup(discard: {
  /**
   * The film the original was kept beside, which is what puts its poster and
   * its title on the row. Absent where nothing in the library answers to it any
   * more — an original outlives the film it was made from, and that is exactly
   * the one worth a record.
   */
  path?: string;
  /** The name of the file that is now gone. */
  name: string;
  /** How big it was, and so how much this got back. */
  bytes?: number;
}): void {
  recordRun({
    kind: "cleanup",
    title: discard.name,
    path: discard.path,
    outcome: "done",
    finishedAt: Date.now(),
    // The same figure the audio removal's row closes with, in the same words:
    // both are space this app gave back, and a log that called one "freed" and
    // the other "reclaimed" would be inviting a distinction it does not mean.
    detail:
      discard.bytes === undefined
        ? undefined
        : `${(discard.bytes / 1e9).toFixed(1)} GB freed`,
  });
}

/** The log, newest first. */
export function getJobRuns(limit = KEEP): JobRun[] {
  const rows = db
    .prepare(
      `SELECT id, kind, title, path, outcome, started_at, finished_at, detail,
              command, output, removed_tracks
         FROM job_runs
        WHERE kind <> 'sweep'
        ORDER BY finished_at DESC, id DESC
        LIMIT ?`,
    )
    .all(limit) as RunRow[];

  return rows.map(runOf);
}
