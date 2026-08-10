import "server-only";

import { db } from "./db";
import { hasJackett } from "./jackett";
import { getLibrary, type LibraryItem } from "./library";
import { hasQb } from "./qbittorrent";
import { folderReachable } from "./reach";
import { getLibraryRoots } from "./roots";
import { movieId, showId } from "./routes";
import { getShows } from "./shows";
import { computeIssues, type IssueTally } from "./stats";
import { hasCredentials } from "./tmdb";
import { cleanupFiles, libraryTasks, type AudioTask } from "./queue-tasks";
import { getUpgradeQueue } from "./upgrade-sweep";
import { getWishlistFinds } from "./wishlist-search";

/**
 * What the app has to say about itself.
 *
 * The distinction this module exists to hold: `lib/stats.ts` answers "what do I
 * have", and it can do that from a list of films alone, which is why it is pure
 * and testable. This answers "what should I do about it", and that question
 * reaches the database, the drive and the clock — how long ago the last scan
 * was, whether the indexer is reachable, what is sitting in a folder waiting to
 * be deleted. None of that belongs in a file whose whole promise is that it
 * needs none of it.
 *
 * Read once, asked many times. Every function below that could go to the
 * `movies` table takes the library as an argument instead, so a page with a
 * dozen figures on it parses four hundred rows of JSON once rather than a dozen
 * times. That threading is the only reason those defaults exist.
 */

export type Dashboard = {
  now: {
    /**
     * The last time a scan wrote a row, which is when the library was true.
     *
     * Read by the page rather than drawn on it: no scan and no films is an
     * unscanned library rather than an empty one, and those get different
     * pages.
     */
    lastScanAt?: number;
    roots: { path: string; reachable: boolean }[];
  };
  /** The figures the page opens with: what the collection is, and what it costs. */
  headline: {
    /** The whole collection as one score out of 100. */
    score: number;
    films: number;
    shows: number;
    libraryBytes: number;
    /** Films scoring under 100 — short of the best copy, found or not. */
    needsUpgrade: number;
    /** Cleanup files and audio rewrites together — every byte a button frees. */
    savableBytes: number;
  };
  work: {
    upgrades: { count: number; totalGain: number };
    dovi: { count: number; bytes: number; unscanned: number; offline: number };
    audio: {
      count: number;
      bytes: number;
      estimated: boolean;
      offline: number;
    };
    issues: IssueTally;
    /** Shows with a gap, and the episodes those gaps come to. */
    showsMissing: { shows: number; episodes: number };
  };
  recent: {
    added: RecentItem[];
    finds: { count: number };
  };
  /**
   * The machine rather than the collection: what this app can reach right now.
   *
   * Everything that was ever here and is not a connection has gone the same
   * way — the match and sweep coverage bars, then the disc comparison one.
   * They were censuses: fixed for a library that has been scanned, true again
   * tomorrow, and a figure that cannot change between two visits is a fact
   * about the collection rather than a state of the machine. `computeStats`
   * owns those, and `/stats` draws them.
   *
   * The reachability of a folder belongs with this rather than with `now`
   * historically, but it is read from the same list — see `now.roots`, which
   * carries the drive alongside its path because the dashboard shows the two
   * together.
   */
  system: {
    connections: { tmdb: boolean; jackett: boolean; qb: boolean };
  };
};

/** How many posters the "recently added" shelf holds before it runs off the side. */
const RECENT = 15;

const maxOf = (sql: string): number | undefined => {
  const row = db.prepare(sql).get() as { n: number | null };
  return row.n ?? undefined;
};

