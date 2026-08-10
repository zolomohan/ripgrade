import "server-only";

import path from "node:path";

import { db } from "./db";
import { titleKey } from "./derive";
import { getEpisodes, type LibraryItem } from "./library";
import type { DiscLookup } from "./bluray";
import { getSeasonRecords, getShowRecords, getTvMatches } from "./tv";
import { getSeasonDiscs } from "./tv-disc";

/**
 * Shows, built from the episodes on disk rather than stored.
 *
 * Nothing here is written down: a show is what its files say it is, so a
 * rescan rebuilds the whole hierarchy for free and there is no second copy of
 * the truth to fall out of step. The same approach the duplicate groups and
 * the collections page already take.
 */
/** One episode, with whatever TMDb knows about it folded in. */
export type ShowEpisode = {
  item: LibraryItem;
  number: number;
  numberEnd?: number;
  title?: string;
  overview?: string;
  airDate?: string;
  stillPath?: string;
};

/**
 * An episode the season is short of. Named where TMDb knows it, so a gap can be
 * shown in its place in the list rather than as a row of bare numbers at the
 * top — what is missing is easier to act on when you can see what it is.
 */
export type MissingEpisode = {
  number: number;
  title?: string;
  airDate?: string;
};

export type ShowSeason = {
  number: number;
  episodes: ShowEpisode[];
  /**
   * What this season is short of. Against TMDb's own episode list once the show
   * is matched, and only against the gaps inside what is held before that —
   * guessing a season's length would report every show as incomplete.
   */
  missing: MissingEpisode[];
  /** How long TMDb says the season is, when it has been asked. */
  total?: number;
  /** The disc set this season was released as, once looked up. */
  disc?: DiscLookup;
  /** The year it first aired — what tells one season's disc set from another. */
  year?: number;
};

export type Show = {
  key: string;
  title: string;
  /** The folder the show lives in — where its artwork belongs. */
  dir: string;
  seasons: ShowSeason[];
  episodeCount: number;
  sizeBytes: number;
  /** Averaged over episodes: one bad episode should not damn a whole show. */
  score: number;
  poster?: string;
  fanart?: string;
  logo?: string;
  /** The TMDb path behind each image, for when the drive is not connected. */
  art: { poster?: string; fanart?: string; logo?: string };
  /** When the folder's artwork was last read; see `artAt` on a film. */
  artAt?: number;
  tmdb?: {
    id: number;
    name: string;
    year?: number;
    overview?: string;
    /** What the series was made in, which is a film's `originalLanguage`. */
    originalLanguage?: string;
    confidence: "high" | "low";
  };
};

/**
 * The folder a show lives in, which is the one above its season folders.
 *
 * Episodes are usually filed `Show/Season 01/episode.mkv`, so the artwork
 * belongs a level up from the files — the same relationship a film has with
 * its own folder, just one deeper.
 */
const SEASON_DIR = /^(?:season[\s._-]*|s)(\d{1,2})$/i;

