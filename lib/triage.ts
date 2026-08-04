import "server-only";

import { db } from "./db";

export type Triage = { acknowledged: boolean };

export function getTriage(): Map<string, Triage> {
  const rows = db
    .prepare("SELECT path, acknowledged FROM triage")
    .all() as { path: string; acknowledged: number }[];

  return new Map(
    rows.map((r) => [r.path, { acknowledged: r.acknowledged === 1 }]),
  );
}