export async function getDashboard(): Promise<Dashboard> {
  // The one read. Everything below is handed a slice of this.
  const library = getLibrary();
  const movies = library.filter((item) => item.kind === "movie");
  const episodes = library.filter((item) => item.kind === "episode");
  const shows = getShows(episodes);

  const tasks = libraryTasks(library);
  const cleanup = cleanupFiles(library);
  const queue = getUpgradeQueue(movies);
  const finds = getWishlistFinds();

  const roots = getLibraryRoots();

  return {
    now: {
      lastScanAt: maxOf("SELECT MAX(last_seen) AS n FROM movies"),
      roots: roots.map((path) => ({ path, reachable: folderReachable(path) })),
    },
    headline: headlineOf(movies, shows, episodes, library, cleanup, tasks),
    work: {
      upgrades: {
        count: queue.length,
        totalGain: queue.reduce((n, item) => n + item.hit.delta, 0),
      },
      dovi: {
        count: tasks.dovi.length,
        bytes: tasks.dovi.reduce((n, task) => n + task.sizeBytes, 0),
        unscanned: tasks.dovi.filter((task) => !task.scanned).length,
        offline: tasks.dovi.filter((task) => task.offline).length,
      },
      audio: audioOf(tasks.audio),
      /*
       * Films, not the whole library — because the panel's own button opens
       * `/library?f=issues`, and that shelf holds films. A count that sent you
       * to a list of a different size would be worse than no count: every
       * episode in this library is missing a logo, so folding them in turns a
       * figure about work into a figure about television having no artwork.
       *
       * A show's own problems are on its page, where a season can be read.
       */
      issues: computeIssues(movies),
      showsMissing: missingOf(shows),
    },
    recent: {
      added: recentlyAdded(movies, shows),
      finds: { count: finds.length },
    },
    system: {
      connections: {
        tmdb: hasCredentials(),
        jackett: hasJackett(),
        qb: hasQb(),
      },
    },
  };
}

/**
 * The row of figures at the top: what the collection holds, and what it costs.
 *
 * Shows rather than episodes, because a show is the thing you own — a library
 * of six series reads as three hundred and forty-two of something when it
 * counts files, which is a number about storage dressed up as a number about
 * television.
 *
 * The two kinds of space are one figure. "Reclaimable" and "audio savings" were
 * separate tiles, and nobody holds a budget for each: the question is how much
 * the drive would give back if you did everything this page suggests, and that
 * is one number. Which half it came from is on the panels below.
 *
 * "Needs upgrade" counts the library, not the queue. The queue holds the films
 * an indexer has actually offered something better for, which is a figure about
 * how well the sweep went — it drops to nothing the moment the indexers are
 * unreachable, and a collection does not improve because Jackett went down.
 * Every film short of 100 is the standing question; what the sweep found for
 * them is on the upgrade panel below.
 */
function headlineOf(
  movies: LibraryItem[],
  shows: ReturnType<typeof getShows>,
  episodes: LibraryItem[],
  library: LibraryItem[],
  cleanup: ReturnType<typeof cleanupFiles>,
  tasks: ReturnType<typeof libraryTasks>,
): Dashboard["headline"] {
  return {
    score: scoreOf([...movies, ...episodes]),
    films: movies.length,
    shows: shows.length,
    libraryBytes: library.reduce((n, item) => n + item.sizeBytes, 0),
    needsUpgrade: movies.filter((item) => item.scores.overall < 100).length,
    savableBytes:
      cleanup.reduce((n, file) => n + file.bytes, 0) +
      tasks.audio.reduce((n, task) => n + task.freedBytes, 0),
  };
}

/**
 * The whole collection as one number.
 *
 * Every file counts once — films and episodes in one pool. Not a mean of two
 * means, which would let six films you own on Blu-ray outvote four hundred
 * episodes: a library is a set of copies you hold, and this answers what the
 * average one of them is like.
 *
 * That does mean a large television collection moves the figure more than the
 * films do, and the tile carries no breakdown, so the qualification lives here:
 * it is the average copy on the drive, not the average film.
 */
function scoreOf(scored: LibraryItem[]): number {
  if (scored.length === 0) return 0;

  return Math.round(
    scored.reduce((n, item) => n + item.scores.overall, 0) / scored.length,
  );
}

