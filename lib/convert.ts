import "server-only";

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";

import { getSetting } from "./db";
import { BACKUP_SUFFIX, EL_ARCHIVE_SUFFIX } from "./derive";
import { scanDovi } from "./dovi";
import { ended, recordRun } from "./job-history";
import { appendOutput, commandLine } from "./job-output";
import { notifyJobs } from "./job-events";
import { compareRuntime } from "./media";
import { deriveAll } from "./library";
import { reprobeFile } from "./scanner";

/*
 * Running the Profile 7 → 8.1 conversion, by handing the whole job to
 * dovi_convert rather than driving ffmpeg and dovi_tool ourselves.
 *
 * The reason to shell out to it rather than reimplement it: it runs the same
 * brightness check this app does and refuses a complex FEL on its own, it
 * renames the original aside rather than deleting anything, and it verifies the
 * result before declaring success. Three safeguards we would otherwise have to
 * write and get right.
 *
 * The converted file takes the original's path, so afterwards every fact this
 * app holds about that path describes a file that is no longer there — which is
 * what `refreshFileFacts` is for, and why both converting and restoring end
 * with a call to it.
 *
 * The same tool is also what walks the conversion back. Given `--backup` it
 * writes the enhancement layer out to a `.dovi` archive beside the film before
 * discarding it, and `dovi_convert restore` interleaves that archive back into
 * the base layer to rebuild the Profile 7 file. That is the second job in this
 * module, and it shares the first one's state deliberately: they rewrite the
 * same film with the same tool on the same drive, and only one of them can be
 * happening at a time.
 */

export const backupPathFor = (filePath: string) => filePath + BACKUP_SUFFIX;

/**
 * How big the untouched original beside a film is, or undefined if there isn't
 * one. Size and existence in one answer, because the page needs both: whether
 * to offer going back, and how much keeping that option is costing.
 */
export function backupBytes(filePath: string): number | undefined {
  try {
    return statSync(backupPathFor(filePath)).size;
  } catch {
    return undefined;
  }
}

/**
 * Whether the film is where the library says it is.
 *
 * `backupBytes` cannot tell "there is no backup beside it" from "the drive it
 * lives on is not plugged in" — both are a stat that throws. This separates
 * them, so a page can say the drive is away instead of quietly describing a
 * converted film as one that was never converted and offering to read frames
 * it cannot reach.
 */
export const filePresent = (filePath: string) => existsSync(filePath);

/**
 * Throws away the pre-conversion original.
 *
 * The one genuinely irreversible action here. Everything else this module does
 * can be undone by converting again or restoring; once this file is gone, the
 * Profile 7 version of the film only exists on the disc it came from.
 */
export async function deleteBackup(filePath: string): Promise<void> {
  const backup = backupPathFor(filePath);
  if (!existsSync(backup)) {
    throw new Error("No backup found beside this file.");
  }
  await rm(backup, { force: true });
}

/**
 * Puts the original back.
 *
 * The converted file is deleted rather than kept: it is reproducible from the
 * original in one click, whereas a second copy of a 90 GB film is not something
 * to leave lying around by default.
 *
 * The order matters. Moving the converted file aside first and unlinking it
 * last means the only moment the film's path holds nothing is between two
 * renames in the same directory — atomic, and recoverable by hand from the
 * backup even then.
 */
export async function restoreOriginal(filePath: string): Promise<void> {
  const backup = backupPathFor(filePath);
  if (!existsSync(backup)) {
    throw new Error("No original backup found beside this file.");
  }

  const aside = `${filePath}.restoring-${process.pid}`;
  await rename(filePath, aside);
  try {
    await rename(backup, filePath);
  } catch (err) {
    // Put it back rather than leaving the film missing entirely.
    await rename(aside, filePath).catch(() => {});
    throw err;
  }
  await rm(aside, { force: true });

  await refreshFileFacts(filePath);
}

// ---------------------------------------------------------------------------
// The enhancement layer, kept aside
// ---------------------------------------------------------------------------

