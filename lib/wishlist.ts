import "server-only";

import { db } from "./db";
import { getLibrary } from "./library";
import { getShows } from "./shows";
import { getMovie, hasCredentials } from "./tmdb";
import type { Status } from "./derive";

/**
 * Films and shows you want but do not have.
 *
 * The rest of this app describes what is on the drive. This is the one part
 * that describes what is not — so it is stored whole rather than derived from
 * anything, and nothing that happens to the library can rewrite it.
 *
 * An entry stops being a want the moment a scan matches a file to it, which is
 * the only automatic thing here — `pruneOwnedWishes` runs at the end of every
 * scan and drops it. Until that scan, `owned` is joined on at read time from
 * the library's own TMDb matches, never written into the row: it is what a
 * want looks like in the window between the file landing and the app noticing.
 */

/**
 * Which half of TMDb an entry came from. The two number their records
 * separately, so the kind is part of an entry's identity rather than a label
 * on it — see the composite key in lib/db.ts.
 */
export type WishKind = "movie" | "tv";

/**
 * What the library already holds of a want.
 *
 * A film is owned or it is not. A show is owned by degrees — some seasons, some
 * episodes — so what it says is how much of it is there, and the two shapes
 * differ because the answers do.
 */
export type WishlistOwned =
  | {
      kind: "movie";
      path: string;
      status: Status;
      score: number;
      resolution: string;
    }
  | {
      kind: "tv";
      /** The show's grouping key — `/show/{showId(key)}`. */
      showKey: string;
      score: number;
      episodeCount: number;
      seasonCount: number;
    };

export type WishlistEntry = {
  tmdbId: number;
  kind: WishKind;
  title: string;
  year?: number;
  posterPath?: string;
  overview?: string;
  addedAt: number;
  /** The set it belongs to, which is how the list groups itself. Films only. */
  collection?: { id: number; name: string };
  /** What the library holds of this, if a scan has matched anything to it. */
  owned?: WishlistOwned;
};

type Row = {
  tmdb_id: number;
  kind: string;
  added_at: number;
  title: string;
  year: number | null;
  poster_path: string | null;
  overview: string | null;
  collection_id: number | null;
  collection_name: string | null;
};

export function getWishlist(): WishlistEntry[] {
  const rows = db
    .prepare("SELECT * FROM wishlist ORDER BY added_at DESC")
    .all() as Row[];

  // Best copy per film, so a duplicate does not decide which one is reported.
  const owned = new Map<number, WishlistOwned>();
  for (const movie of getLibrary()) {
    const id = movie.tmdb?.id;
    if (id === undefined) continue;

    const existing = owned.get(id);
    if (existing && existing.score >= movie.scores.overall) continue;

    owned.set(id, {
      kind: "movie",
      path: movie.path,
      status: movie.status,
      score: movie.scores.overall,
      resolution: movie.resolution,
    });
  }

  // Built only where the list actually holds a series: rebuilding every show
  // from its episodes is not free, and most lists are all films.
  const shows = new Map<number, WishlistOwned>();
  if (rows.some((r) => r.kind === "tv")) {
    for (const show of getShows()) {
      if (show.tmdb?.id === undefined) continue;
      shows.set(show.tmdb.id, {
        kind: "tv",
        showKey: show.key,
        score: show.score,
        episodeCount: show.episodeCount,
        seasonCount: show.seasons.length,
      });
    }
  }

  return rows.map((r) => {
    const kind: WishKind = r.kind === "tv" ? "tv" : "movie";
    return {
      tmdbId: r.tmdb_id,
      kind,
      title: r.title,
      year: r.year ?? undefined,
      posterPath: r.poster_path ?? undefined,
      overview: r.overview ?? undefined,
      addedAt: r.added_at,
      collection:
        r.collection_id && r.collection_name
          ? { id: r.collection_id, name: r.collection_name }
          : undefined,
      owned: (kind === "tv" ? shows : owned).get(r.tmdb_id),
    };
  });
}

/**
 * Ids already on the list, so search results can say so before you click. Per
 * kind, because the two numberings say nothing about each other.
 */
export function getWishlistIds(kind: WishKind = "movie"): Set<number> {
  const rows = db
    .prepare("SELECT tmdb_id FROM wishlist WHERE kind = ?")
    .all(kind) as { tmdb_id: number }[];
  return new Set(rows.map((r) => r.tmdb_id));
}

/**
 * Adding the same film twice refreshes what TMDb says about it rather than
 * failing — the point of a second click is usually that the first entry has
 * gone stale.
 */
