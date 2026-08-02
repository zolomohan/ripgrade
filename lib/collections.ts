import "server-only";

import { db } from "./db";
import type { LibraryItem } from "./library";
import { getCollection, hasCredentials, type TmdbCollection } from "./tmdb";

/**
 * Collections, as sets rather than as a grouping.
 *
 * The library can already group by collection, but grouping can only show what
 * you have. A set is more interesting for what is absent from it, and that
 * needs TMDb's own list of the parts — cached here permanently, because a
 * finished series does not gain films and refetching is someone else's
 * bandwidth.
 */
export type CollectionFilm = {
  tmdbId: number;
  title: string;
  year?: number;
  posterPath?: string;
  overview?: string;
  /**
   * The copy in the library, when this one is not missing — including the
   * artwork sitting beside it on disk, which is the poster you chose.
   */
  owned?: {
    path: string;
    resolution: string;
    score: number;
    poster?: string;
  };
};

export type CollectionSet = {
  id: number;
  name: string;
  /** Films you hold, always. */
  owned: CollectionFilm[];
  /**
   * The rest of the set, once TMDb has been asked. Undefined means not asked —
   * which is different from "nothing missing" and is shown differently.
   */
  missing?: CollectionFilm[];
};

function cached(id: number): TmdbCollection | undefined {
  const row = db
    .prepare("SELECT json FROM tmdb_collections WHERE tmdb_id = ?")
    .get(id) as { json: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.json) as TmdbCollection;
  } catch {
    return undefined;
  }
}

/** Fetches a collection once and remembers it. Null when TMDb refuses. */
export async function fetchCollection(
  id: number,
): Promise<TmdbCollection | undefined> {
  const stored = cached(id);
  if (stored) return stored;
  if (!hasCredentials()) return undefined;

  try {
    const collection = await getCollection(id);
    db.prepare(
      "INSERT INTO tmdb_collections (tmdb_id, fetched_at, json) VALUES (?, ?, ?) ON CONFLICT(tmdb_id) DO UPDATE SET fetched_at = excluded.fetched_at, json = excluded.json",
    ).run(id, Date.now(), JSON.stringify(collection));
    return collection;
  } catch {
    // A collection that will not load should not take the page with it.
    return undefined;
  }
}

const year = (date?: string) =>
  date ? Number(date.slice(0, 4)) || undefined : undefined;

/**
 * TMDb lists a collection's future as well as its past — announced sequels,
 * films with a date years out, and entries with no date at all. None of those
 * are gaps in a collection; they are films nobody has. A missing entry should
 * be something you could actually go and get.
 */
function released(date?: string): boolean {
  if (!date) return false;
  return date.slice(0, 10) <= new Date().toISOString().slice(0, 10);
}

/**
 * Every collection the library touches, best copy per film.
 *
 * `withMissing` is what costs something: one request per collection the first
 * time, nothing afterwards. Without it this is a pure read of what is on disk.
 */
export async function getCollectionSets(
  items: LibraryItem[],
  withMissing: boolean,
): Promise<CollectionSet[]> {
  const sets = new Map<number, CollectionSet>();

  for (const item of items) {
    const id = item.tmdb?.collectionId;
    if (id === undefined || !item.tmdb) continue;

    const set = sets.get(id) ?? {
      id,
      name: item.tmdb.collection ?? "Collection",
      owned: [],
    };

    // A duplicate film should appear once, represented by its best copy.
    const existing = set.owned.find((f) => f.tmdbId === item.tmdb!.id);
    if (existing) {
      if (item.scores.overall > (existing.owned?.score ?? 0)) {
        existing.owned = {
          path: item.path,
          resolution: item.resolution,
          score: item.scores.overall,
          poster: item.poster,
        };
      }
    } else {
      set.owned.push({
        tmdbId: item.tmdb.id,
        title: item.tmdb.title,
        year: item.tmdb.year,
        posterPath: item.tmdb.posterPath,
        owned: {
          path: item.path,
          resolution: item.resolution,
          score: item.scores.overall,
          poster: item.poster,
        },
      });
    }

    sets.set(id, set);
  }

  const all = [...sets.values()];

  if (withMissing) {
    // In parallel: these are independent, cached after the first pass, and
    // doing them in turn is what would make the page feel broken.
    await Promise.all(
      all.map(async (set) => {
        const collection = await fetchCollection(set.id);
        if (!collection) return;

        set.name = collection.name;
        const held = new Set(set.owned.map((f) => f.tmdbId));
        set.missing = collection.parts
          .filter((part) => !held.has(part.id) && released(part.release_date))
          .map((part) => ({
            tmdbId: part.id,
            title: part.title,
            year: year(part.release_date),
            posterPath: part.poster_path ?? undefined,
            overview: part.overview,
          }))
          .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
      }),
    );
  }

  for (const set of all) {
    set.owned.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  }

  // Incomplete sets first when we know what complete looks like: that is the
  // question this page exists to answer.
  return all.sort(
    (a, b) =>
      (b.missing?.length ?? 0) - (a.missing?.length ?? 0) ||
      b.owned.length - a.owned.length ||
      a.name.localeCompare(b.name),
  );
}
