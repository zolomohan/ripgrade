import "server-only";

import { fetchAndCache } from "./enrich";
import {
  getImages,
  getSeason,
  getTvImages,
  getTvShow,
  hasCredentials,
  type TmdbImage,
} from "./tmdb";
import { getWishlist, type WishKind } from "./wishlist";

/**
 * A film or a series nobody here owns, gathered for a page of its own.
 *
 * Everything else in this app describes a file: the library reads what is on
 * the drive and every page is a reading of it. This is the one subject with no
 * file behind it, so every fact on its page comes from TMDb — and where TMDb
 * cannot be reached, from whatever the want list happened to store when the
 * entry was added. That fallback is the point: the list is meant to keep
 * working with no key and no network.
 */

export type DiscoverTitle = {
  kind: WishKind;
  tmdbId: number;
  title: string;
  year?: number;
  overview?: string;
  genres: string[];
  /** TMDb's own average, out of ten. Nothing to do with this app's scores. */
  rating?: number;
  /** A film's length. A series reports its seasons instead. */
  runtimeMinutes?: number;
  seasonCount?: number;
  episodeCount?: number;
  /** "Released" for a film, "Returning Series" or "Ended" for a show. */
  status?: string;
  /** The set it belongs to, where TMDb files it in one. Films only. */
  collection?: { id: number; name: string };
  /** TMDb paths — there is no folder on the drive for any of these. */
  posterPath?: string;
  backdropPath?: string;
  logoPath?: string;
  /** Already on the want list. */
  wanted: boolean;
  /** What a series is made of. Films have none. */
  seasons?: DiscoverSeason[];
};

/** One season of a series nobody here owns, as the series record lists it. */
export type DiscoverSeason = {
  number: number;
  name: string;
  episodeCount: number;
  airDate?: string;
  overview?: string;
  posterPath?: string;
};

/** One episode of one, which is the smallest thing that can be downloaded. */
export type DiscoverEpisode = {
  season: number;
  number: number;
  title: string;
  overview?: string;
  airDate?: string;
  runtimeMinutes?: number;
  stillPath?: string;
};

/**
 * TMDb returns each list best-voted first, so the first entry is its own pick.
 * A backdrop with no language on it is the textless one, which is what a hero
 * wants: the title treatment is drawn over it separately.
 */
const backdropOf = (list?: TmdbImage[]) =>
  (list?.find((image) => image.iso_639_1 === null) ?? list?.[0])?.file_path;

/**
 * Raster before vector: an SVG logo is fine in an `<img>`, but only the
 * `original` bucket serves one, and the raster versions are the ones every
 * other logo in the app is drawn from.
 */
const logoOf = (list?: TmdbImage[]) =>
  (
    list?.find((image) => !image.file_path.endsWith(".svg")) ?? list?.[0]
  )?.file_path;

const yearOf = (date?: string) =>
  date ? Number(date.slice(0, 4)) || undefined : undefined;

/**
 * The seasons as the series record lists them, emptied ones dropped.
 *
 * Season 0 goes with them. It is where TMDb files specials — the recap
 * episodes, the Christmas one-offs, the behind-the-scenes reels — and the
 * indexers do not carry it as a season: there is no "S00" pack to find, so a
 * row for it is a search that answers nothing.
 */
const seasonsOf = (show: {
  seasons?: {
    season_number: number;
    episode_count: number;
    name: string;
    overview?: string;
    air_date?: string;
    poster_path?: string | null;
  }[];
}): DiscoverSeason[] =>
  (show.seasons ?? [])
    .filter((season) => season.season_number > 0 && season.episode_count > 0)
    .map((season) => ({
      number: season.season_number,
      name: season.name,
      episodeCount: season.episode_count,
      airDate: season.air_date || undefined,
      overview: season.overview || undefined,
      posterPath: season.poster_path ?? undefined,
    }))
    .sort((a, b) => a.number - b.number);

/** The want list's copy of an entry, which is all there is without a token. */
function fromWishlist(
  kind: WishKind,
  tmdbId: number,
): DiscoverTitle | undefined {
  const entry = getWishlist().find(
    (w) => w.kind === kind && w.tmdbId === tmdbId,
  );
  if (!entry) return undefined;

  return {
    kind,
    tmdbId,
    title: entry.title,
    year: entry.year,
    overview: entry.overview,
    genres: [],
    collection: entry.collection,
    posterPath: entry.posterPath,
    wanted: true,
  };
}

const isWanted = (kind: WishKind, tmdbId: number) =>
  getWishlist().some((w) => w.kind === kind && w.tmdbId === tmdbId);

/**
 * Everything the page shows above the release list, in one call.
 *
 * The record and the artwork are asked for together: they are two requests
 * answering one question, and the images are the half a hero cannot be drawn
 * without. Artwork failing on its own is survivable — the record carries a
 * poster and a backdrop of its own — so only the record can fail the page.
 */
