import "server-only";

import { db } from "./db";
import { getLibrary } from "./library";
import type { Status } from "./derive";

/**
 * Films you want but do not have.
 *
 * The rest of this app describes what is on the drive. This is the one part
 * that describes what is not — so it is stored whole rather than derived from
 * anything, and nothing that happens to the library can rewrite it.
 *
 * An entry stops being a want the moment a scan matches a file to it, which is
 * the only automatic thing here: `owned` is joined on at read time from the
 * library's own TMDb matches, never written into the row.
 */
export type WishlistEntry = {
  tmdbId: number;
  title: string;
  year?: number;
  posterPath?: string;
  overview?: string;
  addedAt: number;
  /** The copy already in the library, if a scan has matched one to this film. */
  owned?: {
    path: string;
    status: Status;
    score: number;
    resolution: string;
  };
};

type Row = {
  tmdb_id: number;
  added_at: number;
  title: string;
  year: number | null;
  poster_path: string | null;
  overview: string | null;
};

export function getWishlist(): WishlistEntry[] {
  const rows = db
    .prepare("SELECT * FROM wishlist ORDER BY added_at DESC")
    .all() as Row[];

  // Best copy per film, so a duplicate does not decide which one is reported.
  const owned = new Map<number, WishlistEntry["owned"]>();
  for (const movie of getLibrary()) {
    const id = movie.tmdb?.id;
    if (id === undefined) continue;

    const existing = owned.get(id);
    if (existing && existing.score >= movie.scores.overall) continue;

    owned.set(id, {
      path: movie.path,
      status: movie.status,
      score: movie.scores.overall,
      resolution: movie.resolution,
    });
  }

  return rows.map((r) => ({
    tmdbId: r.tmdb_id,
    title: r.title,
    year: r.year ?? undefined,
    posterPath: r.poster_path ?? undefined,
    overview: r.overview ?? undefined,
    addedAt: r.added_at,
    owned: owned.get(r.tmdb_id),
  }));
}

/** Ids already on the list, so search results can say so before you click. */
export function getWishlistIds(): Set<number> {
  const rows = db.prepare("SELECT tmdb_id FROM wishlist").all() as {
    tmdb_id: number;
  }[];
  return new Set(rows.map((r) => r.tmdb_id));
}

/**
 * Adding the same film twice refreshes what TMDb says about it rather than
 * failing — the point of a second click is usually that the first entry has
 * gone stale.
 */
export function addToWishlist(entry: {
  tmdbId: number;
  title: string;
  year?: number;
  posterPath?: string;
  overview?: string;
}): void {
  db.prepare(
    `INSERT INTO wishlist (tmdb_id, added_at, title, year, poster_path, overview)
     VALUES (@tmdbId, @addedAt, @title, @year, @posterPath, @overview)
     ON CONFLICT(tmdb_id) DO UPDATE SET
       title = excluded.title,
       year = excluded.year,
       poster_path = excluded.poster_path,
       overview = excluded.overview`,
  ).run({
    tmdbId: entry.tmdbId,
    addedAt: Date.now(),
    title: entry.title,
    year: entry.year ?? null,
    posterPath: entry.posterPath ?? null,
    overview: entry.overview ?? null,
  });
}

export function removeFromWishlist(tmdbId: number): void {
  db.prepare("DELETE FROM wishlist WHERE tmdb_id = ?").run(tmdbId);
}