export function addToWishlist(entry: {
  tmdbId: number;
  kind?: WishKind;
  title: string;
  year?: number;
  posterPath?: string;
  overview?: string;
  collection?: { id: number; name: string };
  /** Whether TMDb has already been asked; unasked entries get backfilled. */
  collectionChecked?: boolean;
}): void {
  db.prepare(
    `INSERT INTO wishlist (tmdb_id, kind, added_at, title, year, poster_path, overview,
                           collection_id, collection_name, collection_checked)
     VALUES (@tmdbId, @kind, @addedAt, @title, @year, @posterPath, @overview,
             @collectionId, @collectionName, @collectionChecked)
     ON CONFLICT(tmdb_id, kind) DO UPDATE SET
       title = excluded.title,
       year = excluded.year,
       poster_path = excluded.poster_path,
       overview = excluded.overview,
       collection_id = excluded.collection_id,
       collection_name = excluded.collection_name,
       collection_checked = excluded.collection_checked`,
  ).run({
    tmdbId: entry.tmdbId,
    kind: entry.kind ?? "movie",
    addedAt: Date.now(),
    title: entry.title,
    year: entry.year ?? null,
    posterPath: entry.posterPath ?? null,
    overview: entry.overview ?? null,
    collectionId: entry.collection?.id ?? null,
    collectionName: entry.collection?.name ?? null,
    collectionChecked: entry.collectionChecked ? 1 : 0,
  });
}

/**
 * Fills in the collection for entries added before it was recorded, or added
 * while TMDb was unreachable.
 *
 * A search result does not carry the collection, so it takes one request per
 * film — done in small batches, once, and remembered either way. A film with no
 * collection is marked as asked rather than left blank, so it is not looked up
 * again on every visit.
 */
export async function backfillWishlistCollections(): Promise<number> {
  if (!hasCredentials()) return 0;

  const pending = db
    .prepare(
      "SELECT tmdb_id FROM wishlist WHERE kind = 'movie' AND collection_checked = 0",
    )
    .all() as { tmdb_id: number }[];
  if (pending.length === 0) return 0;

  const write = db.prepare(
    `UPDATE wishlist
        SET collection_id = ?, collection_name = ?, collection_checked = 1
      WHERE tmdb_id = ? AND kind = 'movie'`,
  );

  const BATCH = 8;
  for (let i = 0; i < pending.length; i += BATCH) {
    await Promise.all(
      pending.slice(i, i + BATCH).map(async ({ tmdb_id }) => {
        try {
          const movie = await getMovie(tmdb_id);
          const set = movie.belongs_to_collection;
          write.run(set?.id ?? null, set?.name ?? null, tmdb_id);
        } catch {
          // Left unchecked, so the next visit tries again.
        }
      }),
    );
  }

  return pending.length;
}

export function removeFromWishlist(
  tmdbId: number,
  kind: WishKind = "movie",
): void {
  db.prepare("DELETE FROM wishlist WHERE tmdb_id = ? AND kind = ?").run(
    tmdbId,
    kind,
  );

  // And what the indexers said about it, for the same reason `pruneOwnedWishes`
  // drops it: a check outlives the want it was made for, and re-adding a film
  // within the day would otherwise inherit a search made under conditions that
  // no longer hold — before its disc was known, most of all. Films only, since
  // only films are ever checked; a show's id is another film's id, so the kind
  // is what stops one list deleting the other's row.
  if (kind === "movie") {
    db.prepare("DELETE FROM wishlist_checks WHERE tmdb_id = ?").run(tmdbId);
  }
}

/**
 * Takes off the list every film the drive now holds, and returns how many
 * went.
 *
 * A want is a question, and a file is the answer to it. Marking a satisfied
 * want as owned and leaving it there made the list something you had to weed
 * by hand — and the entry it left behind was the one row on the page that
 * could not be acted on, since everything a want offers is a way to go and get
 * the film. So a scan that matches a file to a want ends the want.
 *
 * Films only. A series is owned by degrees — one episode of one season is not
 * the show — and there is no honest moment to call a want for it answered, so
 * a wanted show stays until you say otherwise.
 *
 * The stored search for it goes too. It is an answer to a question nobody is
 * asking any more, and keeping it would mean a re-added want spends its first
 * day showing what the indexers had yesterday.
 */
export function pruneOwnedWishes(): number {
  const wanted = db
    .prepare("SELECT tmdb_id FROM wishlist WHERE kind = 'movie'")
    .all() as { tmdb_id: number }[];
  if (wanted.length === 0) return 0;

  const owned = new Set<number>();
  for (const movie of getLibrary()) {
    if (movie.tmdb?.id !== undefined) owned.add(movie.tmdb.id);
  }

  const satisfied = wanted.filter((row) => owned.has(row.tmdb_id));
  if (satisfied.length === 0) return 0;

  const drop = db.prepare(
    "DELETE FROM wishlist WHERE tmdb_id = ? AND kind = 'movie'",
  );
  const dropCheck = db.prepare("DELETE FROM wishlist_checks WHERE tmdb_id = ?");

  db.transaction((rows: { tmdb_id: number }[]) => {
    for (const row of rows) {
      drop.run(row.tmdb_id);
      dropCheck.run(row.tmdb_id);
    }
  })(satisfied);

  return satisfied.length;
}
