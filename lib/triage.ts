import "server-only";

import { db } from "./db";

export type Triage = {
  acknowledged: boolean;
  /**
   * Whether this copy is an extended cut, as you answered it. Undefined is the
   * question still standing — the film page only asks where it has no answer,
   * so "no" has to be storable and distinguishable from silence.
   */
  extendedCut?: boolean;
};

export function getTriage(): Map<string, Triage> {
  const rows = db
    .prepare("SELECT path, acknowledged, extended_cut FROM triage")
    .all() as {
    path: string;
    acknowledged: number;
    extended_cut: number | null;
  }[];

  return new Map(
    rows.map((r) => [
      r.path,
      {
        acknowledged: r.acknowledged === 1,
        extendedCut:
          r.extended_cut === null ? undefined : r.extended_cut === 1,
      },
    ]),
  );
}

/**
 * Records your answer, or `null` to take it back and have the question asked
 * again. The row is created if this file has never been triaged — the answer is
 * the decision, and it should not need an acceptance alongside it to be kept.
 */
export function setExtendedCut(path: string, answer: boolean | null): void {
  db.prepare(
    `INSERT INTO triage (path, acknowledged, updated_at, extended_cut)
     VALUES (?, 0, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       extended_cut = excluded.extended_cut,
       updated_at = excluded.updated_at`,
  ).run(path, Date.now(), answer === null ? null : answer ? 1 : 0);
}
