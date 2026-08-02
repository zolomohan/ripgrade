import "server-only";

import { db } from "./db";

/**
 * The folders the library is made of.
 *
 * Ordered by when they were added, so the list reads as a history of the
 * library rather than shuffling whenever the filesystem feels like it.
 */
export function getLibraryRoots(): string[] {
  const rows = db
    .prepare("SELECT path FROM library_roots ORDER BY added_at")
    .all() as { path: string }[];
  return rows.map((r) => r.path);
}

export function addLibraryRoot(target: string): void {
  db.prepare(
    "INSERT INTO library_roots (path, added_at) VALUES (?, ?) ON CONFLICT(path) DO NOTHING",
  ).run(target, Date.now());
}

/**
 * Drops a folder and everything scanned from it.
 *
 * The rows have to go with it: `deriveAll` builds the library from every probe
 * it can find, so leaving them would keep films on screen from a folder the app
 * has been told to forget — and no scan would ever clear them, since nothing
 * walks that path any more.
 */
export function removeLibraryRoot(target: string): number {
  const prefix = target.endsWith("/") ? target : `${target}/`;

  const paths = (
    db.prepare("SELECT path FROM probes").all() as { path: string }[]
  )
    .map((r) => r.path)
    .filter((p) => p.startsWith(prefix));

  const dropProbe = db.prepare("DELETE FROM probes WHERE path = ?");
  const dropMovie = db.prepare("DELETE FROM movies WHERE path = ?");

  db.transaction((list: string[]) => {
    for (const p of list) {
      dropProbe.run(p);
      dropMovie.run(p);
    }
    db.prepare("DELETE FROM library_roots WHERE path = ?").run(target);
  })(paths);

  return paths.length;
}
