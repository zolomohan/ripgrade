import "server-only";

import { audioBackupBytes, getStripJob } from "./audio-strip";
import { getConvertJob, startConvert } from "./convert";
import { classifyEnhancementLayer, convertRefusal } from "./derive";
import { getDoviJob, startFullDoviScan } from "./dovi";
import { subscribeJobs } from "./job-events";
import { getLibrary } from "./library";

/*
 * Converting a list of Profile 7 films, one after another.
 *
 * The audio queue this is the sibling of lives inside its own job — one file,
 * one tool, one ending — and could simply take the next film when the last one
 * finished. A conversion is not that shape. Half these films have never been
 * read end to end, and for those the work is two jobs in two modules: the full
 * Dolby Vision pass, which settles whether converting would clip anything, and
 * then the conversion itself. Those are the two steps the film's own page walks
 * you through by hand, and a run of twelve films is up to twenty-four of them.
 *
 * So the run is not part of either job. It sits above both and watches: every
 * job in this app announces its changes through `notifyJobs`, and this listens
 * to that and asks, each time, "is anything running, and if not, what is the
 * next thing to start". Level-triggered rather than edge-triggered on purpose —
 * the notification is coalesced and carries no payload, so a run that had to
 * catch a particular transition would eventually miss one and stop halfway. The
 * state of the world is enough to decide from, and it is always readable.
 *
 * The cost of that shape is that it cannot be cancelled from inside. Stopping
 * is the actions layer's to do — it empties the run and then kills the job —
 * which is also where the reciprocal guards for both jobs already live.
 */

export type DoviRun = {
  /** Paths still to do, in the order they were asked for. */
  waiting: string[];
  /** The film in hand, and which of its two steps is running. */
  current?: string;
  stage?: "reading" | "converting";
  total: number;
  /** How many films are behind it, whichever way they ended. */
  done: number;
  failed: number;
  /**
   * How many the full read ruled out.
   *
   * Not failures. A film whose enhancement layer turns out to hold highlights
   * the base layer cannot carry is a film that should not be converted, and the
   * run finding that out is the run working — it is the answer the check button
   * on the row exists to get. Counted apart so the page can say so.
   */
  ruledOut: number;
};

/** What the page is told about a run, which is not the same as what it needs. */
export type DoviRunState = {
  queue: string[];
  current?: string;
  index: number;
  total: number;
  failed: number;
  ruledOut: number;
};

const globalForRun = globalThis as unknown as {
  medlibDoviRun?: DoviRun;
  medlibDoviRunOff?: () => void;
};

const run = (): DoviRun | undefined => globalForRun.medlibDoviRun;

/** The run as the job stream carries it, or null when nothing is going. */
export function getDoviRun(): DoviRunState | null {
  const it = run();
  if (!it) return null;
  return {
    queue: [...it.waiting],
    current: it.current,
    // The film in hand is the one being counted, so the position is one past
    // what has ended rather than how many have.
    index: it.done + 1,
    total: it.total,
    failed: it.failed,
    ruledOut: it.ruledOut,
  };
}

/** Whether anything is using the drive these films are on. */
const working = () =>
  getDoviJob().status === "running" ||
  getConvertJob().status === "running" ||
  getStripJob().status === "running";

/** Whether this film has been read end to end, rather than sampled. */
const readFully = (path: string) =>
  getLibrary().find((movie) => movie.path === path)?.dovi?.depth === "full";

/**
 * Starts the conversion of one film, or says why it will not.
 *
 * The same checks `beginConvert` makes, made again here rather than reused
 * through it: that one is a server action and answers a click, this one answers
 * a queue, and the reason it refuses goes to a counter rather than to a
 * sentence on a page. What matters is that the rule is the same rule — a film
 * ruled out on the film's own page is ruled out here.
 */
