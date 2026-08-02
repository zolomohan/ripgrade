import "server-only";

import { db } from "./db";
import {
  getSeason,
  getTvShow,
  hasCredentials,
  searchTv,
  type TmdbEpisode,
  type TmdbShow,
} from "./tmdb";

/**
 * Identifying shows, which is a different job from identifying films.
 *
 * A film is matched per file; a show is matched once and every episode inherits
 * it. That is not an optimisation — it is what stops one badly named episode
 * being filed under a different series from its neighbours.
 */
export type TvMatch = {
  tmdbId?: number;
  confidence: "high" | "low";
  manual: boolean;
};

/**
 * A name stripped to letters and digits, for comparing a folder name with a
 * TMDb one. A filesystem cannot hold a colon, so "Ben 10 Alien Force" on disk
 * and "Ben 10: Alien Force" on TMDb are the same name written twice — treating
 * them as different would send every subtitled series to manual review.
 */
const plain = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function getTvMatches(): Map<string, TvMatch> {
  const rows = db
    .prepare("SELECT show_key, tmdb_id, confidence, manual FROM tv_matches")
    .all() as {
    show_key: string;
    tmdb_id: number | null;
    confidence: string;
    manual: number;
  }[];

  return new Map(
    rows.map((r) => [
      r.show_key,
      {
        tmdbId: r.tmdb_id ?? undefined,
        confidence: r.confidence as "high" | "low",
        manual: r.manual === 1,
      },
    ]),
  );
}

function saveMatch(key: string, match: TvMatch): void {
  db.prepare(
    `INSERT INTO tv_matches (show_key, tmdb_id, confidence, manual, matched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(show_key) DO UPDATE SET
       tmdb_id = excluded.tmdb_id,
       confidence = excluded.confidence,
       manual = excluded.manual,
       matched_at = excluded.matched_at`,
  ).run(
    key,
    match.tmdbId ?? null,
    match.confidence,
    match.manual ? 1 : 0,
    Date.now(),
  );
}

export function getShowRecords(): Map<number, TmdbShow> {
  const rows = db.prepare("SELECT tmdb_id, json FROM tmdb_shows").all() as {
    tmdb_id: number;
    json: string;
  }[];

  const map = new Map<number, TmdbShow>();
  for (const row of rows) {
    try {
      map.set(row.tmdb_id, JSON.parse(row.json) as TmdbShow);
    } catch {
      // One unreadable row should not blind the whole shelf.
    }
  }
  return map;
}

export function getSeasonRecords(): Map<string, TmdbEpisode[]> {
  const rows = db
    .prepare("SELECT tmdb_id, season, json FROM tmdb_seasons")
    .all() as { tmdb_id: number; season: number; json: string }[];

  const map = new Map<string, TmdbEpisode[]>();
  for (const row of rows) {
    try {
      map.set(`${row.tmdb_id}:${row.season}`, JSON.parse(row.json));
    } catch {
      // As above.
    }
  }
  return map;
}

/**
 * Matches one show and pulls down the seasons the library actually holds.
 *
 * Seasons are fetched on demand rather than all of them: a library with two
 * seasons of a twelve-season show has no use for the other ten, and each one is
 * a request.
 */
export async function enrichShow(
  key: string,
  title: string,
  seasons: number[],
): Promise<void> {
  if (!hasCredentials()) return;

  const existing = getTvMatches().get(key);
  let tmdbId = existing?.tmdbId;

  if (!existing) {
    try {
      const { results } = await searchTv(title);

      // A folder named "Ben 10" fits both the 2005 series and the 2016 reboot,
      // and TMDb ranks the reboot first while the original has eight times the
      // votes — so among the names that match outright, the best known one
      // wins rather than the highest ranked.
      const exact = results
        .filter((r) => plain(r.name) === plain(title))
        .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0));

      // Only worth trusting when it is the clear favourite: two comparably
      // known series of the same name are a coin toss, and a coin toss should
      // ask. Everything else is a guess and is marked as one, which is what
      // puts the search on the show page.
      const decisive =
        exact.length === 1 ||
        (exact.length > 1 &&
          (exact[0].vote_count ?? 0) >= 5 * (exact[1].vote_count ?? 0));

      const hit = exact[0] ?? results[0];
      tmdbId = hit?.id;
      saveMatch(key, {
        tmdbId,
        confidence: exact.length > 0 && decisive ? "high" : "low",
        manual: false,
      });
    } catch {
      return;
    }
  }

  if (tmdbId === undefined) return;

  try {
    if (!getShowRecords().has(tmdbId)) {
      const show = await getTvShow(tmdbId);
      db.prepare(
        "INSERT INTO tmdb_shows (tmdb_id, fetched_at, json) VALUES (?, ?, ?) ON CONFLICT(tmdb_id) DO UPDATE SET fetched_at = excluded.fetched_at, json = excluded.json",
      ).run(tmdbId, Date.now(), JSON.stringify(show));
    }

    const held = getSeasonRecords();
    for (const season of seasons) {
      if (held.has(`${tmdbId}:${season}`)) continue;
      const { episodes } = await getSeason(tmdbId, season);
      db.prepare(
        "INSERT INTO tmdb_seasons (tmdb_id, season, fetched_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(tmdb_id, season) DO UPDATE SET fetched_at = excluded.fetched_at, json = excluded.json",
      ).run(tmdbId, season, Date.now(), JSON.stringify(episodes));
    }
  } catch {
    // A show that will not load leaves its match in place and tries next scan.
  }
}

/** Records a reviewed match and drops the cached records for the old one. */
export function setManualShowMatch(key: string, tmdbId: number): void {
  saveMatch(key, { tmdbId, confidence: "high", manual: true });
}