function showDirOf(items: LibraryItem[]): string {
  const counts = new Map<string, number>();

  for (const item of items) {
    const dir = path.dirname(item.path);
    const parent = SEASON_DIR.test(path.basename(dir))
      ? path.dirname(dir)
      : dir;
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }

  // The commonest, so one stray file in the wrong place cannot move a show.
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Only gaps *within* what is held, never a guess at the season's real length:
 * without TMDb there is no way to know whether a season ended at 10 or 13, and
 * inventing the difference would report every show as incomplete.
 */
function gapsWithin(numbers: number[]): number[] {
  if (numbers.length === 0) return [];
  const held = new Set(numbers);
  const gaps: number[] = [];
  for (let n = Math.min(...numbers); n < Math.max(...numbers); n++) {
    if (!held.has(n)) gaps.push(n);
  }
  return gaps;
}

/**
 * The episodes arrive as a defaulted parameter for the same reason the library
 * does in `lib/queue-tasks.ts`: a page that wants shows *and* films should read
 * the table once and split it, not read it twice and filter each half.
 */
export function getShows(episodes: LibraryItem[] = getEpisodes()): Show[] {
  const byShow = new Map<string, LibraryItem[]>();

  for (const item of episodes) {
    const key = titleKey(item.episode!.showTitle);
    byShow.set(key, [...(byShow.get(key) ?? []), item]);
  }

  const discs = getSeasonDiscs();
  const matches = getTvMatches();
  const records = getShowRecords();
  const seasonRecords = getSeasonRecords();

  // Artwork is a fact about a folder, so it is joined on here the same way the
  // film library joins it — the show's own folder rather than the episode's.
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

  const shows = [...byShow.entries()].map(([key, episodes]) => {
    const match = matches.get(key);
    const record = match?.tmdbId ? records.get(match.tmdbId) : undefined;

    const bySeason = new Map<number, LibraryItem[]>();
    for (const item of episodes) {
      const n = item.episode!.season;
      bySeason.set(n, [...(bySeason.get(n) ?? []), item]);
    }

    const seasons: ShowSeason[] = [...bySeason.entries()]
      .map(([number, list]) => {
        const known = match?.tmdbId
          ? seasonRecords.get(`${match.tmdbId}:${number}`)
          : undefined;

        const held = new Set(list.map((e) => e.episode!.episode));

        return {
          number,
          episodes: [...list]
            .sort((a, b) => a.episode!.episode - b.episode!.episode)
            .map((item) => {
              const n = item.episode!.episode;
              const facts = known?.find((e) => e.episode_number === n);
              return {
                item,
                number: n,
                numberEnd: item.episode!.episodeEnd,
                title: facts?.name ?? item.episode!.episodeTitle,
                overview: facts?.overview,
                airDate: facts?.air_date,
                stillPath: facts?.still_path ?? undefined,
              };
            }),
          // TMDb's list where it is known, gaps within what is held otherwise.
          missing: known
            ? known
                .filter((e) => !held.has(e.episode_number))
                .map((e) => ({
                  number: e.episode_number,
                  title: e.name,
                  airDate: e.air_date,
                }))
            : gapsWithin([...held]).map((number) => ({ number })),
          total: known?.length,
          disc: discs.get(`${key}:${number}`),
        };
      })
      .sort((a, b) => a.number - b.number);

    for (const season of seasons) season.year = seasonYear(season);

    const dir = showDirOf(episodes);
    const found = art.get(dir);

    return {
      key,
      title: record?.name ?? episodes[0].episode!.showTitle,
      dir,
      seasons,
      episodeCount: episodes.length,
      sizeBytes: episodes.reduce((n, e) => n + e.sizeBytes, 0),
      score: Math.round(
        episodes.reduce((n, e) => n + e.scores.overall, 0) / episodes.length,
      ),
      poster: found?.poster ?? undefined,
      fanart: found?.fanart ?? undefined,
      logo: found?.logo ?? undefined,
      // The series' own images stand in for a poster nobody downloaded, which
      // is also what shows when the drive is not connected.
      art: {
        poster: found?.poster_src ?? record?.poster_path ?? undefined,
        fanart: found?.fanart_src ?? record?.backdrop_path ?? undefined,
        logo: found?.logo_src ?? undefined,
      },
      artAt: found?.found_at,
      tmdb: record
        ? {
            id: record.id,
            name: record.name,
            year: record.first_air_date
              ? Number(record.first_air_date.slice(0, 4))
              : undefined,
            overview: record.overview,
            originalLanguage: record.original_language,
            confidence: match?.confidence ?? "low",
          }
        : undefined,
    };
  });

  return shows.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The year a season first aired, from whichever episode TMDb dates earliest —
 * held or missing, since a gap still knows when it went out. It is what tells
 * one season's disc set apart from another's.
 */
export function seasonYear(
  season: Pick<ShowSeason, "episodes" | "missing">,
): number | undefined {
  const dates = [
    ...season.episodes.map((e) => e.airDate),
    ...season.missing.map((m) => m.airDate),
  ]
    .filter((d): d is string => Boolean(d))
    .sort();

  return dates[0] ? Number(dates[0].slice(0, 4)) : undefined;
}

export function getShow(key: string): Show | undefined {
  return getShows().find((s) => s.key === key);
}

/**
 * The show an episode file belongs to, with the season and the episode itself.
 *
 * The file page is shared with films, which are identified one by one; an
 * episode is not, and everything TMDb knows about it hangs off its series. This
 * is how that page finds it.
 */
export function getEpisodeContext(filePath: string):
  | {
      show: Show;
      season: ShowSeason;
      episode: ShowEpisode;
      /** Its neighbours in the season, so a run can be read without going back. */
      prev?: ShowEpisode;
      next?: ShowEpisode;
    }
  | undefined {
  for (const show of getShows()) {
    for (const season of show.seasons) {
      const at = season.episodes.findIndex((e) => e.item.path === filePath);
      if (at === -1) continue;
      return {
        show,
        season,
        episode: season.episodes[at],
        prev: season.episodes[at - 1],
        next: season.episodes[at + 1],
      };
    }
  }
  return undefined;
}
