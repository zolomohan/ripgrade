import "server-only";

import { db } from "./db";
import { getDisc } from "./disc";
import { bestUpgrade } from "./upgrades";
import { queueFilter, trim, type StoredHit } from "./upgrade-sweep";
import { getWishlist, type WishlistEntry } from "./wishlist";

/**
 * The wishlist's half of the queue.
 *
 * The upgrade sweep asks "is there something better than the copy I have"; this
 * asks the simpler question the wishlist implies — "is this film out there at
 * all" — for every want the library has not already satisfied. Same indexers,
 * same scoring, same stored shape, so a wanted film and an owned one are read
 * the same way when they meet on the queue page.
 *
 * It runs as part of a scan rather than on its own button. A scan is already
 * the moment the app goes and finds out what is true, and a want is a standing
 * question that only the outside world can answer.
 *
 * Nothing here scores against a copy: there is no copy. The prediction is the
 * release's own, and every find is a find — where the sweep stores a hit only
 * when it beats what you have, this stores the best of whatever exists.
 */

export type WishlistFind = {
  tmdbId: number;
  title: string;
  year?: number;
  posterPath?: string;
  checkedAt: number;
  hit: StoredHit;
};

/**
 * A check younger than this is not repeated, so a scan an hour after a scan
 * costs nothing at the indexers. The same window the upgrade sweep uses, for
 * the same reason: listings churn daily, not hourly.
 */
const FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * This many in a row failing is Jackett being down rather than bad luck with
 * titles, and there is no point asking a dead proxy the rest of the list.
 */
const ABORT_AFTER_FAILURES = 3;

/**
 * The wants worth searching for: everything on the list the library has not
 * already matched a file to.
 *
 * An owned entry stays on the wishlist — taking it off is yours to do — but
 * searching for it would be answering a question that has stopped being open.
 *
 * Films only. A wanted series is not one search with one best answer: it is a
 * season at a time, or an episode at a time, and which of those you want is
 * not something a background pass can decide. Shows on the list are searched by
 * hand, from the list.
 */
export function wishlistCandidates(): WishlistEntry[] {
  return getWishlist().filter(
    (entry) => entry.kind === "movie" && !entry.owned,
  );
}

export type WishlistProgress = {
  total: number;
  done: number;
  /** Wants something was found for, so far. */
  found: number;
  current?: string;
};

/**
 * Searches the indexers for every wanted film, newest want first.
 *
 * Never throws for one bad title: a film nobody is seeding is a normal answer,
 * stored as "looked, found nothing" so the next scan does not ask again within
 * the day.
 */
export async function searchWishlist(
  options: {
    onProgress?: (p: WishlistProgress) => void;
    /** Asked before each film, so a cancelled sweep stops here too. */
    shouldStop?: () => boolean;
    /** Search every want, however recently checked; see startSweep. */
    force?: boolean;
  } = {},
): Promise<WishlistProgress> {
  const checked = new Map(
    (
      db.prepare("SELECT tmdb_id, checked_at FROM wishlist_checks").all() as {
        tmdb_id: number;
        checked_at: number;
      }[]
    ).map((r) => [r.tmdb_id, r.checked_at]),
  );

  const now = Date.now();
  const stale = wishlistCandidates()
    .filter(
      (entry) =>
        options.force || now - (checked.get(entry.tmdbId) ?? 0) > FRESH_MS,
    )
    // Never-checked first, then oldest check first — the same order the sweep
    // uses, so an interrupted pass resumes where it stopped.
    .sort(
      (a, b) => (checked.get(a.tmdbId) ?? 0) - (checked.get(b.tmdbId) ?? 0),
    );

  const progress: WishlistProgress = { total: stale.length, done: 0, found: 0 };
  options.onProgress?.({ ...progress });

  const write = db.prepare(
    `INSERT INTO wishlist_checks (tmdb_id, checked_at, best)
     VALUES (?, ?, ?)
     ON CONFLICT(tmdb_id) DO UPDATE SET
       checked_at = excluded.checked_at,
       best = excluded.best`,
  );

  let failures = 0;

  for (const entry of stale) {
    // Checked before the search rather than after: what has been written stays
    // written, and the films not yet reached stay unchecked so the next run
    // picks them up.
    if (options.shouldStop?.()) {
      progress.current = undefined;
      return progress;
    }

    progress.current = entry.title;
    options.onProgress?.({ ...progress });

    try {
      // No `currentScore`: there is nothing of yours to measure against, so
      // the prediction stands on its own. The disc is still worth passing —
      // where one has been looked up, it is what makes a score mean "as good
      // as the release actually is" rather than "as good as the rubric".
      const best = await bestUpgrade({
        kind: "movie",
        title: entry.title,
        year: entry.year,
        disc: getDisc(entry.tmdbId),
      });

      write.run(
        entry.tmdbId,
        Date.now(),
        best ? JSON.stringify(trim(best)) : null,
      );

      failures = 0;
      if (best) progress.found += 1;
    } catch {
      failures += 1;
      if (failures >= ABORT_AFTER_FAILURES) {
        progress.current = undefined;
        return progress;
      }
      // One title failing leaves the entry unchecked, so the next scan
      // retries it rather than pretending it was looked at.
    }

    progress.done += 1;
    options.onProgress?.({ ...progress });
  }

  progress.current = undefined;
  return progress;
}

/**
 * Every wanted film something was found for, best predicted score first.
 *
 * Entries the library has since matched drop out on their own, exactly as an
 * upgrade does once you replace the file: the row is derived from the want and
 * the check together, and a want that has been satisfied is no longer a want.
 */
export function getWishlistFinds(): WishlistFind[] {
  const rows = db
    .prepare(
      "SELECT tmdb_id, checked_at, best FROM wishlist_checks WHERE best IS NOT NULL",
    )
    .all() as { tmdb_id: number; checked_at: number; best: string }[];

  const wanted = new Map(
    wishlistCandidates().map((entry) => [entry.tmdbId, entry]),
  );

  const passes = queueFilter();

  const finds: WishlistFind[] = [];
  for (const row of rows) {
    const entry = wanted.get(row.tmdb_id);
    if (!entry) continue; // Taken off the list, or now on the drive.

    // The queue's threshold, applied here too: a want and an upgrade sit in
    // the same list and are read the same way, so one bar governs both.
    const hit = JSON.parse(row.best) as StoredHit;
    if (!passes(hit, entry.tmdbId)) continue;

    finds.push({
      tmdbId: entry.tmdbId,
      title: entry.title,
      year: entry.year,
      posterPath: entry.posterPath,
      checkedAt: row.checked_at,
      hit,
    });
  }

  return finds.sort(
    (a, b) =>
      b.hit.score - a.hit.score ||
      (b.hit.seeders ?? 0) - (a.hit.seeders ?? 0) ||
      a.title.localeCompare(b.title),
  );
}

/** How many wants have been looked up at all, for the empty states. */
export function wishlistCheckedCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM wishlist_checks").get() as {
    n: number;
  };
  return row.n;
}
