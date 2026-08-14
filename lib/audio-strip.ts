import "server-only";

import { execFile, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  canStripAudio,
  resolvePlan,
  type ContainerTrack,
  type ResolvedPlan,
  type StripPlan,
} from "./audio-plan";
import { AUDIO_BACKUP_SUFFIX } from "./derive";
import { notifyJobs } from "./job-events";
import { ended, recordDiscardedBackup, recordRun } from "./job-history";
import { appendOutput, commandLine } from "./job-output";
import { deriveAll } from "./library";
import { compareRuntime } from "./media";
import { reprobeFile } from "./scanner";

/*
 * Dropping audio tracks from a Matroska file, by remuxing it with mkvmerge.
 *
 * A film ripped from a disc carries every language that disc was pressed with,
 * and a lossless track is the largest single thing in the file after the video
 * — often larger than the video on a 1080p remux. Removing the ones that will
 * never be played is the cheapest space this app can find, and unlike a
 * re-encode it costs nothing in quality: mkvmerge copies the streams it keeps
 * byte for byte and never touches the video, so the picture that comes out is
 * the picture that went in, Dolby Vision RPU and all.
 *
 * It is only ever asked to keep tracks, never to drop them. The plan the page
 * makes is in terms of what to remove, and this module turns that into a keep
 * list the moment it has read the container for itself — because between the
 * page being rendered and the button being pressed the file may have been
 * replaced, and a stale drop list quietly removes the wrong track while a
 * stale keep list fails loudly.
 */

const execFileAsync = promisify(execFile);

export const audioBackupPathFor = (filePath: string) =>
  filePath + AUDIO_BACKUP_SUFFIX;

/**
 * How big the untouched original beside a film is, or undefined if there isn't
 * one — existence and size in one answer, for the same reason the conversion's
 * equivalent gives: the page needs both, to offer going back and to say what
 * the option is costing.
 */
export function audioBackupBytes(filePath: string): number | undefined {
  try {
    return statSync(audioBackupPathFor(filePath)).size;
  } catch {
    return undefined;
  }
}

/**
 * mkvmerge writes Matroska whatever the output is called, so the working file
 * is deliberately not named `.mkv`: a scan running while this one does would
 * otherwise walk into a half-written film and index it as a new one.
 */
const workingPathFor = (filePath: string) => `${filePath}.audio-strip.tmp`;

// ---------------------------------------------------------------------------
// Reading the container
// ---------------------------------------------------------------------------

/**
 * What mkvmerge finds in the file, right now.
 *
 * The library's own view of the tracks comes from MediaInfo, and asking a
 * second tool to agree before rewriting anything is the point: the two number
 * tracks differently, and a plan that survives being restated in mkvmerge's
 * numbering and checked against MediaInfo's is a plan about this file rather
 * than about the page that was open when the button was pressed.
 */
export async function identify(filePath: string): Promise<ContainerTrack[]> {
  const { stdout } = await execFileAsync("mkvmerge", ["-J", filePath], {
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });

  // Parsed rather than validated, the way MediaInfo's output is: every field
  // is optional and only a few of them are read. Note that `properties.uid` is
  // a 64-bit number that does not survive JSON.parse intact, which is why the
  // small `number` is what gets checked and the uid is never read at all.
  const parsed = JSON.parse(stdout) as {
    tracks?: {
      id?: number;
      type?: string;
      codec?: string;
      properties?: { number?: number; language?: string };
    }[];
  };

  return (parsed.tracks ?? [])
    .filter((t): t is { id: number; type: string } & typeof t =>
      Number.isInteger(t.id),
    )
    .map((t) => ({
      id: t.id,
      type: t.type ?? "unknown",
      number: t.properties?.number,
      language: t.properties?.language,
      codec: t.codec,
    }));
}

/**
 * Reads the container, then hands the plan and what it found to the checks.
 *
 * Cheap — `mkvmerge -J` reads headers and not the film — so it runs before
 * anything is spawned, and a plan that no longer describes the file fails as a
 * sentence on the page rather than as a silent mis-mux.
 */
