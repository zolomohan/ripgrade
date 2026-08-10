import "server-only";

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";

import { getSetting } from "./db";
import { BACKUP_SUFFIX } from "./derive";
import { scanDovi } from "./dovi";
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

export type ConvertJob = {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  path?: string;
  /** dovi_convert's three steps, then the runtime check this app adds. */
  step: number;
  steps: number;
  /** What the runtime comparison found, pass or fail. */
  check?: string;
  label?: string;
  /**
   * How far through, by bytes written. Undefined when the working files cannot
   * be found — `--safe` mode puts them elsewhere — in which case the step is
   * all there is to go on.
   */
  percent?: number;
  /** The tool's own closing summary, kept for the result line. */
  summary?: string;
  error?: string;
  finishedAt?: number;
};

const CHECK_STEP = 4;

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
  globalForConvert.medlibConvert = next;
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
 * Stops a conversion and clears up after it.
 *
 * Safe at any point, because dovi_convert does not touch the original until
 * everything else has succeeded — the film is still sitting where it was, and
 * all that has to go is the partial output.
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
 */
function watchProgress(
  filePath: string,
  sizes: ConvertSizes,
  tempDir?: string,
) {
  const stem = filePath.replace(/\.[^.]+$/, "");
  // Only the video goes to the temp drive; the remux always stays beside the
  // source. Watching both in one place would have quietly lost the first half
  // of the progress the moment a temp directory was set.
  const hevc = tempDir
    ? path.join(tempDir, `${path.basename(stem)}.p81.hevc`)
    : `${stem}.p81.hevc`;
  const targets = [hevc, `${stem}.p81.tmp`];
  const total = (sizes.videoBytes ?? sizes.sourceBytes) + sizes.sourceBytes;

  return setInterval(() => {
    if (current().status !== "running") return;

    let written = 0;
    let found = false;
    for (const target of targets) {
      try {
        written += statSync(target).size;
        found = true;
      } catch {
        // Not created yet, or already renamed into place.
      }
    }

    // Held below 100 so the bar completes when the job does, not when the last
    // byte lands — the verify step still has to run.
    if (found && total > 0) {
      setJob({ ...current(), percent: Math.min(99, (written / total) * 100) });
    }
  }, 1000);
}

export type ConvertSizes = { sourceBytes: number; videoBytes?: number };

export function startConvert(
  filePath: string,
  sizes: ConvertSizes,
): ConvertJob {
  if (current().status === "running") return current();

  setJob({
    status: "running",
    path: filePath,
    step: 1,
    steps: CHECK_STEP,
    percent: 0,
  });

  void (async () => {
    const tempDir = getSetting("convertTempDir");
    const ticker = watchProgress(filePath, sizes, tempDir);
    cancelling = false;
    // Its own process group, so a cancel can take its children down with it.
    const child = spawn(
      "dovi_convert",
      [
        "convert",
        path.basename(filePath),
        ...(tempDir ? ["--temp", tempDir] : []),
      ],
      {
        cwd: path.dirname(filePath),
        detached: true,
      },
    );
    activeChild = child;

    let tail = "";

    const read = (chunk: Buffer) => {
      const text = chunk.toString().replace(ANSI, "");
      tail = (tail + text).slice(-4000);

      // Every step is reprinted as it progresses, so the last match wins.
      let match: RegExpExecArray | null;
      let latest: ConvertJob | undefined;
      STEP.lastIndex = 0;
      while ((match = STEP.exec(text)) !== null) {
        latest = {
          ...current(),
          step: Number(match[1]),
          // "Muxing (Cloning Metadata + 1142.5fps)" → "Muxing". The rate was
          // worth showing when the step was all we had; the percentage says it
          // better now.
          label: match[3].split("(")[0].trim(),
        };
      }
      if (latest) setJob(latest);
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
      // Nothing to undo, only to sweep: the original was never moved.
      await Promise.all(
        workingFiles(filePath, tempDir).map((f) => rm(f, { force: true })),
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
      step: CHECK_STEP,
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
      step: CHECK_STEP,
      percent: 100,
      check: check.message,
      error: check.ok ? undefined : `Conversion finished, but ${check.message}`,
      summary: tail.match(/EL Discarded:\s*([^\n]+)/)?.[1]?.trim(),
      finishedAt: Date.now(),
    });
  })();

  return current();
}
