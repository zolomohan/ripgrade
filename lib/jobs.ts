import "server-only";

import { db } from "./db";

/**
 * A finished run of one of the long jobs.
 *
 * The label is stored rather than resolved later: a conversion's film can be
 * renamed or removed, and a history that forgets what it was about the moment
 * the library changes is not a history.
 */
export type JobKind = "scan" | "dovi" | "convert";

export type JobRun = {
  id: number;
  kind: JobKind;
  label?: string;
  startedAt: number;
  finishedAt: number;
  status: "done" | "cancelled" | "error";
  detail?: string;
};

const KEEP = 200;

export function recordRun(run: Omit<JobRun, "id">): void {
  db.prepare(
    `INSERT INTO job_runs (kind, label, started_at, finished_at, status, detail)
     VALUES (@kind, @label, @startedAt, @finishedAt, @status, @detail)`,
  ).run({
    kind: run.kind,
    label: run.label ?? null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    detail: run.detail ?? null,
  });

  // Trimmed here rather than by a job of its own: this table is a convenience,
  // and an unbounded one would outlive its usefulness quietly.
  db.prepare(
    `DELETE FROM job_runs WHERE id NOT IN (
       SELECT id FROM job_runs ORDER BY finished_at DESC LIMIT ?
     )`,
  ).run(KEEP);
}

export function getRuns(limit = 40): JobRun[] {
  const rows = db
    .prepare("SELECT * FROM job_runs ORDER BY finished_at DESC LIMIT ?")
    .all(limit) as {
    id: number;
    kind: JobKind;
    label: string | null;
    started_at: number;
    finished_at: number;
    status: JobRun["status"];
    detail: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    label: r.label ?? undefined,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    detail: r.detail ?? undefined,
  }));
}