/**
 * Where the discarded enhancement layer lives, when it was kept.
 *
 * The extension is replaced rather than appended — dovi_convert's convention,
 * and the one it looks the archive up under when restoring, so this has to
 * match it exactly.
 */
export const elArchivePathFor = (filePath: string) =>
  filePath.replace(/\.[^.]+$/, "") + EL_ARCHIVE_SUFFIX;

/** How big the kept enhancement layer is, or undefined if there isn't one. */
export const elArchiveBytes = (filePath: string) =>
  sizeOf(elArchivePathFor(filePath));

/** The setting behind it, and the one place its value is spelled. */
export const KEEP_EL_KEY = "keepEnhancementLayer";

/**
 * Whether a conversion should keep the layer it is about to throw away.
 *
 * On unless it has been turned off, which is the one way round that fails
 * safely. The cost of keeping it is a pass over the film and a tenth to a
 * quarter of its size; the cost of not keeping it is a conversion that becomes
 * irreversible the moment the 90 GB original is deleted — and deleting that
 * original is the whole point of converting for anyone short of space. A
 * default that quietly throws the layer away is one nobody discovers until
 * they want it back.
 *
 * Read as "not off" rather than "is on" for that reason: an install that has
 * never touched the setting keeps the layer.
 */
export const keepsEnhancementLayer = () => getSetting(KEEP_EL_KEY) !== "off";

/**
 * Throws away the kept enhancement layer.
 *
 * Irreversible in the way deleting the original is, and worse in one respect:
 * on a film whose original has already gone, this is the last copy of the
 * enhancement layer outside the disc it was pressed on.
 */
export async function deleteElArchive(filePath: string): Promise<void> {
  const archive = elArchivePathFor(filePath);
  if (!existsSync(archive)) {
    throw new Error("No enhancement layer is kept beside this file.");
  }
  await rm(archive, { force: true });
}

/**
 * What dovi_convert calls the rebuilt Profile 7 file it writes beside the
 * film. It never lands under this name for long — the job renames it over the
 * film once it has been checked — but a rebuild killed at the wrong moment
 * leaves one, and both the sweep and the cleanup list need to know the name.
 */
export const restoredPathFor = (filePath: string) =>
  filePath.replace(/\.[^.]+$/, "") + ".restored.mkv";

/**
 * The half-built files a rebuild leaves behind if it is interrupted: the base
 * layer, the base layer with the Profile 8.1 metadata stripped out, the
 * unpacked enhancement layer, and the two of them interleaved. All four are
 * named from the film's stem, and all four go to the scratch folder when one
 * is set.
 */
const rebuildWorkingFiles = (filePath: string, tempDir?: string) => {
  const stem = path.basename(filePath).replace(/\.[^.]+$/, "");
  const dir = tempDir ?? path.dirname(filePath);
  return [
    path.join(dir, `${stem}_bl.hevc`),
    path.join(dir, `${stem}_bl_clean.hevc`),
    path.join(dir, `${stem}_el.hevc`),
    path.join(dir, `${stem}_restored.hevc`),
  ];
};

export type ConvertJob = {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  path?: string;
  /**
   * Which way this one is going. Both directions are dovi_convert rewriting
   * the same film in place, so they share one job — but everything written
   * about a running job, from the rail's line to the log's, has to say which.
   */
  mode?: "convert" | "rebuild";
  /** dovi_convert's three steps, then the runtime check this app adds. */
  step: number;
  steps: number;
  /** What the runtime comparison found, pass or fail. */
  check?: string;
  label?: string;
  /**
   * How far through, by bytes written — every file this job creates, counted
   * against what they will all come to. Set from the moment the job starts and
   * only ever rising; see `watchProgress` for what is being weighed against
   * what, and why the enhancement layer is on both sides of it.
   */
  percent?: number;
  /**
   * A second measurement, for the stretch where the percentage is true but not
   * much use: what has actually landed on disk, in one phrase. Composed here
   * rather than from a byte count in each place that draws it, so the rail, the
   * Jobs page and the film's own card cannot end up phrasing it three ways.
   */
  readout?: string;
  /** The tool's own closing summary, kept for the result line. */
  summary?: string;
  /**
   * The command this job spawned, written out as it could be run by hand.
   *
   * Recorded from the argument list actually handed to `spawn` rather than
   * composed for display, so it cannot drift from what ran — which is the only
   * version of it worth showing. The film's page prints the recipe it *would*
   * run; this is the one that did.
   */
  command?: string;
  /** The last lines dovi_convert printed — see `lib/job-output.ts`. */
  output?: string[];
  /** When it started, for the dialog's clock. An hour is a long time to guess. */
  startedAt?: number;
  error?: string;
  finishedAt?: number;
};

