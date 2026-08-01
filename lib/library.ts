import "server-only";

import path from "node:path";

import { db } from "./db";
import { derive, titleKey, type Derived, type TmdbFacts } from "./derive";
import { getMatches, getTmdbMovies } from "./enrich";
import { decodeMovieId } from "./routes";

type ProbeRow = { path: string; size: number; mediainfo: string | null };

/**
 * Re-runs every heuristic over the stored MediaInfo output. Touches no disk and
 * no external tools, so it is cheap to call after any change to `derive.ts`.
 */
export function deriveAll(): number {
  const rows = db
    .prepare("SELECT path, size, mediainfo FROM probes WHERE mediainfo IS NOT NULL")
    .all() as ProbeRow[];

  const matches = getMatches();
  const tmdbMovies = getTmdbMovies();

  const factsFor = (path: string): TmdbFacts | undefined => {
    const match = matches.get(path);
    if (!match?.tmdbId) return undefined;

    const movie = tmdbMovies.get(match.tmdbId);
    if (!movie) return undefined;

    return {
      id: movie.id,
      title: movie.title,
      year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : undefined,
      runtimeMinutes: movie.runtime ?? undefined,
      imdbId: movie.imdb_id ?? undefined,
      collection: movie.belongs_to_collection?.name,
      genres: movie.genres?.map((g) => g.name),
      posterPath: movie.poster_path ?? undefined,
      overview: movie.overview,
      // A manual correction is authoritative; otherwise trust the match method.
      confidence: match.manual
        ? "high"
        : (match.confidence as "high" | "medium" | "low"),
    };
  };

  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO movies (path, first_seen, last_seen, present, derived)
    VALUES (@path, @now, @now, 1, @derived)
    ON CONFLICT(path) DO UPDATE SET
      last_seen = @now,
      present = 1,
      derived = excluded.derived
  `);

  const write = db.transaction((items: ProbeRow[]) => {
    for (const row of items) {
      const derived = derive(
        row.path,
        row.size,
        JSON.parse(row.mediainfo!),
        factsFor(row.path),
      );
      upsert.run({ path: row.path, now, derived: JSON.stringify(derived) });
    }
    // Anything not refreshed in this pass no longer has a probe behind it.
    db.prepare("UPDATE movies SET present = 0 WHERE last_seen < ?").run(now);
  });

  write(rows);
  return rows.length;
}

/**
 * Artwork is a filesystem fact rather than a property of the media, so it is
 * joined on at read time instead of being baked into the derived payload.
 */
export type LibraryItem = Derived & { poster?: string; fanart?: string };

export function getLibrary(): LibraryItem[] {
  const rows = db
    .prepare("SELECT derived FROM movies WHERE present = 1 ORDER BY path")
    .all() as { derived: string }[];

  const artRows = db.prepare("SELECT dir, poster, fanart FROM artwork").all() as {
    dir: string;
    poster: string | null;
    fanart: string | null;
  }[];
  const art = new Map(artRows.map((a) => [a.dir, a]));

  return rows.map((r) => {
    const derived = JSON.parse(r.derived) as Derived;
    const found = art.get(path.dirname(derived.path));
    return {
      ...derived,
      poster: found?.poster ?? undefined,
      fanart: found?.fanart ?? undefined,
    };
  });
}

export function getMovie(id: string): LibraryItem | undefined {
  let target: string;
  try {
    target = decodeMovieId(id);
  } catch {
    return undefined;
  }
  return getLibrary().find((m) => m.path === target);
}

/** The grouping key a film belongs to — also its compare-page route id. */
export const groupKeyOf = (item: Derived) => titleKey(item.title, item.year);

/** One duplicate group by its key, best copy first. Undefined if it is gone. */
export function findDuplicateGroup(key: string): LibraryItem[] | undefined {
  return duplicateGroups(getLibrary()).find(
    (group) => groupKeyOf(group[0]) === key,
  );
}

/** Films appearing more than once, keyed by title + year. */
export function duplicateGroups<T extends Derived>(items: T[]): T[][] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = titleKey(item.title, item.year);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => b.scores.overall - a.scores.overall));
}
