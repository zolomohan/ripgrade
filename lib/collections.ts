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
  /**
   * TMDb's number for the film, which is what a set is held together by:
   * a part you do not own becomes the copy on your drive the moment one is
   * scanned and matched to the same number.
   *
   * Absent only in a set of your own making — a film you added off the shelf
   * that TMDb never matched has no number to be known by, and is remembered by
   * its path instead. See `filmKey`.
   */
  tmdbId?: number;
  /**
   * What a set of your own filed this film under, carried through so the tile
   * can ask for it to be taken out again. Absent on a TMDb set, where the
   * number above is the only name a film has.
   */
  key?: string;
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
    /**
     * The TMDb path behind the chosen artwork — the same fallback the library
     * tile uses, so an unplugged drive shows the poster you picked rather
     * than whatever TMDb's record leads with.
     */
    posterSrc?: string;
    /** When the artwork folder was last re-indexed; busts the browser cache. */
    artAt?: number;
  };
};

export type CollectionSet = {
  id: number;
  name: string;
  /** TMDb's own artwork for the set, once it has been asked about. */
  backdropPath?: string;
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
/**
 * The held half of every set, straight from the library and costing nothing.
 * What is absent needs TMDb, and is filled in by the callers below.
 */
function ownedSets(items: LibraryItem[]): Map<number, CollectionSet> {
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
          posterSrc: item.art.poster,
          artAt: item.artAt,
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
          posterSrc: item.art.poster,
          artAt: item.artAt,
        },
      });
    }

    sets.set(id, set);
  }

  for (const set of sets.values()) {
    set.owned.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  }

  return sets;
}

/** What TMDb says the set contains, less what you hold. */
async function fillMissing(set: CollectionSet): Promise<void> {
  const collection = await fetchCollection(set.id);
  if (!collection) return;

  set.name = collection.name;
  set.backdropPath = collection.backdrop_path ?? undefined;
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
}

/** One set, with everything it is missing — the collection's own page. */
export async function getCollectionSet(
  id: number,
  items: LibraryItem[],
): Promise<CollectionSet | undefined> {
  const set = ownedSets(items).get(id);
  if (!set) return undefined;

  if (hasCredentials()) await fillMissing(set);
  return set;
}

export async function getCollectionSets(
  items: LibraryItem[],
  withMissing: boolean,
): Promise<CollectionSet[]> {
  const all = [...ownedSets(items).values()];

  if (withMissing) {
    // In parallel: these are independent, cached after the first pass, and
    // doing them in turn is what would make the page feel broken.
    await Promise.all(all.map(fillMissing));
  } else if (hasCredentials()) {
    /*
     * Otherwise only the sets holding a single film, and only to find out
     * whether they are sets at all. TMDb lists a collection the moment a sequel
     * is announced, so a film whose follow-up does not exist yet arrives here
     * as a "collection" of one — which is the film you already have, wearing a
     * franchise name. Asking is cheap: it is one lookup per single-film set,
     * cached for good, and nothing else on this page needs the network.
     */
    await Promise.all(
      all.filter((set) => set.owned.length === 1).map(fillMissing),
    );
  }

  // Incomplete sets first when we know what complete looks like: that is the
  // question this page exists to answer.
  return all
    .filter(
      // One film, and nothing else released to go and find. Where TMDb has not
      // been asked, `missing` is undefined and the set stays: not knowing is
      // not the same as knowing there is nothing.
      (set) =>
        set.owned.length > 1 ||
        set.missing === undefined ||
        set.missing.length > 0,
    )
    .sort(
      (a, b) =>
        (b.missing?.length ?? 0) - (a.missing?.length ?? 0) ||
        b.owned.length - a.owned.length ||
        a.name.localeCompare(b.name),
    );
}
