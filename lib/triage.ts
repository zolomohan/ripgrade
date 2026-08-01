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