async function planFor(
  filePath: string,
  plan: StripPlan,
): Promise<ResolvedPlan> {
  if (!canStripAudio(filePath)) {
    throw new Error("Only Matroska (.mkv) files can have tracks removed.");
  }
  return resolvePlan(await identify(filePath), plan);
}

// ---------------------------------------------------------------------------
// Undoing it
// ---------------------------------------------------------------------------

/**
 * Throws away the original that still holds every track.
 *
 * Irreversible in the way the conversion's equivalent is: once this is gone,
 * the removed tracks exist only on the disc the film was ripped from. And
 * written to the job log for the same reason, in the same row — see
 * `recordDiscardedBackup`.
 */
export async function deleteAudioBackup(filePath: string): Promise<void> {
  const backup = audioBackupPathFor(filePath);
  if (!existsSync(backup)) {
    throw new Error("No backup found beside this file.");
  }
  // While there is still a file to ask.
  const bytes = audioBackupBytes(filePath);
  await rm(backup, { force: true });
  recordDiscardedBackup({
    path: filePath,
    name: path.basename(backup),
    bytes,
  });
}

/**
 * Puts every track back.
 *
 * The stripped file is deleted rather than kept, for the reason the conversion
 * gives: it is reproducible from the original in one click, and a second copy
 * of a 90 GB film is not something to leave lying around by default.
 *
 * The order is the conversion's too — aside, then in, then unlink — so the only
 * moment the film's path holds nothing is between two renames in the same
 * directory, and even that is recoverable by hand.
 */
