import "server-only";

import { db } from "./db";
import { hasJackett } from "./jackett";
import { getLibrary, type LibraryItem } from "./library";
import { alreadyFetching, hasQb } from "./qbittorrent";
import { folderReachable } from "./reach";
import { getLibraryRoots } from "./roots";
import { movieId, showId } from "./routes";
import { getShows } from "./shows";
import { computeIssues, type IssueTally } from "./stats";
import { hasCredentials } from "./tmdb";
import {
  cleanupFiles,
  libraryTasks,
  type AudioTask,
  type DoviTask,
  type TaskFilm,
} from "./queue-tasks";
import { keepsEnhancementLayer } from "./convert";
import { getUpgradeQueue, type UpgradeQueueItem } from "./upgrade-sweep";
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
    /**
     * Three backlogs, each with the head of its own queue.
     *
     * The counts are the whole queue; `films` is as much of it as a shelf can
     * hold, in the order the page the count links to would list them. A number
     * says how much there is and a row of artwork says what it is, and those
     * are different questions — "43 upgrades found" is a figure you either act
     * on or do not, and four posters of films you remember ripping is the thing
     * that makes you act.
     */
    upgrades: {
      count: number;
      totalGain: number;
      films: WorkFilm<UpgradeQueueItem>[];
    };
    dovi: {
      count: number;
      bytes: number;
      unscanned: number;
      offline: number;
      /**
       * Whether a conversion sets the enhancement layer aside before it drops
       * it. A setting rather than a fact about any of these files, carried here
       * because the shelf's own dialog has to say what pressing it will do —
       * see `DoviConvertConfirm` in app/dovi-convert.tsx.
       */
      keepingEl: boolean;
      films: WorkFilm<DoviTask>[];
    };
    audio: {
      count: number;
      bytes: number;
      estimated: boolean;
      offline: number;
      films: WorkFilm<AudioTask>[];
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

/**
 * One film on one of this page's shelves.
 *
 * Everything a poster needs and nothing a row would want. There is no caption
 * under a tile here — a shelf is artwork read at a glance — so the title is for
 * the tooltip and for anything that cannot see a picture, and it carries the
 * episode's number where the file is an episode, because a show's poster twelve
 * times over says nothing about which twelve.
 *
 * `figure` is whatever the queue behind the shelf is ordered by, unformatted:
 * the score a better copy would add, the size of a conversion, the bytes a
 * rewrite would give back. Which of those it is, and how it reads, belongs to
 * the shelf drawing it — this module does not know what a gigabyte looks like.
 */
export type WorkFilm<T> = {
  /** The file's path: React's key here, and the film's identity everywhere. */
  posterKey: string;
  href: string;
  title: string;
  poster?: string;
  posterRemote?: string;
  artAt?: number;
  figure: number;
  /**
   * True where `figure` is bitrate × runtime rather than a measurement — the
   * audio queue's own distinction, drawn as ≈ against − wherever it is printed.
   */
  estimated?: boolean;
  /**
   * The queue's own record of this film, whole, for the dialog the poster
   * opens.
   *
   * A tile on this page used to be a link to the film, so eight fields were
   * everything it could ever need. Clicking one now opens the same dialog the
   * queue's own page opens — the release the sweep found, the conversion, the
   * tracks to remove — and every one of those is a question about the record
   * rather than about the film: which magnet, which enhancement layer, which
   * nine of eighteen audio tracks. None of that can be re-derived on the
   * client, and asking the server for it a second time on the click would put a
   * round trip between the press and the panel.
   *
   * So the shelf carries what it is a shelf *of*. Fifteen of them per queue,
   * already read on this request — see `getDashboard`, where all three lists
   * are computed whether or not anybody opens one.
   */
  item: T;
};

/** How many posters a shelf on this page holds before it runs off the side. */
const SHELF = 15;

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

  /*
   * What is already coming does not need fetching again.
   *
   * The same cut `/library` and `/wishlist` make, and it has to be made here
   * too or the front page contradicts the two pages its figures link to: a
   * release sent to qBittorrent leaves both of those lists the moment it is
   * sent, and this one went on counting it — "43 upgrades found" over a shelf
   * whose first poster was a film already downloading, and a figure you could
   * not make go down by doing the thing it was asking for.
   *
   * It is also the half of cancelling that is easy to miss. `alreadyFetching`
   * reads a fetch that never finished and is no longer in the client as one
   * that was called off, so cancelling a download puts the film back on the
   * lists it left — and this page is one of them.
   */
  const fetching = await alreadyFetching();
  const queue = getUpgradeQueue(movies).filter(
    (item) => !fetching({ title: item.title, magnet: item.hit.magnet }),
  );
  const finds = getWishlistFinds().filter(
    (find) => !fetching({ title: find.title, magnet: find.hit.magnet }),
  );

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
        // The queue's own order, which is not the gain: `getUpgradeQueue` puts
        // the releases that would finish a film off the hunt first. The shelf
        // is the head of that queue rather than a ranking of its own.
        films: queue.slice(0, SHELF).map((item) => ({
          posterKey: item.path,
          href: `/film/${movieId(item.path)}`,
          title: item.title,
          poster: item.poster,
          posterRemote: item.posterRemote,
          artAt: item.artAt,
          figure: item.hit.delta,
          item,
        })),
      },
      dovi: {
        count: tasks.dovi.length,
        bytes: tasks.dovi.reduce((n, task) => n + task.sizeBytes, 0),
        unscanned: tasks.dovi.filter((task) => !task.scanned).length,
        offline: tasks.dovi.filter((task) => task.offline).length,
        keepingEl: keepsEnhancementLayer(),
        films: shelfOf(tasks.dovi, (task) => task.sizeBytes),
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
    .slice(0, SHELF);
}

function audioOf(audio: AudioTask[]): Dashboard["work"]["audio"] {
  return {
    count: audio.length,
    bytes: audio.reduce((n, task) => n + task.freedBytes, 0),
    // One estimate anywhere in the total makes the total an estimate: a figure
    // that is partly counted and partly inferred is inferred.
    estimated: audio.some((task) => task.estimated),
    offline: audio.filter((task) => task.offline).length,
    films: shelfOf(audio, (task) => task.freedBytes, (task) => task.estimated),
  };
}

/**
 * The head of a job queue as posters.
 *
 * Both lists arrive sorted by the figure they are about — biggest conversion,
 * biggest saving — so the shelf is a slice off the front rather than a second
 * ordering. Written once for the two of them because the only thing that
 * differs is which number the tile prints.
 *
 * An episode's number joins the show's title. The poster is the series' — every
 * episode of a show borrows it, so nine tiles of the same artwork is a normal
 * shelf here, and the only thing that tells them apart is what the tooltip and
 * the screen reader are given.
 */
function shelfOf<T extends TaskFilm>(
  tasks: T[],
  figure: (task: T) => number,
  estimated?: (task: T) => boolean,
): WorkFilm<T>[] {
  return tasks.slice(0, SHELF).map((task) => ({
    posterKey: task.path,
    // The film's page, or the episode's — the jobs page's own rule for where a
    // row leads, and the same one because it is the same file.
    href: `/${task.kind === "movie" ? "film" : "episode"}/${movieId(task.path)}`,
    title: task.episodeCode ? `${task.title} ${task.episodeCode}` : task.title,
    poster: task.poster,
    posterRemote: task.posterRemote,
    artAt: task.artAt,
    figure: figure(task),
    estimated: estimated?.(task),
    item: task,
  }));
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