/** One tile on the "recently added" shelf: a film, or a show that gained some. */
export type RecentItem = {
  /** A file's path or a show's key — its identity, and its transition name. */
  posterKey: string;
  kind: "movie" | "show";
  href: string;
  title: string;
  poster?: string;
  posterRemote?: string;
  artAt?: number;
  /** Episodes that arrived together, where the tile stands for a show. */
  episodes?: number;
  addedAt: number;
};

/**
 * The newest things in the library, newest first.
 *
 * Not the last cohort, which is what the headline figure counts. A cohort is
 * whatever one scan happened to find, so it is two files some weeks and forty
 * others — a shelf built from it is empty or overflowing for reasons that have
 * nothing to do with what you added. A fixed count off the top of the same
 * ordering always fills, and reaches back past the last scan when the last one
 * was quiet.
 *
 * A show is one tile, not forty. Adding a season used to bury every film on the
 * shelf under a run of identical posters differing only in an episode number,
 * which is the least informative thing a shelf of artwork can show — you gained
 * one thing, and the shelf reported it as twelve.
 *
 * So a show is dated by its newest episode and counts the ones that arrived
 * with it. Every row written by a single derive pass shares `addedAt` exactly,
 * so "landed together" is a precise question here rather than a window someone
 * had to choose a width for. On a library scanned for the first time that is
 * every episode held, which is the right answer there too.
 */
function recentlyAdded(
  movies: LibraryItem[],
  shows: ReturnType<typeof getShows>,
): RecentItem[] {
  const films: RecentItem[] = movies.map((item) => ({
    posterKey: item.path,
    kind: "movie",
    href: `/film/${movieId(item.path)}`,
    title: item.tmdb?.title ?? item.title,
    poster: item.poster,
    posterRemote: item.art.poster,
    artAt: item.artAt,
    addedAt: item.addedAt,
  }));

  const grouped: RecentItem[] = [];
  for (const show of shows) {
    const episodes = show.seasons.flatMap((season) =>
      season.episodes.map((e) => e.item),
    );
    if (episodes.length === 0) continue;

    const newest = episodes.reduce((n, e) => Math.max(n, e.addedAt), 0);

    grouped.push({
      posterKey: show.key,
      kind: "show",
      href: `/show/${showId(show.key)}`,
      title: show.title,
      poster: show.poster,
      posterRemote: show.art.poster,
      artAt: show.artAt,
      episodes: episodes.filter((e) => e.addedAt === newest).length,
      addedAt: newest,
    });
  }

  return [...films, ...grouped]
    .sort((a, b) => b.addedAt - a.addedAt || a.title.localeCompare(b.title))
    .slice(0, RECENT);
}

function audioOf(audio: AudioTask[]): Dashboard["work"]["audio"] {
  return {
    count: audio.length,
    bytes: audio.reduce((n, task) => n + task.freedBytes, 0),
    // One estimate anywhere in the total makes the total an estimate: a figure
    // that is partly counted and partly inferred is inferred.
    estimated: audio.some((task) => task.estimated),
    offline: audio.filter((task) => task.offline).length,
  };
}

/**
 * The gaps in the television, as two figures.
 *
 * Both are wanted, and neither stands for the other: four shows missing one
 * episode each is an evening's work, and one show missing forty is a season
 * that never arrived.
 */
function missingOf(
  shows: ReturnType<typeof getShows>,
): Dashboard["work"]["showsMissing"] {
  const gaps = shows
    .map((show) =>
      // Only where TMDb has told us how long a season runs — a gap in the
      // numbering of an unidentified show is a guess, and counting guesses as
      // absences reports a library as incomplete for not being matched yet.
      show.seasons.reduce(
        (n, season) =>
          n + (season.total === undefined ? 0 : season.missing.length),
        0,
      ),
    )
    .filter((missing) => missing > 0);

  return {
    shows: gaps.length,
    episodes: gaps.reduce((n, missing) => n + missing, 0),
  };
}
