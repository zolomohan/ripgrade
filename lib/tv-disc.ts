import "server-only";

import {
  lookupRelease,
  lookupSeasonDisc,
  searchSeasonReleases,
  type Candidate,
  type DiscLookup,
} from "./bluray";
import { db } from "./db";

export { searchSeasonReleases };

/**
 * Disc releases for television, one per season.
 *
 * The film side keys this on a TMDb id because a film is one thing with one
 * release. A season is not: the show has an id and the season does not, so the
 * key here is the show plus the season number — which also means a season keeps
 * the release you pinned when the show is re-matched to a different TMDb entry.
 */
const key = (showKey: string, season: number) => `${showKey}:${season}`;

export function getSeasonDiscs(): Map<string, DiscLookup> {
  const rows = db
    .prepare("SELECT show_key, season, lookup FROM tv_disc")
    .all() as { show_key: string; season: number; lookup: string }[];

  const map = new Map<string, DiscLookup>();
  for (const row of rows) {
    try {
      map.set(key(row.show_key, row.season), JSON.parse(row.lookup));
    } catch {
      // One unreadable row should not blind the rest.
    }
  }
  return map;
}

export function getSeasonDisc(
  showKey: string,
  season: number,
): DiscLookup | undefined {
  const row = db
    .prepare("SELECT lookup FROM tv_disc WHERE show_key = ? AND season = ?")
    .get(showKey, season) as { lookup: string } | undefined;
  return row ? (JSON.parse(row.lookup) as DiscLookup) : undefined;
}

export function hasSeasonDisc(showKey: string, season: number): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM tv_disc WHERE show_key = ? AND season = ?")
      .get(showKey, season),
  );
}

function save(showKey: string, season: number, lookup: DiscLookup): void {
  db.prepare(
    `INSERT INTO tv_disc (show_key, season, fetched_at, lookup, error)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(show_key, season) DO UPDATE SET
       fetched_at = excluded.fetched_at,
       lookup = excluded.lookup,
       error = excluded.error`,
  ).run(
    showKey,
    season,
    Date.now(),
    JSON.stringify(lookup),
    lookup.error ?? null,
  );
}

/**
 * Looks a season up unless it is already cached. A failed lookup is stored too,
 * so a season with no disc release is not retried on every scan.
 */
export async function fetchSeasonDisc(
  showKey: string,
  season: number,
  showTitle: string,
  year?: number,
  refresh = false,
): Promise<DiscLookup> {
  const cached = getSeasonDisc(showKey, season);
  // A hand-picked release is never overwritten, even by an explicit refresh.
  if (cached && (!refresh || cached.manual)) return cached;

  const lookup = await lookupSeasonDisc(showTitle, season, year);
  save(showKey, season, lookup);
  return lookup;
}

/** Records a release you chose yourself, replacing whatever was found. */
export async function setManualSeasonDisc(
  showKey: string,
  season: number,
  candidate: Candidate,
): Promise<DiscLookup> {
  const lookup = await lookupRelease(candidate, getSeasonDisc(showKey, season));
  save(showKey, season, lookup);
  return lookup;
}

/** Drops the pin so the next scan searches for this season again. */
export function clearSeasonDisc(showKey: string, season: number): void {
  db.prepare("DELETE FROM tv_disc WHERE show_key = ? AND season = ?").run(
    showKey,
    season,
  );
}