export async function restoreAudioTracks(filePath: string): Promise<void> {
  const backup = audioBackupPathFor(filePath);
  if (!existsSync(backup)) {
    throw new Error("No original backup found beside this file.");
  }

  const aside = `${filePath}.restoring-${process.pid}`;
  await rename(filePath, aside);
  try {
    await rename(backup, filePath);
  } catch (err) {
    await rename(aside, filePath).catch(() => {});
    throw err;
  }
  await rm(aside, { force: true });

  await refreshFileFacts(filePath);
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

export type StripJob = {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  path?: string;
  /** How many audio tracks are going, and how many the film keeps. */
  removed?: number;
  kept?: number;
  /** What the removal was expected to free, as the page worked it out. */
  freedBytes?: number;
  /** What it actually freed, measured once both files are on disk. */
  actualBytes?: number;
  percent?: number;
  label?: string;
  /**
   * The mkvmerge this job spawned, written out as it could be run by hand.
   *
   * Recorded from the argument list actually handed to `spawn` rather than
   * composed for display, as the conversion's is: a keep-list of track ids is
   * the one thing about this job nobody can reconstruct afterwards, and it is
   * exactly what you want in front of you when the result is not what you
   * expected.
   */
  command?: string;
  /** The last lines mkvmerge printed — see `lib/job-output.ts`. */
  output?: string[];
  /** What the runtime comparison found, pass or fail. */
  check?: string;
  /** When it started, for the dialog's clock and the log's duration. */
  startedAt?: number;
  error?: string;
  finishedAt?: number;
  /**
   * Where this file sits in a run of them, when it is one of several.
   *
   * A removal started on its own has none of this, and reads exactly as it
   * always did. See `queueStripAudio` for why a run is a queue on the server
   * rather than a loop in a browser tab.
   */
  batch?: { index: number; total: number; failed: number };
  /**
   * The files still waiting behind this one, in the order they will run.
   *
   * Paths rather than plans: this crosses to every open page on the job stream,
   * and what a page can do with it is take those rows out of the list of work
   * still outstanding and draw them as what they are — see `JobsView`.
   */
  queue?: string[];
};

const IDLE: StripJob = { status: "idle" };

/**
 * Read from globalThis every time, for the reason the conversion's state is:
 * this module can exist more than once in one server, and a module-local copy
 * stops hearing about the job the moment a second instance appears.
 */
const globalForStrip = globalThis as unknown as {
  medlibStripAudio?: StripJob;
  medlibStripQueue?: StripQueue;
};

const current = (): StripJob => globalForStrip.medlibStripAudio ?? IDLE;

/** One file's place in a run of removals: what to do, and to what. */
export type QueuedStrip = {
  path: string;
  plan: StripPlan & { freedBytes?: number };
};

/** A run of them, and how far through it the server is. */
type StripQueue = {
  /** Still to run, in the order they were asked for. */
  waiting: QueuedStrip[];
  total: number;
  /** How many have ended, whichever way they ended. */
  done: number;
  failed: number;
};

const queue = (): StripQueue | undefined => globalForStrip.medlibStripQueue;

function setJob(next: StripJob) {
  const was = current();
  globalForStrip.medlibStripAudio = next;

  if (was.status === "running" && ended(next.status)) {
    recordRun({
      kind: "strip",
      title: next.path ? path.basename(next.path) : "Audio removal",
      path: next.path,
      outcome: next.status,
      startedAt: next.startedAt,
      finishedAt: next.finishedAt ?? Date.now(),
      command: next.command,
      detail:
        next.error ||
        [
          next.removed !== undefined && `${next.removed} tracks removed`,
          next.actualBytes !== undefined &&
            `${(next.actualBytes / 1e9).toFixed(1)} GB freed`,
          next.check,
        ]
          .filter(Boolean)
          .join(" · ") ||
        undefined,
      output: next.output,
    });

    notifyJobs();
    // After the row is written and the ending has been published, so the file
    // that just finished is a fact before the next one starts. Here rather than
    // at each of the eight places a removal can end: every one of them goes
    // through this function, and a run that stalled because one failure path
    // forgot to call it would be a queue that silently stops halfway.
    advance(next.status);
    return;
  }

  notifyJobs();
}

/**
 * Takes the next file in a run, once the one before it has ended.
 *
 * A failure does not stop the rest. One file that cannot be remuxed — a
 * container that changed under the plan, a drive that went away — is a fact
 * about that file, and twenty others that could have been done are not worth
 * abandoning for it. It is counted, written to the log like any other run, and
 * left in the list of outstanding work, which is where somebody looking for it
 * will look.
 *
 * A cancel does stop the rest: `cancelStrip` empties the queue before it kills
 * anything, so there is nothing here to take.
 */
function advance(outcome: StripJob["status"]) {
  const run = queue();
  if (!run) return;

  run.done += 1;
  if (outcome === "error") run.failed += 1;

  const next = run.waiting.shift();
  if (!next) {
    globalForStrip.medlibStripQueue = undefined;
    return;
  }
  startStripAudio(next.path, next.plan);
}

export function getStripJob(): StripJob {
  return current();
}

/** The running mkvmerge, and whether someone asked for it to stop. */
let activeChild: import("node:child_process").ChildProcess | undefined;
let cancelling = false;

/**
 * Stops a removal and clears up after it.
 *
 * Safe at any point: mkvmerge writes to a working file beside the source and
 * the source is not renamed until the mux has finished and been checked, so
 * the film is still sitting where it was and all that has to go is the partial
 * output.
 *
 * Stopping a file that is one of a run stops the run. There is one Stop button
 * and it is on the job in progress, so the other reading — stop this one and
 * carry on with the next nineteen — would be a button that looks like it
 * abandoned the work and did not. Nothing is lost by it: the films the run
 * never reached are untouched, and they go back to the list they were started
 * from to be started again.
 */
export function cancelStrip(): StripJob {
  if (current().status !== "running") return current();

  // Before the kill, so the ending that follows finds nothing to take.
  const run = queue();
  if (run) run.waiting = [];

  cancelling = true;
  if (activeChild?.pid) {
    try {
      process.kill(-activeChild.pid);
    } catch {
      activeChild.kill();
    }
  }
  return current();
}

/**
 * Re-reads the file the removal just replaced. The path is unchanged, so
 * without this the library would go on listing the tracks that are no longer
 * in it.
 */
async function refreshFileFacts(filePath: string): Promise<void> {
  await reprobeFile(filePath);
  deriveAll();
}

/** `--gui-mode` turns mkvmerge's progress into lines instead of a redrawn one. */
const PROGRESS = /#GUI#progress\s+(\d+)%/g;

/**
 * The last few lines worth showing, out of everything the tool said.
 *
 * mkvmerge is chatty on success — a line per track naming the output module it
 * picked — so the tail alone would report a failure with three lines about
 * codecs. Its own error and warning markers are preferred where there are any.
 */
function failureFrom(tail: string, code: number): string {
  const marked = [...tail.matchAll(/#GUI#(?:error|warning)\s+(.+)/g)].map((m) =>
    m[1].trim(),
  );
  const lines = marked.length
    ? marked
    : tail
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

  return lines.slice(-3).join(" ") || `mkvmerge exited ${code}`;
}

/**
 * Starts a run of removals, one file at a time.
 *
 * Sequential because the machine says so — one mkvmerge already saturates the
 * disk the films are being read from and written back to, and two of them
 * halve each other rather than adding up. Which is the same rule the app has
 * always enforced one file at a time; what this adds is that you no longer have
 * to be sitting there to answer it twenty times.
 *
 * The queue is the server's, not a loop in the page that started it. A run of
 * twenty remuxes is hours of disk, and the tab that asked for it will have been
 * closed, navigated away from or asleep long before the end — the same reason
 * every other job here is started and then followed rather than driven.
 */
export function queueStripAudio(items: QueuedStrip[]): StripJob {
  if (current().status === "running" || items.length === 0) return current();

  const [first, ...waiting] = items;
  // One file is not a run of them. Left without a queue it is the job the film
  // page and the dialog have always started, down to what the rail calls it —
  // rather than the same job wearing "1 of 1".
  globalForStrip.medlibStripQueue = waiting.length
    ? { waiting, total: items.length, done: 0, failed: 0 }
    : undefined;
  return startStripAudio(first.path, first.plan);
}

export function startStripAudio(
  filePath: string,
  plan: StripPlan & { freedBytes?: number },
): StripJob {
  if (current().status === "running") return current();

  const run = queue();

  setJob({
    status: "running",
    path: filePath,
    freedBytes: plan.freedBytes,
    percent: 0,
    label: "Reading the container",
    startedAt: Date.now(),
    // Nothing at all on a removal started on its own, so a single job reads
    // exactly as it always did rather than as "1 of 1".
    ...(run && {
      batch: { index: run.done + 1, total: run.total, failed: run.failed },
      queue: run.waiting.map((item) => item.path),
    }),
  });

  void (async () => {
    const working = workingPathFor(filePath);
    const backup = audioBackupPathFor(filePath);
    cancelling = false;

    let resolved: ResolvedPlan;
    try {
      // Nothing has been spawned yet, so a refusal here costs nothing and is
      // the last chance to catch a plan that no longer describes the file.
      if (existsSync(backup)) {
        throw new Error(
          "An original is already kept beside this film. Restore it or delete it before removing more tracks.",
        );
      }
      resolved = await planFor(filePath, plan);
    } catch (err) {
      setJob({
        ...current(),
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      });
      return;
    }

    const args = [
      "--gui-mode",
      "--output",
      path.basename(working),
      // Source-specific, so it has to precede the file it applies to. A keep
      // list rather than mkvmerge's `!`-prefixed drop list: the IDs were
      // resolved against this file a moment ago, and if any of them have
      // moved since, keeping the wrong set fails a check below while
      // dropping the wrong set would not.
      "--audio-tracks",
      resolved.keepIds.join(","),
      path.basename(filePath),
    ];
    const cwd = path.dirname(filePath);

    setJob({
      ...current(),
      removed: resolved.removedAudio,
      kept: resolved.keptAudio,
      label: "Remuxing",
      command: commandLine(cwd, "mkvmerge", args),
    });

    // Its own process group, so a cancel can take the whole of it down.
    const child = spawn("mkvmerge", args, { cwd, detached: true });
    activeChild = child;

    let tail = "";
    let output: string[] = [];
    const read = (chunk: Buffer) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-4000);
      output = appendOutput(output, text);

      // Reprinted as it climbs, so the last match in the chunk wins.
      let match: RegExpExecArray | null;
      let percent = current().percent;
      PROGRESS.lastIndex = 0;
      while ((match = PROGRESS.exec(text)) !== null) percent = Number(match[1]);

      // Published on every chunk rather than only on a progress line, so the
      // output reaches the dialog while it is being written rather than after.
      setJob({
        ...current(),
        // Held below 100 so the bar completes when the job does: the check and
        // the swap still have to happen after the last byte lands.
        percent: percent === undefined ? undefined : Math.min(99, percent),
        output,
      });
    };

    child.stdout.on("data", read);
    child.stderr.on("data", read);

    const code = await new Promise<number>((resolve) => {
      child.on("error", () => resolve(-1));
      child.on("close", (value) => resolve(value ?? -1));
    });
    activeChild = undefined;

    if (cancelling) {
      // Nothing to undo, only to sweep: the film was never renamed.
      await rm(working, { force: true });
      setJob({ ...current(), status: "cancelled", finishedAt: Date.now() });
      return;
    }

    // mkvmerge exits 1 for warnings — a file it wrote and is prepared to
    // stand behind — and 2 for a genuine failure. Only the second is one.
    if (code !== 0 && code !== 1) {
      await rm(working, { force: true });
      setJob({
        ...current(),
        status: "error",
        error: failureFrom(tail, code),
        finishedAt: Date.now(),
      });
      return;
    }

    setJob({ ...current(), percent: 99, label: "Checking the result" });

    const fail = async (message: string) => {
      await rm(working, { force: true });
      setJob({
        ...current(),
        status: "error",
        error: message,
        finishedAt: Date.now(),
      });
    };

    // Counted from the file mkvmerge actually wrote, not from what it was
    // asked to write. Both this and the runtime check run while the original
    // is still under its own name, so failing either costs only the temp file.
    try {
      const written = (await identify(working)).filter(
        (t) => t.type === "audio",
      ).length;
      if (written !== resolved.keptAudio) {
        await fail(
          `The remux came out with ${written} audio track${
            written === 1 ? "" : "s"
          } instead of ${resolved.keptAudio}. The film has not been touched.`,
        );
        return;
      }
    } catch (err) {
      await fail(
        `The remux could not be read back: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    const check = await compareRuntime(filePath, working);
    if (!check.ok) {
      await fail(`The remux finished, but ${check.message}`);
      return;
    }

    const freed = (() => {
      try {
        return statSync(filePath).size - statSync(working).size;
      } catch {
        return undefined;
      }
    })();

    // The swap. Original aside first, so the film's path is never the thing
    // that is missing if the second rename fails.
    try {
      await rename(filePath, backup);
    } catch (err) {
      await fail(
        `The film could not be moved aside: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    try {
      await rename(working, filePath);
    } catch (err) {
      await rename(backup, filePath).catch(() => {});
      await fail(
        `The remux could not be put in place: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    try {
      await refreshFileFacts(filePath);
    } catch (err) {
      // The removal itself worked, so this is not a failed job — but the
      // library is now describing a file that no longer holds what it says.
      setJob({
        ...current(),
        status: "error",
        error: `Tracks removed, but re-reading the file failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        finishedAt: Date.now(),
      });
      return;
    }

    setJob({
      ...current(),
      status: "done",
      percent: 100,
      actualBytes: freed,
      check: check.message,
      finishedAt: Date.now(),
    });
  })();

  return current();
}
