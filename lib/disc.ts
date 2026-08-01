import "server-only";

import { lookupDisc, type DiscLookup } from "./bluray";
import { db } from "./db";

export type { DiscLookup };

export function getDiscs(): Map<number, DiscLookup> {
  const rows = db.prepare("SELECT tmdb_id, lookup FROM disc").all() as {
    tmdb_id: number;
    lookup: string;
  }[];
  return new Map(rows.map((r) => [r.tmdb_id, JSON.parse(r.lookup) as DiscLookup]));
}

export function hasDisc(tmdbId: number): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM disc WHERE tmdb_id = ?").get(tmdbId),
  );
}

export function getDisc(tmdbId: number): DiscLookup | undefined {
  const row = db.prepare("SELECT lookup FROM disc WHERE tmdb_id = ?").get(tmdbId) as
    | { lookup: string }
    | undefined;
  return row ? (JSON.parse(row.lookup) as DiscLookup) : undefined;
}

/**
 * Looks a film up unless it is already cached. A failed lookup is stored too,
 * so a film with no disc release is not retried on every run.
 */
export async function fetchDisc(
  tmdbId: number,
  title: string,
  year: number | undefined,
  refresh = false,
): Promise<DiscLookup> {
  if (!refresh) {
    const cached = getDisc(tmdbId);
    if (cached) return cached;
  }

  const lookup = await lookupDisc(title, year);

  db.prepare(
    `INSERT INTO disc (tmdb_id, fetched_at, lookup, error)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tmdb_id) DO UPDATE SET
       fetched_at = excluded.fetched_at,
       lookup = excluded.lookup,
       error = excluded.error`,
  ).run(tmdbId, Date.now(), JSON.stringify(lookup), lookup.error ?? null);

  return lookup;
}
