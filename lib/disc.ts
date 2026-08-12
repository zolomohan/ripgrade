import "server-only";

import {
  candidateFromUrl,
  lookupDisc,
  lookupRelease,
  searchReleases,
  type Candidate,
  type DiscLookup,
} from "./bluray";
import { db } from "./db";
import { specFromEntry, type DiscEntry } from "./disc-entry";

export type { Candidate, DiscLookup };
export { candidateFromUrl, searchReleases };

/** One row, written the one way — every path here stores the same shape. */
function save(tmdbId: number, lookup: DiscLookup): void {
  db.prepare(
    `INSERT INTO disc (tmdb_id, fetched_at, lookup, error)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tmdb_id) DO UPDATE SET
       fetched_at = excluded.fetched_at,
       lookup = excluded.lookup,
       error = excluded.error`,
  ).run(tmdbId, Date.now(), JSON.stringify(lookup), lookup.error ?? null);
}

export function getDiscs(): Map<number, DiscLookup> {
  const rows = db.prepare("SELECT tmdb_id, lookup FROM disc").all() as {
    tmdb_id: number;
    lookup: string;
  }[];
  return new Map(
    rows.map((r) => [r.tmdb_id, JSON.parse(r.lookup) as DiscLookup]),
  );
}

/**
 * Every film a disc release was actually found for.
 *
 * A lookup that found nothing is cached too, so that it is not retried on every
 * run — which means a row here is not a disc. `best` is what separates the two,
 * and `json_extract` asks SQLite rather than parsing every lookup to find out.
 */
export function discIds(): Set<number> {
  const rows = db
    .prepare(
      "SELECT tmdb_id FROM disc WHERE json_extract(lookup, '$.best') IS NOT NULL",
    )
    .all() as { tmdb_id: number }[];
  return new Set(rows.map((r) => r.tmdb_id));
}

/**
 * Every film whose ceiling was typed in rather than found.
 *
 * Nothing scores differently for it — a hand-entered ceiling is an ordinary
 * `DiscSpec` by the time the scorer sees one, deliberately. This is for saying
 * where the ceiling came from, which is a question about the library's
 * coverage rather than about any one film: a shelf compared mostly against
 * specs somebody typed is a shelf resting on their memory.
 *
 * `entered` and not `manual`: picking which release to scrape is still the
 * disc's own numbers, and only the typed-in ones are anybody's word for it.
 */
export function enteredDiscIds(): Set<number> {
  const rows = db
    .prepare(
      "SELECT tmdb_id FROM disc WHERE json_extract(lookup, '$.entered') = 1",
    )
    .all() as { tmdb_id: number }[];
  return new Set(rows.map((r) => r.tmdb_id));
}

export function hasDisc(tmdbId: number): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM disc WHERE tmdb_id = ?").get(tmdbId),
  );
}

export function getDisc(tmdbId: number): DiscLookup | undefined {
  const row = db
    .prepare("SELECT lookup FROM disc WHERE tmdb_id = ?")
    .get(tmdbId) as { lookup: string } | undefined;
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
  const cached = getDisc(tmdbId);
  // A hand-picked release is never overwritten, even by an explicit refresh —
  // re-running the automatic search would just undo your choice.
  if (cached && (!refresh || cached.manual)) return cached;

  const lookup = await lookupDisc(title, year);
  save(tmdbId, lookup);
  return lookup;
}

/** Records a release you chose yourself, replacing whatever was found. */
export async function setManualDisc(
  tmdbId: number,
  candidate: Candidate,
): Promise<DiscLookup> {
  const existing = getDisc(tmdbId);
  const lookup = await lookupRelease(candidate, existing);
  save(tmdbId, lookup);
  return lookup;
}

/**
 * Records specs you typed in yourself, for a film Blu-ray.com has no page for.
 *
 * Kept as manual, so no later scan overwrites it — the search that found
 * nothing the first time will find nothing again, and quietly replacing a
 * hand-written ceiling with "no release found" would undo the work.
 */
export function setEnteredDisc(tmdbId: number, entry: DiscEntry): DiscLookup {
  const existing = getDisc(tmdbId);
  const best = specFromEntry(entry);

  const lookup: DiscLookup = {
    // A 4K entry says a 4K version exists — that is what you just told it, and
    // it reads as a stream or a disc according to the source you picked. A
    // lower one leaves the search's own finding alone rather than denying it.
    uhdExists: existing?.uhdExists || best.format === "4K",
    releaseCount: existing?.releaseCount ?? 0,
    best,
    manual: true,
    entered: true,
  };

  save(tmdbId, lookup);
  return lookup;
}

/** Drops the manual pin so the next scan searches for this film again. */
export function clearDisc(tmdbId: number): void {
  db.prepare("DELETE FROM disc WHERE tmdb_id = ?").run(tmdbId);
}
