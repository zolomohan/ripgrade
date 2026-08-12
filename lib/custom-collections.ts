import "server-only";

import path from "node:path";

import { db } from "./db";
import type { CollectionFilm, CollectionSet } from "./collections";
import type { LibraryItem } from "./library";

/**
 * Sets you made up.
 *
 * TMDb's collections answer one question well — what a franchise contains, and
 * what of it you are missing — and cannot answer any other. "Films to watch
 * with my brother", "the 4K shelf", "the ones worth re-ripping" are all sets
 * too, and no publisher is ever going to list them.
 *
 * So the shape is deliberately the same one: a set is films you hold and films
 * you do not, and the page that draws it is the page that draws a TMDb set.
 * What differs is only where the membership comes from — a table you wrote to,
 * rather than a record fetched and cached — and that a set of your own can be
 * added to, renamed, given a backdrop, and thrown away.
 *
 * A film joins by TMDb id wherever it has one, which is what makes a set that
 * runs ahead of the drive work: add a film you do not own, rip it a month
 * later, and it moves from one shelf to the other on the next scan without
 * anybody telling it to.
 */
export type CustomSet = CollectionSet & {
  createdAt: number;
  /** The backdrop you uploaded, as a file on this machine. */
  backdrop?: string;
  /**
   * When it was last written. The name never changes, so this is what tells a
   * browser holding the old picture that it is looking at a different one —
   * the same job `artAt` does for a film. See lib/routes.ts.
   */
  backdropAt?: number;
};

/**
 * Where a set's own artwork lives.
 *
 * Beside the database rather than beside the films: a set of your own spans
 * drives, or names films that are on none of them, so there is no folder on the
 * library's side of the app that it belongs in. `data/` is this app's own
 * store — the one directory a Docker install already keeps.
 */
export const collectionDir = (id: number) =>
  path.join(process.cwd(), "data", "collections", String(id));

type SetRow = { id: number; name: string; created_at: number };

type FilmRow = {
  collection_id: number;
  film_key: string;
  tmdb_id: number | null;
  path: string | null;
  added_at: number;
  title: string;
  year: number | null;
  poster_path: string | null;
  overview: string | null;
};

/**
 * The best copy of each film the library holds, by TMDb id and by path.
 *
 * By id because that is how membership is stored, and best-first because a film
 * ripped twice is one film in a set — represented, as everywhere else in the
 * app, by the better of the two.
 */
function heldFilms(items: LibraryItem[]) {
  const byTmdbId = new Map<number, LibraryItem>();
  const byPath = new Map<string, LibraryItem>();

  for (const item of items) {
    byPath.set(item.path, item);

    const id = item.tmdb?.id;
    if (id === undefined) continue;
    const best = byTmdbId.get(id);
    if (!best || item.scores.overall > best.scores.overall) {
      byTmdbId.set(id, item);
    }
  }

  return { byTmdbId, byPath };
}

/** The copy on the drive, as a set's page wants to draw it. */
const ownedOf = (item: LibraryItem): NonNullable<CollectionFilm["owned"]> => ({
  path: item.path,
  resolution: item.resolution,
  score: item.scores.overall,
  poster: item.poster,
  // The chosen artwork's own source before the record's default, exactly as
  // the library tile falls back.
  posterSrc: item.art.poster,
  artAt: item.artAt,
});

const byYear = (a: CollectionFilm, b: CollectionFilm) =>
  (a.year ?? 0) - (b.year ?? 0);

/**
 * Splits a set's membership by what the drive actually holds.
 *
 * The stored title and poster are what a row was written with; where a copy is
 * on the drive its own record wins, because that one is kept current by the
 * scan and the row is a snapshot of the day you added it.
 */
function split(rows: FilmRow[], items: LibraryItem[]) {
  const { byTmdbId, byPath } = heldFilms(items);

  const owned: CollectionFilm[] = [];
  const missing: CollectionFilm[] = [];

  for (const row of rows) {
    const held =
      (row.tmdb_id !== null ? byTmdbId.get(row.tmdb_id) : undefined) ??
      (row.path !== null ? byPath.get(row.path) : undefined);

    const film: CollectionFilm = {
      tmdbId: row.tmdb_id ?? undefined,
      key: row.film_key,
      title: held?.tmdb?.title ?? held?.title ?? row.title,
      year: held?.tmdb?.year ?? held?.year ?? row.year ?? undefined,
      posterPath: row.poster_path ?? held?.tmdb?.posterPath,
      overview: row.overview ?? undefined,
      owned: held ? ownedOf(held) : undefined,
    };

    (film.owned ? owned : missing).push(film);
  }

  owned.sort(byYear);
  missing.sort(byYear);
  return { owned, missing };
}

/** The uploaded backdrops, read the way a film's artwork is: joined at read. */
function backdrops(ids: number[]): Map<number, { file: string; at: number }> {
  if (ids.length === 0) return new Map();

  const dirs = ids.map(collectionDir);
  const rows = db
    .prepare(
      `SELECT dir, fanart, found_at FROM artwork
        WHERE fanart IS NOT NULL AND dir IN (${dirs.map(() => "?").join(",")})`,
    )
    .all(...dirs) as { dir: string; fanart: string; found_at: number }[];

  const byDir = new Map(rows.map((row) => [row.dir, row]));

  return new Map(
    ids
      .map((id) => [id, byDir.get(collectionDir(id))] as const)
      .filter((pair): pair is [number, (typeof rows)[number]] =>
        Boolean(pair[1]),
      )
      .map(([id, row]) => [id, { file: row.fanart, at: row.found_at }]),
  );
}