function convertNow(path: string): boolean {
  const movie = getLibrary().find((m) => m.path === path);
  if (!movie) return false;
  if (audioBackupBytes(path) !== undefined) return false;
  if (
    convertRefusal(
      movie.dvProfile,
      classifyEnhancementLayer(movie.dovi, movie.hdr10),
    )
  ) {
    return false;
  }

  startConvert(path, {
    sourceBytes: movie.sizeBytes,
    videoBytes:
      movie.videoBitrateKbps && movie.durationSec
        ? (movie.videoBitrateKbps * 1000 * movie.durationSec) / 8
        : undefined,
  });
  return true;
}

/**
 * Puts one film into whichever of its two steps comes first.
 *
 * A film nothing has read is read first, and the conversion follows when the
 * pass comes back — see `pump`. A film that has been read converts on the spot.
 * False means neither could be started, which is a film to count and step over
 * rather than a run to abandon.
 */
function begin(it: DoviRun, path: string): boolean {
  it.current = path;

  if (!readFully(path)) {
    it.stage = "reading";
    const movie = getLibrary().find((m) => m.path === path);
    startFullDoviScan(path, movie?.durationSec);
    return getDoviJob().status === "running";
  }

  it.stage = "converting";
  return convertNow(path);
}

/**
 * Reads where the run has got to and starts whatever is next.
 *
 * Called on every job notification. Everything it decides comes from the state
 * of the two jobs and the run's own bookkeeping, so being called twice for one
 * change costs a read and nothing else.
 */
function pump(): void {
  const it = run();
  if (!it) return;
  // Something is under way — including a track removal, which is neither of
  // this run's jobs and is on the same drive.
  if (working()) return;

  // The film in hand has ended one of its steps. Which one decides whether it
  // has another to go.
  if (it.current) {
    const path = it.current;

    if (it.stage === "reading") {
      const pass = getDoviJob();
      // The pass folds its reading into the library itself, so the verdict
      // below describes this file rather than the sample it was judged on.
      if (pass.status === "done" && pass.path === path) {
        it.stage = "converting";
        if (convertNow(path)) return;
        // What the full read turned up rules the film out. Not a failure: it
        // is the answer the read was run to get.
        it.ruledOut += 1;
      } else if (pass.status === "error") {
        it.failed += 1;
      }
      // A cancelled pass counts as neither. The run is being stopped, and
      // `waiting` will already be empty — see `clearDoviRun`.
    } else if (getConvertJob().status === "error") {
      it.failed += 1;
    }

    it.done += 1;
    it.current = undefined;
    it.stage = undefined;
  }

  // And on, until one of them actually starts.
  for (;;) {
    const next = it.waiting.shift();
    if (next === undefined) {
      clearDoviRun();
      return;
    }
    if (begin(it, next)) return;
    it.failed += 1;
    it.done += 1;
    it.current = undefined;
    it.stage = undefined;
  }
}

/**
 * Starts a run over these films, in this order.
 *
 * One film is still a run of one here, unlike the audio queue's: the two-step
 * means even a single film can be a pass followed by a conversion, and that
 * hand-off is this module's whether there is anything behind it or not. The
 * page tells them apart by the total rather than by the run existing.
 */
export function startDoviRun(paths: string[]): void {
  if (run() || paths.length === 0) return;

  globalForRun.medlibDoviRun = {
    waiting: [...paths],
    total: paths.length,
    done: 0,
    failed: 0,
    ruledOut: 0,
  };
  // Only while a run is going: at rest this module listens to nothing.
  globalForRun.medlibDoviRunOff = subscribeJobs(pump);
  pump();
}

/**
 * Ends the run, leaving whatever is running to finish or be killed.
 *
 * Called before a stop rather than by one — see the note at the top. Emptying
 * the queue first is what makes stopping the job stop the run: the pump wakes,
 * finds nothing waiting, and closes it.
 */
export function clearDoviRun(): void {
  globalForRun.medlibDoviRunOff?.();
  globalForRun.medlibDoviRunOff = undefined;
  globalForRun.medlibDoviRun = undefined;
}