export async function getDiscoverTitle(
  kind: WishKind,
  tmdbId: number,
): Promise<DiscoverTitle | undefined> {
  if (!hasCredentials()) return fromWishlist(kind, tmdbId);

  try {
    if (kind === "tv") {
      const [show, art] = await Promise.all([
        getTvShow(tmdbId),
        getTvImages(tmdbId).catch(() => undefined),
      ]);

      return {
        kind,
        tmdbId,
        title: show.name,
        year: yearOf(show.first_air_date),
        overview: show.overview,
        genres: show.genres?.map((g) => g.name) ?? [],
        rating: show.vote_average,
        runtimeMinutes: show.episode_run_time?.[0],
        seasonCount: show.number_of_seasons,
        episodeCount: show.number_of_episodes,
        status: show.status,
        posterPath: show.poster_path ?? undefined,
        backdropPath:
          backdropOf(art?.backdrops) ?? show.backdrop_path ?? undefined,
        logoPath: logoOf(art?.logos),
        wanted: isWanted(kind, tmdbId),
        seasons: seasonsOf(show),
      };
    }

    // Films come through the same cache the library fills, so a film already
    // matched to something on the drive — or looked at once before — costs
    // nothing to look at again.
    const [movie, art] = await Promise.all([
      fetchAndCache(tmdbId),
      getImages(tmdbId).catch(() => undefined),
    ]);

    return {
      kind,
      tmdbId,
      title: movie.title,
      year: yearOf(movie.release_date),
      overview: movie.overview,
      genres: movie.genres?.map((g) => g.name) ?? [],
      rating: movie.vote_average,
      runtimeMinutes: movie.runtime ?? undefined,
      status: undefined,
      collection: movie.belongs_to_collection
        ? {
            id: movie.belongs_to_collection.id,
            name: movie.belongs_to_collection.name,
          }
        : undefined,
      posterPath: movie.poster_path ?? undefined,
      backdropPath:
        backdropOf(art?.backdrops) ?? movie.backdrop_path ?? undefined,
      logoPath: logoOf(art?.logos),
      wanted: isWanted(kind, tmdbId),
    };
  } catch {
    // TMDb unreachable, or an id it does not know. A wanted title still has a
    // page; anything else is genuinely nothing to show.
    return fromWishlist(kind, tmdbId);
  }
}

const episodesOf = (
  season: number,
  episodes: {
    episode_number: number;
    name: string;
    overview?: string;
    air_date?: string;
    runtime?: number | null;
    still_path?: string | null;
  }[],
): DiscoverEpisode[] =>
  episodes.map((episode) => ({
    season,
    number: episode.episode_number,
    title: episode.name,
    overview: episode.overview || undefined,
    airDate: episode.air_date || undefined,
    runtimeMinutes: episode.runtime ?? undefined,
    stillPath: episode.still_path ?? undefined,
  }));

/**
 * One season's episodes, asked for by the season being looked at.
 *
 * A season at a time rather than the lot: TMDb numbers each season its own
 * request, and a twelve-season show would be twelve of them to fill a list
 * where eleven are shut.
 */
export async function getDiscoverEpisodes(
  tmdbId: number,
  season: number,
): Promise<DiscoverEpisode[]> {
  const found = await getSeason(tmdbId, season);
  return episodesOf(season, found.episodes ?? []);
}

/**
 * A season with the series around it.
 *
 * Not a page of its own: a season is a block on the series it belongs to, so
 * this exists only for the episode below, which needs the series' artwork and
 * the season it sits in as well as the episode itself.
 */
type SeasonInContext = {
  show: DiscoverTitle;
  season: DiscoverSeason;
  episodes: DiscoverEpisode[];
};

async function getSeasonInContext(
  tmdbId: number,
  season: number,
): Promise<SeasonInContext | undefined> {
  if (!hasCredentials()) return undefined;

  const [show, found] = await Promise.all([
    getDiscoverTitle("tv", tmdbId),
    getSeason(tmdbId, season).catch(() => undefined),
  ]);
  if (!show || !found) return undefined;

  // The series record's own line for this season is the fuller one — it counts
  // the episodes — so it leads, and the season request fills what it lacks.
  const listed = show.seasons?.find((s) => s.number === season);
  const episodes = episodesOf(season, found.episodes ?? []);

  return {
    show,
    season: {
      number: season,
      name: listed?.name ?? found.name ?? `Season ${season}`,
      episodeCount: listed?.episodeCount ?? episodes.length,
      airDate: listed?.airDate ?? found.air_date ?? undefined,
      overview: listed?.overview ?? found.overview ?? undefined,
      posterPath: listed?.posterPath ?? found.poster_path ?? undefined,
    },
    episodes,
  };
}

/** One episode, with the series and the season around it. */
export type DiscoverEpisodePage = {
  show: DiscoverTitle;
  season: DiscoverSeason;
  episode: DiscoverEpisode;
};

export async function getDiscoverEpisodePage(
  tmdbId: number,
  season: number,
  episode: number,
): Promise<DiscoverEpisodePage | undefined> {
  const page = await getSeasonInContext(tmdbId, season);
  if (!page) return undefined;

  const found = page.episodes.find((e) => e.number === episode);
  if (!found) return undefined;

  return { show: page.show, season: page.season, episode: found };
}

/**
 * Just the name, for the browser tab. Kept apart from the call above so the
 * title in `<head>` does not cost a second round of artwork requests.
 */
export async function discoverTitleName(
  kind: WishKind,
  tmdbId: number,
): Promise<string | undefined> {
  const entry = getWishlist().find(
    (w) => w.kind === kind && w.tmdbId === tmdbId,
  );
  if (entry) return entry.title;
  if (!hasCredentials()) return undefined;

  try {
    return kind === "tv"
      ? (await getTvShow(tmdbId)).name
      : (await fetchAndCache(tmdbId)).title;
  } catch {
    return undefined;
  }
}
