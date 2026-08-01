import "server-only";

import { db } from "./db";
import { titleKey, type Derived } from "./derive";
import { findByImdbId, getMovie, searchMovies, type TmdbMovie } from "./tmdb";

export type MatchMethod =
  | "tmdb-embedded"
  | "imdb-embedded"
  | "title-year"
  | "title-year-approx"
  | "title-only"
  | "none";

export type Confidence = "high" | "medium" | "low" | "none";

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Only high-confidence methods are trusted enough to raise runtime issues. */
export const CONFIDENCE_OF: Record<MatchMethod, Confidence> = {
  "tmdb-embedded": "high",
  "imdb-embedded": "high",
  "title-year": "high",
  "title-year-approx": "medium",
  "title-only": "low",
  none: "none",
};

const yearOf = (hit: { release_date?: string }) =>
  hit.release_date ? Number(hit.release_date.slice(0, 4)) : undefined;

/** Compares titles after the same normalisation used for duplicate grouping. */
function sameTitle(a: string, b: string) {
  return titleKey(a) === titleKey(b);
}

type Match = { tmdbId?: number; method: MatchMethod };

/**
 * Walks the ladder from strongest evidence to weakest, stopping at the first
 * hit. Container-embedded ids are exact by definition; title search is not.
 */
async function findMatch(movie: Derived): Promise<Match> {
  // Some muxers write "movie/597" into the container's extra fields.
  const embedded = movie.tmdbIdHint;
  if (embedded) return { tmdbId: embedded, method: "tmdb-embedded" };

  if (movie.imdbId) {
    const byImdb = await findByImdbId(movie.imdbId);
    if (byImdb) return { tmdbId: byImdb, method: "imdb-embedded" };
  }

  const { results } = await searchMovies(movie.title, movie.year);
  if (results.length === 0) {
    // Retry without the year: a wrongly parsed year would otherwise hide it.
    if (movie.year) {
      const loose = await searchMovies(movie.title);
      const first = loose.results[0];
      if (first) return { tmdbId: first.id, method: "title-only" };
    }
    return { method: "none" };
  }

  if (movie.year) {
    const exact = results.find(
      (r) => yearOf(r) === movie.year && sameTitle(r.title, movie.title),
    );
    if (exact) return { tmdbId: exact.id, method: "title-year" };

    const approx = results.find((r) => {
      const y = yearOf(r);
      return y !== undefined && Math.abs(y - movie.year!) <= 1;
    });
    if (approx) return { tmdbId: approx.id, method: "title-year-approx" };
  }

  const titleOnly = results.find((r) => sameTitle(r.title, movie.title));
  if (titleOnly) return { tmdbId: titleOnly.id, method: "title-year-approx" };

  // Auto-apply the best guess, clearly flagged, per the chosen policy.
  return { tmdbId: results[0].id, method: "title-only" };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function cachedMovie(id: number): TmdbMovie | undefined {
  const row = db.prepare("SELECT json FROM tmdb_movies WHERE tmdb_id = ?").get(id) as
    | { json: string }
    | undefined;
  return row ? (JSON.parse(row.json) as TmdbMovie) : undefined;
}

async function fetchAndCache(id: number): Promise<TmdbMovie> {
  const cached = cachedMovie(id);
  if (cached) return cached;

  const movie = await getMovie(id);
  db.prepare(
    `INSERT INTO tmdb_movies (tmdb_id, fetched_at, json) VALUES (?, ?, ?)
     ON CONFLICT(tmdb_id) DO UPDATE SET fetched_at = excluded.fetched_at, json = excluded.json`,
  ).run(id, Date.now(), JSON.stringify(movie));
  return movie;
}

export function getMatches(): Map<
  string,
  { tmdbId: number | null; method: MatchMethod; confidence: Confidence; manual: boolean }
> {
  const rows = db
    .prepare("SELECT path, tmdb_id, method, confidence, manual FROM tmdb_matches")
    .all() as {
    path: string;
    tmdb_id: number | null;
    method: MatchMethod;
    confidence: Confidence;
    manual: number;
  }[];

  return new Map(
    rows.map((r) => [
      r.path,
      {
        tmdbId: r.tmdb_id,
        method: r.method,
        confidence: r.confidence,
        manual: r.manual === 1,
      },
    ]),
  );
}

export function getTmdbMovies(): Map<number, TmdbMovie> {
  const rows = db.prepare("SELECT tmdb_id, json FROM tmdb_movies").all() as {
    tmdb_id: number;
    json: string;
  }[];
  return new Map(rows.map((r) => [r.tmdb_id, JSON.parse(r.json) as TmdbMovie]));
}

/** Records a correction. Manual matches survive later automatic runs. */
export async function setManualMatch(path: string, tmdbId: number): Promise<void> {
  await fetchAndCache(tmdbId);
  db.prepare(
    `INSERT INTO tmdb_matches (path, tmdb_id, method, confidence, manual, matched_at)
     VALUES (?, ?, 'manual', 'high', 1, ?)
     ON CONFLICT(path) DO UPDATE SET
       tmdb_id = excluded.tmdb_id, method = 'manual', confidence = 'high',
       manual = 1, matched_at = excluded.matched_at`,
  ).run(path, tmdbId, Date.now());
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const upsertMatch = () =>
  db.prepare(
    `INSERT INTO tmdb_matches (path, tmdb_id, method, confidence, manual, matched_at)
     VALUES (@path, @tmdb_id, @method, @confidence, 0, @matched_at)
     ON CONFLICT(path) DO UPDATE SET
       tmdb_id = excluded.tmdb_id, method = excluded.method,
       confidence = excluded.confidence, matched_at = excluded.matched_at
     WHERE tmdb_matches.manual = 0`,
  );

export type EnrichProgress = {
  total: number;
  done: number;
  matched: number;
  unmatched: number;
  needsReview: number;
  current?: string;
};

/**
 * Matches every film that does not already have one. Awaitable, because it runs
 * as the final phase of a scan rather than as its own job.
 */
export async function runEnrich(
  movies: Derived[],
  options: { refresh?: boolean; onProgress?: (p: EnrichProgress) => void } = {},
): Promise<EnrichProgress> {
  const existing = getMatches();
  const todo = options.refresh
    ? movies.filter((m) => !existing.get(m.path)?.manual)
    : movies.filter((m) => !existing.has(m.path));

  const progress: EnrichProgress = {
    total: todo.length,
    done: 0,
    matched: 0,
    unmatched: 0,
    needsReview: 0,
  };
  options.onProgress?.(progress);

  const stmt = upsertMatch();

  for (const movie of todo) {
    progress.current = movie.title;
    options.onProgress?.({ ...progress });

    let match: Match;
    try {
      match = await findMatch(movie);
    } catch (err) {
      // One bad title should not abandon the whole run — but a missing token
      // means every call will fail, so that one propagates.
      if (/TMDB_READ_TOKEN/.test(String(err))) throw err;
      match = { method: "none" };
    }

    const confidence = CONFIDENCE_OF[match.method];
    if (match.tmdbId) await fetchAndCache(match.tmdbId);

    stmt.run({
      path: movie.path,
      tmdb_id: match.tmdbId ?? null,
      method: match.method,
      confidence,
      matched_at: Date.now(),
    });

    progress.done += 1;
    if (match.tmdbId) progress.matched += 1;
    else progress.unmatched += 1;
    if (confidence === "medium" || confidence === "low") progress.needsReview += 1;
    options.onProgress?.({ ...progress });
  }

  progress.current = undefined;
  return progress;
}
