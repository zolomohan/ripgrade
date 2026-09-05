import type { ShelfItem } from "./library";

/**
 * What a whole show amounts to.
 *
 * This lives here rather than on the shelf that first needed it because two
 * places ask it now — `/library`'s shows tab groups by it, and `/stats` counts
 * it — and a verdict computed twice is a verdict that will eventually be
 * computed two ways. Nothing in here touches the database, so the shelf can
 * import it into the browser.
 *
 * Type-only imports for the same reason: `lib/shows.ts` reads SQLite the moment
 * it is evaluated, and the shelf is a client component.
 */

/**
 * What these readings actually need of a show, rather than which type it is.
 *
 * There are two shapes of show now — the whole one the show's own page is
 * built from, and the trimmed one the shelf is handed (see `ShelfShow` in
 * lib/shows.ts) — and every function here works on both, because none of them
 * reads a field the trim drops. Saying that structurally rather than naming
 * one of the two is what makes it true rather than merely currently true, and
 * it is the same claim the header makes about the database: this module needs
 * a season and an episode, not an import.
 */
export type ShowLike<E = ShelfItem> = {
  seasons: {
    episodes: { item: E }[];
    /** Counted, never read into — see `showGaps`. */
    missing: unknown[];
    total?: number;
  }[];
};

/** One episode's file, which is what every reading below is actually of. */
export const episodesOf = <E>(show: ShowLike<E>): E[] =>
  show.seasons.flatMap((season) => season.episodes.map((e) => e.item));

/**
 * Episodes a season is short of, counted only where TMDb has said how long the
 * season runs. Before that a gap in the numbering is a guess, and counting
 * guesses as absences reports a library as incomplete for the crime of not
 * being identified yet.
 */
export const showGaps = (show: ShowLike<unknown>): number =>
  show.seasons.reduce(
    (n, season) => n + (season.total === undefined ? 0 : season.missing.length),
    0,
  );

/**
 * The buckets, worst first — the order the shelf stacks its sections in and the
 * order the chart draws its columns in.
 */
export const SHOW_VERDICT_ORDER = [
  "Missing episodes",
  "Must upgrade",
  "Upgrade recommended",
  "Best available",
  "Not compared to a disc",
] as const;

/**
 * The show's verdict, which is the worst of its episodes'.
 *
 * A show has no status of its own — every reading in this app is of a file, and
 * a show is a folder of them. Averaging them would be the wrong answer twice
 * over: it invents a verdict no episode holds, and it lets twenty good files
 * bury the one that needs doing. So the worst episode speaks for the run, the
 * way the film shelf's own verdict is the worst thing true of that film.
 *
 * Above all of it sits the gap. The films lead with "Upgrades found" because a
 * release actually waiting outranks every opinion under it; a show's equivalent
 * is an episode that is not there — not a reading of a file at all, but a hole
 * where one should be, and the only bucket here you can finish. It also has to
 * outrank "Best available", because a season short of three episodes is not the
 * best available copy of anything, however good the files present are.
 */
export function showVerdict(
  show: ShowLike<Pick<ShelfItem, "status" | "disc">>,
): (typeof SHOW_VERDICT_ORDER)[number] {
  if (showGaps(show) > 0) return "Missing episodes";

  const episodes = episodesOf(show);
  if (episodes.some((e) => e.status === "Must Upgrade")) return "Must upgrade";
  if (
    episodes.some(
      (e) => e.status === "Upgrade Recommended" || e.status === "Good",
    )
  )
    return "Upgrade recommended";
  // The film shelf's rule, held to across a whole run: without a disc to
  // measure every episode against we cannot claim the show is the best there
  // is, so it is held apart rather than quietly counted as fine.
  if (!episodes.length || !episodes.every((e) => e.disc?.discScore))
    return "Not compared to a disc";
  return "Best available";
}

/**
 * The one value a whole show can be said to have, or "Mixed".
 *
 * A format is claimed for a show only when every episode has it — "Dolby
 * Vision" on a run where one episode is SDR would be a lie, and that one
 * episode is exactly what you are looking for.
 */
export const shared = <E>(
  show: ShowLike<E>,
  of: (episode: E) => string | undefined,
): string => {
  const values = new Set(episodesOf(show).map((e) => of(e) ?? "Unknown"));
  return values.size === 1
    ? [...values][0]
    : values.size === 0
      ? "Unknown"
      : "Mixed";
};
