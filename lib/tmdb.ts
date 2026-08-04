import "server-only";

import { db, getSetting, setSetting } from "./db";

/**
 * Thin TMDb v3 client authenticated with a v4 read access token.
 *
 * Server-only by construction: the token must never reach a client bundle, so
 * nothing here may be imported from a "use client" module.
 */

const BASE = "https://api.themoviedb.org/3";

const TOKEN_KEY = "tmdbReadToken";

/**
 * Thrown when there is no token at all, as distinct from a call that failed.
 *
 * A class rather than a message: `enrich` aborts a whole run on this one and
 * swallows every other error, and it used to tell them apart by matching the
 * wording — which quietly stopped working the moment the wording changed.
 */
export class TmdbUnconfigured extends Error {}

/**
 * The read token, from the database and nowhere else.
 *
 * Deliberately not read from the environment: a token that lives in a file the
 * app cannot write means the one setting standing between a fresh install and
 * every title, poster and collection is the one setting it cannot ask you for.
 * There is one place it comes from, and one place to change it.
 */
export function getTmdbToken(): string | undefined {
  return getSetting(TOKEN_KEY);
}

export function setTmdbToken(token: string): void {
  setSetting(TOKEN_KEY, token.trim());
}

export function clearTmdbToken(): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(TOKEN_KEY);
}

export type TmdbMovie = {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  runtime?: number | null;
  imdb_id?: string | null;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  original_language?: string;
  vote_average?: number;
  genres?: { id: number; name: string }[];
  belongs_to_collection?: { id: number; name: string } | null;
};

export type TmdbSearchHit = {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  popularity?: number;
};

export function hasCredentials(): boolean {
  return Boolean(getTmdbToken());
}

async function api<T>(
  path: string,
  params: Record<string, string | undefined> = {},
): Promise<T> {
  const token = getTmdbToken();
  if (!token) {
    throw new TmdbUnconfigured("No TMDb token. Connect TMDb in Settings.");
  }

  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    // This data is cached in SQLite; Next's fetch cache would only duplicate it.
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `TMDb ${response.status} on ${path}${body ? ` — ${body.slice(0, 200)}` : ""}`,
    );
  }

  return (await response.json()) as T;
}

/** Full record, including the runtime and collection that search results omit. */
export function getMovie(id: number): Promise<TmdbMovie> {
  return api<TmdbMovie>(`/movie/${id}`);
}

export function searchMovies(
  title: string,
  year?: number,
): Promise<{ results: TmdbSearchHit[] }> {
  return api<{ results: TmdbSearchHit[] }>("/search/movie", {
    query: title,
    year: year ? String(year) : undefined,
    include_adult: "false",
  });
}

/** Resolves an IMDb id (many of your remuxes embed one) to a TMDb record. */
export async function findByImdbId(
  imdbId: string,
): Promise<number | undefined> {
  const found = await api<{ movie_results: { id: number }[] }>(
    `/find/${imdbId}`,
    {
      external_source: "imdb_id",
    },
  );
  return found.movie_results[0]?.id;
}

/** Verifies the token works before a full run, so failure is one clear error. */
export async function checkCredentials(): Promise<void> {
  await api("/authentication");
}

export type TmdbCollection = {
  id: number;
  name: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  parts: {
    id: number;
    title: string;
    release_date?: string;
    poster_path?: string | null;
    overview?: string;
  }[];
};

/** Every film TMDb lists as part of a collection, in release order. */
export function getCollection(id: number): Promise<TmdbCollection> {
  return api<TmdbCollection>(`/collection/${id}`);
}

// --- Television -------------------------------------------------------------

export type TmdbShow = {
  id: number;
  name: string;
  overview?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  number_of_seasons?: number;
  seasons?: { season_number: number; episode_count: number; name: string }[];
};

export type TmdbEpisode = {
  episode_number: number;
  name: string;
  overview?: string;
  air_date?: string;
  runtime?: number | null;
  still_path?: string | null;
};

export function searchTv(
  name: string,
  year?: number,
): Promise<{
  results: (TmdbShow & { popularity?: number; vote_count?: number })[];
}> {
  return api("/search/tv", {
    query: name,
    first_air_date_year: year ? String(year) : undefined,
  });
}

export function getTvShow(id: number): Promise<TmdbShow> {
  return api<TmdbShow>(`/tv/${id}`);
}

/** One season's episode list — the only place episode titles come from. */
export function getSeason(
  id: number,
  season: number,
): Promise<{ episodes: TmdbEpisode[] }> {
  return api(`/tv/${id}/season/${season}`);
}

export function getTvImages(id: number): Promise<{
  posters: TmdbImage[];
  backdrops: TmdbImage[];
  logos: TmdbImage[];
}> {
  return api(`/tv/${id}/images`, { include_image_language: "en,null" });
}

export type TmdbImage = {
  file_path: string;
  width: number;
  height: number;
  aspect_ratio: number;
  iso_639_1: string | null;
  vote_average: number;
};

/**
 * All artwork for a film. `include_image_language=null` keeps the textless
 * versions, which are usually the better backdrops.
 */
export function getImages(id: number): Promise<{
  posters: TmdbImage[];
  backdrops: TmdbImage[];
  logos: TmdbImage[];
}> {
  return api(`/movie/${id}/images`, { include_image_language: "en,null" });
}

/** TMDb file paths are always /<hash>.<ext> — anything else is not ours. */
export const isTmdbImagePath = (filePath: string) =>
  /^\/[A-Za-z0-9]+\.(jpg|jpeg|png|webp|svg)$/.test(filePath);
