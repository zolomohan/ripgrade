import "server-only";

import { db } from "./db";

export type Triage = { acknowledged: boolean; note?: string };

export function getTriage(): Map<string, Triage> {
  const rows = db
    .prepare("SELECT path, acknowledged, note FROM triage")
    .all() as { path: string; acknowledged: number; note: string | null }[];

  return new Map(
    rows.map((r) => [
      r.path,
      { acknowledged: r.acknowledged === 1, note: r.note ?? undefined },
    ]),
  );
}

/**
 * Records that you have looked at a film and made your peace with it, so it
 * drops out of the attention counts without hiding anything permanently.
 */
export function setTriage(
  path: string,
  acknowledged: boolean,
  note?: string,
): void {
  db.prepare(
    `INSERT INTO triage (path, acknowledged, note, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       acknowledged = excluded.acknowledged,
       note = excluded.note,
       updated_at = excluded.updated_at`,
  ).run(path, acknowledged ? 1 : 0, note?.trim() || null, Date.now());
}

/** Issue codes resolved one at a time, keyed by film. */
export function getIssueAcks(): Map<string, string[]> {
  const rows = db
    .prepare("SELECT path, code FROM issue_acks")
    .all() as { path: string; code: string }[];

  const map = new Map<string, string[]>();
  for (const row of rows) {
    map.set(row.path, [...(map.get(row.path) ?? []), row.code]);
  }
  return map;
}

/**
 * Marks one issue as dealt with, or puts it back. Resolving is per-film and
 * per-code: the same problem on another film is still open, and re-raising it
 * here is a matter of deleting one row.
 */
export function setIssueAck(path: string, code: string, resolved: boolean): void {
  if (resolved) {
    db.prepare(
      "INSERT INTO issue_acks (path, code, acked_at) VALUES (?, ?, ?) ON CONFLICT(path, code) DO NOTHING",
    ).run(path, code, Date.now());
  } else {
    db.prepare("DELETE FROM issue_acks WHERE path = ? AND code = ?").run(
      path,
      code,
    );
  }
}
