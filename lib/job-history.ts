import "server-only";

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

export type JobKind = "convert" | "strip" | "dovi" | "thumbs";

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
});

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
         (kind, title, path, outcome, started_at, finished_at, detail, command, output)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

/** The log, newest first. */
export function getJobRuns(limit = KEEP): JobRun[] {
  const rows = db
    .prepare(
      `SELECT id, kind, title, path, outcome, started_at, finished_at, detail, command, output
         FROM job_runs
        WHERE kind <> 'sweep'
        ORDER BY finished_at DESC, id DESC
        LIMIT ?`,
    )
    .all(limit) as RunRow[];

  return rows.map(runOf);
}
