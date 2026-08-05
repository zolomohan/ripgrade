import "server-only";

import path from "node:path";

import { db } from "./db";
import {
  derive,
  duplicateKey,
  parseEpisode,
  titleKey,
  type Derived,
  type TmdbFacts,
} from "./derive";
import { getDiscs } from "./disc";
import { getSeasonDiscs } from "./tv-disc";
import { getDoviScans } from "./dovi";
import { getMatches, getTmdbMovies } from "./enrich";
import { decodeMovieId } from "./routes";
import { getTriage } from "./triage";

type ProbeRow = { path: string; size: number; mediainfo: string | null };

/**
 * Re-runs every heuristic over the stored MediaInfo output. Touches no disk and
 * no external tools, so it is cheap to call after any change to `derive.ts`.
 */
export function deriveAll(): number {
  const rows = db
    .prepare(
      "SELECT path, size, mediainfo FROM probes WHERE mediainfo IS NOT NULL",
    )
    .all() as ProbeRow[];

  const matches = getMatches();
  const tmdbMovies = getTmdbMovies();
  const discs = getDiscs();
  const seasonDiscs = getSeasonDiscs();
  const doviScans = getDoviScans();

  /**
   * The set an episode was released as, found without needing the show list —
   * which is itself built from these rows, so it cannot exist yet. The show key
   * and season number come straight off the filename, the same two facts
   * `getShows` groups by.
   */
  const seasonDiscFor = (filePath: string) => {
    const segments = filePath.split("/");
    const episode = parseEpisode(segments[segments.length - 1] ?? "", segments);
    return episode
      ? seasonDiscs.get(`${titleKey(episode.showTitle)}:${episode.season}`)
      : undefined;
  };

  const factsFor = (path: string): TmdbFacts | undefined => {
    const match = matches.get(path);
    if (!match?.tmdbId) return undefined;

    const movie = tmdbMovies.get(match.tmdbId);
    if (!movie) return undefined;

    return {
      id: movie.id,
      title: movie.title,
      year: movie.release_date
        ? Number(movie.release_date.slice(0, 4))
        : undefined,
      runtimeMinutes: movie.runtime ?? undefined,
      imdbId: movie.imdb_id ?? undefined,
      collection: movie.belongs_to_collection?.name,
      collectionId: movie.belongs_to_collection?.id,
      genres: movie.genres?.map((g) => g.name),
      posterPath: movie.poster_path ?? undefined,
      backdropPath: movie.backdrop_path ?? undefined,
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
      const facts = factsFor(row.path);
      // Disc data is keyed by film, so it only applies once a film is matched;
      // an episode's comes from its season instead.
      const disc =
        seasonDiscFor(row.path) ?? (facts ? discs.get(facts.id) : undefined);

      const derived = derive(
        row.path,
        row.size,
        JSON.parse(row.mediainfo!),
        facts,
        disc?.best
          ? {
              uhdExists: disc.uhdExists,
              best: { ...disc.best, audioTracks: disc.best.audio },
            }
          : disc && { uhdExists: disc.uhdExists },
        doviScans.get(row.path),
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
export type LibraryItem = Derived & {
  poster?: string;
  fanart?: string;
  /** Title treatment, when one has been downloaded or was already there. */
  logo?: string;
  /**
   * The TMDb path behind each image, where one is known — what the pages fall
   * back to when the drive is unplugged and the local file cannot be read.
   */
  art: { poster?: string; fanart?: string; logo?: string };
  /**
   * When the folder's artwork was last read from disk. The images above keep
   * their names when they are replaced, so this is what tells a browser holding
   * the old `poster.jpg` that it is looking at a different picture now.
   */
  artAt?: number;
  /** You have looked at this one and accepted it as-is, issues and all. */
  acknowledged: boolean;
  /**
   * When the file first appeared in the library. Every row inserted by one
   * `deriveAll` pass carries the same timestamp, so films added by the same
   * scan share this value exactly — which is what "added in the last scan"
   * means without needing a scan history table.
   */
  addedAt: number;
};

export function getLibrary(): LibraryItem[] {
  const rows = db
    .prepare(
      "SELECT derived, first_seen FROM movies WHERE present = 1 ORDER BY path",
    )
    .all() as { derived: string; first_seen: number }[];

  const artRows = db
    .prepare(
      "SELECT dir, poster, fanart, logo, poster_src, fanart_src, logo_src, found_at FROM artwork",
    )
    .all() as {
    dir: string;
    poster: string | null;
    fanart: string | null;
    logo: string | null;
    poster_src: string | null;
    fanart_src: string | null;
    logo_src: string | null;
    found_at: number;
  }[];
  const art = new Map(artRows.map((a) => [a.dir, a]));
  const triage = getTriage();

  return rows.map((r) => {
    const derived = JSON.parse(r.derived) as Derived;
    const found = art.get(path.dirname(derived.path));
    const decided = triage.get(derived.path);
    return {
      ...derived,
      poster: found?.poster ?? undefined,
      fanart: found?.fanart ?? undefined,
      logo: found?.logo ?? undefined,
      // Where each came from, so a page still has something to show when the
      // drive holding the file is not connected.
      art: {
        poster: found?.poster_src ?? derived.tmdb?.posterPath,
        fanart: found?.fanart_src ?? derived.tmdb?.backdropPath,
        logo: found?.logo_src ?? undefined,
      },
      artAt: found?.found_at,
      acknowledged: decided?.acknowledged ?? false,
      addedAt: r.first_seen,
    };
  });
}

/** The films. Everything movie-shaped in this app means this, not every file. */
export function getMovies(): LibraryItem[] {
  return getLibrary().filter((m) => m.kind === "movie");
}

/** The episodes, ungrouped — `lib/shows.ts` is what turns them into shows. */
export function getEpisodes(): LibraryItem[] {
  return getLibrary().filter((m) => m.kind === "episode");
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
/**
 * Every copy under a grouping key, best first — one copy included. A single
 * copy is not a duplicate, but the compare page is still the place its full
 * attribute table lives, and the second column appears by itself the moment
 * a replacement lands and is scanned.
 */
export function findDuplicateGroup(key: string): LibraryItem[] | undefined {
  const copies = getLibrary()
    .filter((item) => duplicateKey(item) === key)
    .sort((a, b) => b.scores.overall - a.scores.overall);
  return copies.length > 0 ? copies : undefined;
}

/** Films appearing more than once, keyed by title + year. */
export function duplicateGroups<T extends Derived>(items: T[]): T[][] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = duplicateKey(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => b.scores.overall - a.scores.overall));
}