/**
 * dovi_convert's three, then the runtime check this app adds — and, when the
 * enhancement layer is being kept, the pass that extracts it before any of
 * them. Held apart from the tool's own numbering, which is what `stepOffset`
 * below translates.
 */
const CHECK_STEP = 4;
const CHECK_STEP_WITH_EL = 5;

/**
 * A rebuild's four: pull the base layer out, put the two layers back together,
 * mux, check. dovi_convert prints no step lines of its own for this one — it
 * draws a spinner — so these are counted from the files it leaves growing.
 */
const REBUILD_STEPS = 4;

const IDLE: ConvertJob = { status: "idle", step: 0, steps: CHECK_STEP };

/**
 * Read from globalThis every time, never copied into a module-local variable —
 * this module can exist more than once in one server, and a local copy stops
 * hearing about the job the moment a second instance appears.
 */
const globalForConvert = globalThis as unknown as {
  medlibConvert?: ConvertJob;
};

const current = (): ConvertJob => globalForConvert.medlibConvert ?? IDLE;

function setJob(next: ConvertJob) {
  const was = current();
  globalForConvert.medlibConvert = next;

  // Every way this job can end passes through here, so the log is written in
  // one place rather than at each of the four returns that finish it.
  if (was.status === "running" && ended(next.status)) {
    const rebuild = next.mode === "rebuild";
    recordRun({
      kind: "convert",
      title: next.path
        ? path.basename(next.path)
        : rebuild
          ? "Profile 7 rebuild"
          : "Conversion",
      path: next.path,
      outcome: next.status,
      startedAt: next.startedAt,
      finishedAt: next.finishedAt ?? Date.now(),
      detail:
        next.error ||
        [
          // Short enough to be read at a glance in a list. What was discarded is
          // said by the job's own name a line above it — except on a rebuild,
          // where the direction is the whole of what happened and the film's
          // name above says nothing about it.
          rebuild
            ? "back to Profile 7"
            : next.summary && `${next.summary} discarded`,
          next.check,
        ]
          .filter(Boolean)
          .join(" · ") ||
        undefined,
      // The line this run actually was. The job has been carrying it for the
      // dialog all along; it goes into the log now so the dialog can still
      // answer "what did it run" a week later.
      command: next.command,
      output: next.output,
    });
  }

  notifyJobs();
}

export function getConvertJob(): ConvertJob {
  return current();
}

/** The running dovi_convert, and whether someone asked for it to stop. */
let activeChild: import("node:child_process").ChildProcess | undefined;
let cancelling = false;

/** The half-built files dovi_convert leaves behind if it is interrupted. */
const workingFiles = (filePath: string, tempDir?: string) => {
  const stem = filePath.replace(/\.[^.]+$/, "");
  return [
    tempDir
      ? path.join(tempDir, `${path.basename(stem)}.p81.hevc`)
      : `${stem}.p81.hevc`,
    `${stem}.p81.tmp`,
  ];
};

/**
 * The enhancement layer as it is being pulled out, before it is packed into
 * the archive. Beside the film unless there is a scratch folder, like every
 * other working file here.
 */
const elTempFor = (filePath: string, tempDir?: string) =>
  path.join(
    tempDir ?? path.dirname(filePath),
    `${path.basename(filePath).replace(/\.[^.]+$/, "")}_el.hevc`,
  );