const listSets = (): SetRow[] =>
  db
    .prepare("SELECT id, name, created_at FROM custom_collections ORDER BY id")
    .all() as SetRow[];

/**
 * Every set of your own, whole.
 *
 * Unlike the TMDb list, the missing half costs nothing here — it is the rows
 * you wrote, not a request to somebody's API — so it is always filled in, and
 * the list page can say how big a set is rather than only how much of it you
 * have.
 */
export function getCustomSets(items: LibraryItem[]): CustomSet[] {
  const sets = listSets();
  if (sets.length === 0) return [];

  const rows = db
    .prepare(
      "SELECT * FROM custom_collection_films ORDER BY collection_id, added_at",
    )
    .all() as FilmRow[];

  const membership = new Map<number, FilmRow[]>();
  for (const row of rows) {
    const bucket = membership.get(row.collection_id);
    if (bucket) bucket.push(row);
    else membership.set(row.collection_id, [row]);
  }

  const art = backdrops(sets.map((set) => set.id));

  return (
    sets
      .map((set) => {
        const { owned, missing } = split(membership.get(set.id) ?? [], items);
        const backdrop = art.get(set.id);
        return {
          id: set.id,
          name: set.name,
          createdAt: set.created_at,
          owned,
          missing,
          backdrop: backdrop?.file,
          backdropAt: backdrop?.at,
        };
      })
      // Newest first: a set you just made is the one you are about to fill.
      .sort((a, b) => b.createdAt - a.createdAt)
  );
}

/** One set, for its own page. */
export function getCustomSet(
  id: number,
  items: LibraryItem[],
): CustomSet | undefined {
  const set = db
    .prepare("SELECT id, name, created_at FROM custom_collections WHERE id = ?")
    .get(id) as SetRow | undefined;
  if (!set) return undefined;

  const rows = db
    .prepare(
      "SELECT * FROM custom_collection_films WHERE collection_id = ? ORDER BY added_at",
    )
    .all(id) as FilmRow[];

  const { owned, missing } = split(rows, items);
  const backdrop = backdrops([id]).get(id);

  return {
    id: set.id,
    name: set.name,
    createdAt: set.created_at,
    owned,
    missing,
    backdrop: backdrop?.file,
    backdropAt: backdrop?.at,
  };
}

export function createCustomSet(name: string): number {
  const info = db
    .prepare("INSERT INTO custom_collections (name, created_at) VALUES (?, ?)")
    .run(name, Date.now());
  return Number(info.lastInsertRowid);
}

export function renameCustomSet(id: number, name: string): void {
  db.prepare("UPDATE custom_collections SET name = ? WHERE id = ?").run(
    name,
    id,
  );
}

/**
 * Throws a set away — the list and its membership together.
 *
 * The films are untouched, which is the whole of what a set is: a set names
 * films, it does not contain them, and deleting the naming deletes nothing on
 * any drive.
 */
export function deleteCustomSet(id: number): void {
  db.transaction(() => {
    db.prepare(
      "DELETE FROM custom_collection_films WHERE collection_id = ?",
    ).run(id);
    db.prepare("DELETE FROM custom_collections WHERE id = ?").run(id);
    // The backdrop's row goes with it; the file itself is removed by the
    // caller, which is the side of the app allowed to touch the disk.
    db.prepare("DELETE FROM artwork WHERE dir = ?").run(collectionDir(id));
  })();
}

export function customSetExists(id: number): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM custom_collections WHERE id = ?").get(id),
  );
}

/** A film about to join a set, already resolved to what the row will hold. */
export type CollectionMember = {
  key: string;
  tmdbId?: number;
  path?: string;
  title: string;
  year?: number;
  posterPath?: string;
  overview?: string;
};

/**
 * Puts a film in a set, once. Adding the same film twice is not an error — it
 * is the same click landing twice — so the row is left as it was.
 */
export function addToCustomSet(id: number, film: CollectionMember): void {
  db.prepare(
    `INSERT INTO custom_collection_films
       (collection_id, film_key, tmdb_id, path, added_at, title, year, poster_path, overview)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(collection_id, film_key) DO NOTHING`,
  ).run(
    id,
    film.key,
    film.tmdbId ?? null,
    film.path ?? null,
    Date.now(),
    film.title,
    film.year ?? null,
    film.posterPath ?? null,
    film.overview ?? null,
  );
}

export function removeFromCustomSet(id: number, key: string): void {
  db.prepare(
    "DELETE FROM custom_collection_films WHERE collection_id = ? AND film_key = ?",
  ).run(id, key);
}

/**
 * Every set, and whether it holds one particular film.
 *
 * The mirror of `customSetKeys`: that answers "what is in this set" for a set's
 * own picker, and this answers "which sets is this in" for a film's own page.
 * Both are one read of a small table, so neither is worth caching.
 *
 * Newest first, matching the list page — the set you just made is the one you
 * are most likely filing something into.
 */
export function getCustomSetsHolding(
  filmKey: string,
): { id: number; name: string; holds: boolean }[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.created_at,
              EXISTS (
                SELECT 1 FROM custom_collection_films f
                 WHERE f.collection_id = c.id AND f.film_key = ?
              ) AS holds
         FROM custom_collections c
        ORDER BY c.created_at DESC, c.id DESC`,
    )
    .all(filmKey) as { id: number; name: string; holds: number }[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    holds: row.holds === 1,
  }));
}

/** Which sets a film is already in, so a picker can say so before you click. */
export function customSetKeys(id: number): Set<string> {
  const rows = db
    .prepare(
      "SELECT film_key FROM custom_collection_films WHERE collection_id = ?",
    )
    .all(id) as { film_key: string }[];
  return new Set(rows.map((row) => row.film_key));
}