/**
 * Stops whichever direction is running, and clears up after it.
 *
 * Safe at any point, because neither direction touches the film until
 * everything else has succeeded — it is still sitting where it was, and all
 * that has to go is the partial output.
 *
 * The process group rather than the process: dovi_convert drives ffmpeg and
 * dovi_tool of its own, and killing only the parent would leave those running
 * against the drive with nothing to hand their work to.
 */
export function cancelConvert(): ConvertJob {
  if (current().status !== "running") return current();

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

/** Progress is drawn with cursor moves and colour, none of which we want. */
const ANSI = /\[[0-9;?]*[a-zA-Z]/g;
const STEP = /\[(\d+)\/(\d+)\]\s*([^.\r\n]+)/g;

/**
 * Re-reads the file the conversion just rewrote. The path is unchanged, so
 * without this the library would go on describing the Profile 7 file that is
 * now sitting beside it under a different name.
 */
async function refreshFileFacts(filePath: string): Promise<void> {
  // Clears the stored RPU reading too, since it describes the old stream.
  await reprobeFile(filePath);
  await scanDovi(filePath, { depth: "head" });
  deriveAll();
}

/**
 * Progress, measured rather than guessed.
 *
 * dovi_convert reports its three steps but no percentage within them — the line
 * it prints during the long one is a spinner. It does, however, build the film
 * next to itself: `<name>.p81.hevc` while converting the video, then
 * `<name>.p81.tmp` while muxing the tracks back together, both growing steadily
 * until they are renamed into place. Watching them is the honest number.
 *
 * The two are summed against what each will end up holding, which weights the
 * steps by the work they actually do instead of by a guess: the video stream
 * for the first, very nearly the whole file for the second.
 *
 * The extraction that precedes them when the enhancement layer is being kept
 * is the one stretch whose *end* nobody knows in advance: its output is the
 * layer itself, and how big that will be is a tenth of the film for one disc
 * and a quarter for the next. It used to be left out of the sum until the
 * archive was closed, which made it the worst-drawn stretch of the job — no
 * measurement for twenty minutes, so the bar fell back to the step and sat at
 * a fifth without moving, and then dropped to near nothing the moment a real
 * number arrived. A bar that runs backwards says the job restarted.
 *
 * So the layer is counted while it is being written, against a total that
 * grows with it: `written / (converting + kept)`, where `kept` is whatever has
 * landed so far. Both ends move together, which is what makes it safe — the
 * figure only ever rises, and it joins up with the conversion's own without a
 * step in it, because at the moment the extraction ends the two are the same
 * sum. It reads low while the layer is coming out, which is honest: the layer
 * really is the small end of the bytes this job writes.
 *
 * Every file is remembered at its largest rather than read fresh. The tool
 * deletes each working file the moment the next stage has consumed it — the
 * layer as it is packed into the archive, the converted video as it is muxed —
 * and summed live that is a third of the job disappearing off the disk under
 * the bar. `watchRebuild` keeps the same tally for the same reason.
 */
function watchProgress(
  filePath: string,
  sizes: ConvertSizes,
  tempDir?: string,
  /** Set only while this run is the one creating the archive. */
  archive?: string,
) {
  const stem = filePath.replace(/\.[^.]+$/, "");
  // Only the video goes to the temp drive; the remux always stays beside the
  // source. Watching both in one place would have quietly lost the first half
  // of the progress the moment a temp directory was set.
  const hevc = tempDir
    ? path.join(tempDir, `${path.basename(stem)}.p81.hevc`)
    : `${stem}.p81.hevc`;
  const targets = [hevc, `${stem}.p81.tmp`];
  // The layer under both the names it has: the loose stream while it is being
  // pulled out, then the archive it is packed into. One thing, counted once —
  // the larger of the two, which is also what stops the tally falling to zero
  // in the seconds where the archive exists but is still empty.
  const layer = archive ? [elTempFor(filePath, tempDir), archive] : [];
  const converting =
    (sizes.videoBytes ?? sizes.sourceBytes) + sizes.sourceBytes;

  const peak = new Map<string, number>();
  const largest = (file: string) => {
    const most = Math.max(peak.get(file) ?? 0, sizeOf(file) ?? 0);
    peak.set(file, most);
    return most;
  };

  return setInterval(() => {
    if (current().status !== "running") return;

    const kept = layer.reduce((most, file) => Math.max(most, largest(file)), 0);
    const converted = targets.reduce((sum, file) => sum + largest(file), 0);
    const written = kept + converted;
    const total = converting + kept;

    // Nothing has landed yet — the first seconds, before the tool has opened
    // its first output file. Zero is what the job was started at, and saying
    // it again every second is not a reading.
    if (written === 0 || total === 0) return;

    setJob({
      ...current(),
      // Held below 100 so the bar completes when the job does, not when the
      // last byte lands — the verify step still has to run.
      percent: Math.min(99, (written / total) * 100),
      // While the layer is the only thing being written the bar is honestly
      // near its bottom for a long stretch, so the readouts beside it carry
      // the figure that is visibly moving. Only for that stretch: once the
      // conversion proper starts, the percentage is the better answer and a
      // second measurement of the same thing beside it is just noise.
      readout:
        kept > 0 && converted === 0
          ? `${(kept / 1e9).toFixed(1)} GB out`
          : undefined,
    });
  }, 1000);
}

/** A file's size, or undefined where it has not been created or is already gone. */
function sizeOf(filePath: string): number | undefined {
  try {
    return statSync(filePath).size;
  } catch {
    return undefined;
  }
}

export type ConvertSizes = { sourceBytes: number; videoBytes?: number };

export function startConvert(
  filePath: string,
  sizes: ConvertSizes,
): ConvertJob {
  if (current().status === "running") return current();

  const keepEl = keepsEnhancementLayer();
  const archive = elArchivePathFor(filePath);
  /**
   * Whether this run is the one that extracts the layer. An archive already
   * beside the film is reused — dovi_convert says so and moves on — which is
   * what a film converted, restored and converted again ends up doing, and it
   * saves a pass over the whole file.
   */
  const backing = keepEl && !existsSync(archive);

  setJob({
    status: "running",
    mode: "convert",
    path: filePath,
    step: 1,
    steps: backing ? CHECK_STEP_WITH_EL : CHECK_STEP,
    label: backing ? "Keeping the enhancement layer" : undefined,
    // Zero in both directions now. The extraction used to start with no
    // measurement at all so the bar would fall back to the step it was on,
    // which drew a fifth of a bar that then sat still for twenty minutes and
    // fell back to nothing when the real figure arrived. It is counted from
    // the first byte of the layer instead — see `watchProgress`.
    percent: 0,
    startedAt: Date.now(),
  });

  void (async () => {
    const tempDir = getSetting("convertTempDir");
    const ticker = watchProgress(
      filePath,
      sizes,
      tempDir,
      backing ? archive : undefined,
    );
    cancelling = false;

    const args = [
      "convert",
      path.basename(filePath),
      // On a simple FEL the tool stops to warn that the layer carries data
      // and asks whether to go on. This app has already answered that, and
      // answered it better: its verdict comes from every frame of the RPU,
      // where the question is raised on the tool's own head scan. Saying so
      // up front is what keeps the two agreeing on a film.
      //
      // It does not touch the complex-FEL refusal above it, which still
      // needs --force and is deliberately not given one — that second
      // opinion is the reason this shells out rather than reimplementing.
      "--include-simple",
      // Pulls the enhancement layer out to a `.dovi` archive before
      // discarding it, which is what makes the conversion reversible once
      // the 90 GB original has been deleted. Passed even when the archive
      // already exists: the tool finds it, says so and skips the pass.
      ...(keepEl ? ["--backup"] : []),
      ...(tempDir ? ["--temp", tempDir] : []),
    ];

    const cwd = path.dirname(filePath);
    setJob({ ...current(), command: commandLine(cwd, "dovi_convert", args) });

    // Its own process group, so a cancel can take its children down with it.
    const child = spawn("dovi_convert", args, {
      cwd,
      detached: true,
      // No stdin at all, rather than the pipe `spawn` gives by default.
      //
      // Every prompt in the tool falls back to a safe answer on EOF, and can
      // therefore be left to reach one. Handed a pipe instead, it blocks on a
      // read that nothing will ever write to: the conversion sits at step 1
      // with no output, no child processes and no way to finish, and the only
      // thing the app can see is a job that has stopped moving.
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;

    let tail = "";
    let output: string[] = [];

    const read = (chunk: Buffer) => {
      const text = chunk.toString().replace(ANSI, "");
      tail = (tail + text).slice(-4000);
      output = appendOutput(output, text);

      // Every step is reprinted as it progresses, so the last match wins.
      let match: RegExpExecArray | null;
      let step = current().step;
      let label = current().label;
      STEP.lastIndex = 0;
      while ((match = STEP.exec(text)) !== null) {
        // The tool counts its own three; the extraction that ran before them
        // is this app's step and not one of them, so it shifts the rest along.
        step = Number(match[1]) + (backing ? 1 : 0);
        // "Muxing (Cloning Metadata + 1142.5fps)" → "Muxing". The rate was
        // worth showing when the step was all we had; the percentage says it
        // better now.
        label = match[3].split("(")[0].trim();
      }

      // Unconditional now, where it used to wait for a step line: the output is
      // the reason to publish, and it changes on every chunk. `notifyJobs`
      // coalesces the burst, so ten spinner frames a second still cost one send
      // per window rather than ten.
      setJob({ ...current(), step, label, output });
    };

    child.stdout.on("data", read);
    child.stderr.on("data", read);

    const code = await new Promise<number>((resolve) => {
      child.on("error", () => resolve(-1));
      child.on("close", (value) => resolve(value ?? -1));
    });
    clearInterval(ticker);
    activeChild = undefined;

    if (cancelling) {
      // Nothing to undo, only to sweep: the original was never moved. The
      // archive is swept only where this run was the one making it — an
      // interrupted extraction leaves a truncated tar, while one that was
      // already there is a good copy of an earlier film's layer.
      await Promise.all(
        [
          ...workingFiles(filePath, tempDir),
          ...(backing ? [elTempFor(filePath, tempDir), archive] : []),
        ].map((f) => rm(f, { force: true })),
      );
      setJob({ ...current(), status: "cancelled", finishedAt: Date.now() });
      return;
    }

    if (code !== 0) {
      setJob({
        ...current(),
        status: "error",
        error:
          tail.trim().split("\n").filter(Boolean).slice(-3).join(" ") ||
          `dovi_convert exited ${code}`,
        finishedAt: Date.now(),
      });
      return;
    }

    setJob({
      ...current(),
      step: current().steps,
      label: "Checking runtime",
      percent: 99,
    });
    const check = await compareRuntime(backupPathFor(filePath), filePath);

    try {
      await refreshFileFacts(filePath);
    } catch (err) {
      // The conversion itself succeeded, so this is not a failed job — but the
      // library is now describing a file that no longer exists as described.
      setJob({
        ...current(),
        status: "error",
        error: `Converted, but re-reading the file failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        finishedAt: Date.now(),
      });
      return;
    }

    setJob({
      ...current(),
      // A file of the wrong length is a failed conversion however cleanly the
      // tool exited, so it is reported as one — with the original still there.
      status: check.ok ? "done" : "error",
      step: current().steps,
      percent: 100,
      check: check.message,
      error: check.ok ? undefined : `Conversion finished, but ${check.message}`,
      // "EL Discarded:  6.38 GB (Space Saved)" → "6.38 GB". The parenthetical
      // is the tool captioning its own column, and every line this ends up in
      // already says what the figure is: "6.38 GB (Space Saved) of enhancement
      // layer discarded" was the result line for a while.
      summary: tail.match(/EL Discarded:\s*([^(\n]+)/)?.[1]?.trim(),
      finishedAt: Date.now(),
    });
  })();

  return current();
}

// ---------------------------------------------------------------------------
// Going back to Profile 7
// ---------------------------------------------------------------------------

/**
 * Progress for a rebuild, counted the way the conversion's is: by watching the
 * files the tool leaves growing beside itself.
 *
 * dovi_convert prints no step lines for this one, only a spinner, so these
 * files are also the only evidence of which stage it is in — which is why each
 * carries the sentence to show while it is the one being written.
 *
 * Sizes are remembered rather than read fresh each tick. The base layer is
 * deleted the moment its stripped copy exists, which is a third of the work
 * disappearing off the disk; summed live, the bar would run backwards through
 * the longest stretch of the job.
 */
function watchRebuild(
  filePath: string,
  sizes: ConvertSizes,
  elBytes: number,
  tempDir?: string,
) {
  const dir = tempDir ?? path.dirname(filePath);
  const stem = path.basename(filePath).replace(/\.[^.]+$/, "");
  const video = sizes.videoBytes ?? sizes.sourceBytes;

  const stages = [
    {
      file: path.join(dir, `${stem}_bl.hevc`),
      bytes: video,
      step: 1,
      label: "Extracting the base layer",
    },
    {
      file: path.join(dir, `${stem}_bl_clean.hevc`),
      bytes: video,
      step: 1,
      label: "Taking the Profile 8.1 metadata back out",
    },
    {
      file: path.join(dir, `${stem}_el.hevc`),
      bytes: elBytes,
      step: 2,
      label: "Unpacking the enhancement layer",
    },
    {
      file: path.join(dir, `${stem}_restored.hevc`),
      bytes: video + elBytes,
      step: 2,
      label: "Interleaving the two layers",
    },
    {
      file: restoredPathFor(filePath),
      bytes: sizes.sourceBytes + elBytes,
      step: 3,
      label: "Muxing",
    },
  ];

  const total = stages.reduce((sum, stage) => sum + stage.bytes, 0);
  const peak = new Map<string, number>();

  return setInterval(() => {
    if (current().status !== "running") return;

    let written = 0;
    let step: number | undefined;
    let label: string | undefined;

    for (const stage of stages) {
      const size = sizeOf(stage.file);
      const most = Math.max(peak.get(stage.file) ?? 0, size ?? 0);
      peak.set(stage.file, most);
      written += most;
      // The furthest one that is still on disk is the one being written.
      if (size) {
        step = stage.step;
        label = stage.label;
      }
    }

    if (written === 0 || total === 0) return;

    setJob({
      ...current(),
      // Below 100 for the reason the conversion holds it there: the check and
      // the swap still have to happen after the last byte lands.
      percent: Math.min(99, (written / total) * 100),
      step: step ?? current().step,
      label: label ?? current().label,
    });
  }, 1000);
}

/**
 * Puts the enhancement layer back and makes the film Profile 7 again.
 *
 * The counterpart to `restoreOriginal`, for after the original has gone: that
 * one is two renames and gives back the exact bytes the disc was ripped to,
 * while this one rebuilds them — base layer out of the converted file, its
 * Profile 8.1 metadata stripped, the kept layer interleaved back in, and the
 * whole thing remuxed with the film's own audio, subtitles and chapters.
 * Minutes of disk and a couple of times the film in scratch space, which is
 * why it is a job and not an action.
 *
 * The film is not touched until the rebuild has been written in full and its
 * runtime checked. Everything before that point happens in files beside it, so
 * a cancel, a failure or a power cut costs the time and nothing else.
 */
export function startRebuild(
  filePath: string,
  sizes: ConvertSizes,
): ConvertJob {
  if (current().status === "running") return current();

  setJob({
    status: "running",
    mode: "rebuild",
    path: filePath,
    step: 1,
    steps: REBUILD_STEPS,
    label: "Extracting the base layer",
    percent: 0,
    startedAt: Date.now(),
  });

  void (async () => {
    const tempDir = getSetting("convertTempDir");
    const archive = elArchivePathFor(filePath);
    const restored = restoredPathFor(filePath);
    cancelling = false;

    const fail = (error: string) =>
      setJob({ ...current(), status: "error", error, finishedAt: Date.now() });

    const elBytes = sizeOf(archive);
    if (elBytes === undefined) {
      fail(
        "No enhancement layer is kept beside this film, so there is nothing to rebuild from.",
      );
      return;
    }

    // dovi_convert refuses to overwrite a rebuilt file, so anything left under
    // that name from a run that died mid-way has to go first. It can only ever
    // be this app's own leftover: the name is the tool's, and a finished
    // rebuild is renamed over the film within a second of being written.
    await Promise.all(
      [restored, ...rebuildWorkingFiles(filePath, tempDir)].map((f) =>
        rm(f, { force: true }),
      ),
    );

    const ticker = watchRebuild(filePath, sizes, elBytes, tempDir);

    const args = [
      "restore",
      path.basename(filePath),
      ...(tempDir ? ["--temp", tempDir] : []),
    ];

    const cwd = path.dirname(filePath);
    setJob({ ...current(), command: commandLine(cwd, "dovi_convert", args) });

    // Its own process group, so a cancel takes the ffmpeg and dovi_tool runs
    // it drives down with it. No stdin, for the reason the conversion gives.
    const child = spawn("dovi_convert", args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;

    let tail = "";
    let output: string[] = [];

    const read = (chunk: Buffer) => {
      const text = chunk.toString().replace(ANSI, "");
      tail = (tail + text).slice(-4000);
      output = appendOutput(output, text);
      setJob({ ...current(), output });
    };

    child.stdout.on("data", read);
    child.stderr.on("data", read);

    const code = await new Promise<number>((resolve) => {
      child.on("error", () => resolve(-1));
      child.on("close", (value) => resolve(value ?? -1));
    });
    clearInterval(ticker);
    activeChild = undefined;

    const sweep = () =>
      Promise.all(
        [restored, ...rebuildWorkingFiles(filePath, tempDir)].map((f) =>
          rm(f, { force: true }),
        ),
      );

    if (cancelling) {
      // The film was never renamed, and the archive was only ever read from.
      await sweep();
      setJob({ ...current(), status: "cancelled", finishedAt: Date.now() });
      return;
    }

    if (code !== 0) {
      await sweep();
      fail(
        tail.trim().split("\n").filter(Boolean).slice(-3).join(" ") ||
          `dovi_convert exited ${code}`,
      );
      return;
    }

    setJob({
      ...current(),
      step: REBUILD_STEPS,
      label: "Checking runtime",
      percent: 99,
    });

    // Against the file it is about to replace, which is the same film — the
    // conversion changed what the video stream carries and not how long it
    // runs. Checked while the Profile 8.1 file is still under its own name, so
    // a faulty mux costs the rebuilt file and nothing else.
    const check = await compareRuntime(filePath, restored);
    if (!check.ok) {
      await sweep();
      fail(`The rebuild finished, but ${check.message}`);
      return;
    }

    // The swap, in the order every other one in this app makes it: the film
    // aside first, so its own path is never the thing that is missing.
    const aside = `${filePath}.restoring-${process.pid}`;
    try {
      await rename(filePath, aside);
    } catch (err) {
      await sweep();
      fail(
        `The converted file could not be moved aside: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    try {
      await rename(restored, filePath);
    } catch (err) {
      await rename(aside, filePath).catch(() => {});
      await sweep();
      fail(
        `The rebuilt file could not be put in place: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    await rm(aside, { force: true });

    try {
      await refreshFileFacts(filePath);
    } catch (err) {
      // The rebuild itself worked, so this is not a failed job — but the
      // library is still describing the Profile 8.1 file that has just gone.
      fail(
        `Rebuilt, but re-reading the file failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    setJob({
      ...current(),
      status: "done",
      step: REBUILD_STEPS,
      percent: 100,
      check: check.message,
      finishedAt: Date.now(),
    });
  })();

  return current();
}
