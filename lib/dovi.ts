import "server-only";

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { db } from "./db";
import { recordRun } from "./jobs";
import type { DoviDepth, DoviScan } from "./derive";

const execFileAsync = promisify(execFile);

export type { DoviDepth, DoviScan };

/**
 * What MediaInfo cannot tell you about Dolby Vision.
 *
 * MediaInfo reads the profile out of the container's configuration record, and
 * stops there. Everything that decides whether a Profile 7 file can be flattened
 * to Profile 8.1 — above all whether the enhancement layer is MEL or FEL — lives
 * inside the RPU, which means demuxing the HEVC stream and parsing it.
 *
 * Two depths, because they answer different questions:
 *
 *   head — the first few hundred frames. Costs under a second even on a 90 GB
 *          remux, because ffmpeg only reads the head of the file. Everything
 *          structural (profile, EL type, CM version, L6 static metadata) is
 *          fixed at authoring time and correct from frame one, so this is what
 *          a scan runs over the whole library.
 *
 *   full — every frame. Minutes per film. The only way to prove an RPU exists
 *          on every frame, and the only way the L1 light levels mean anything,
 *          since they are measured across whatever frames were parsed.
 */
// The shape itself lives in derive.ts, which owns everything that ends up on a
// Derived record and is the one module the tests compile on its own.

// ---------------------------------------------------------------------------
// Storage — the `dovi` column on `probes`, which is keyed by path and already
// treated as the expensive-to-rebuild table.
// ---------------------------------------------------------------------------

export function getDoviScans(): Map<string, DoviScan> {
  const rows = db
    .prepare("SELECT path, dovi FROM probes WHERE dovi IS NOT NULL")
    .all() as { path: string; dovi: string }[];

  const map = new Map<string, DoviScan>();
  for (const row of rows) {
    try {
      map.set(row.path, JSON.parse(row.dovi) as DoviScan);
    } catch {
      // A truncated write should not take down every other film.
    }
  }
  return map;
}

export function getDoviScan(filePath: string): DoviScan | undefined {
  const row = db.prepare("SELECT dovi FROM probes WHERE path = ?").get(filePath) as
    | { dovi: string | null }
    | undefined;
  if (!row?.dovi) return undefined;
  try {
    return JSON.parse(row.dovi) as DoviScan;
  } catch {
    return undefined;
  }
}

function saveDoviScan(filePath: string, scan: DoviScan): void {
  db.prepare("UPDATE probes SET dovi = ? WHERE path = ?").run(
    JSON.stringify(scan),
    filePath,
  );
}

// ---------------------------------------------------------------------------
// Running dovi_tool
// ---------------------------------------------------------------------------

/**
 * Enough frames to be past the studio logos and into the film, which is where
 * a mixed-authoring hybrid would first disagree with its own header. Still well
 * under a second, because the read is sequential from the start of the file.
 *
 * Exported because the How it works page quotes it.
 */
export const HEAD_FRAMES = 300;

export type DoviProgress = { percent?: number; frames: number };

/** Set while an extraction is running, so a cancel has something to kill. */
let stopCurrent: (() => void) | undefined;

/**
 * Raised by a cancel and read before anything is written. Without it a
 * cancelled pass would look exactly like a failed one and would overwrite the
 * film's existing reading with an error — losing what the scan already knew.
 */
let cancelled = false;

/**
 * Demuxes the HEVC stream and pipes it straight into dovi_tool, so nothing the
 * size of the film is ever written to disk — only the RPU, which is small.
 *
 * The two exit codes are read asymmetrically on purpose. With `--limit`,
 * dovi_tool stops early and closes the pipe, which ffmpeg reports as a broken
 * pipe; that is the expected end of a head scan, not a failure. So dovi_tool's
 * exit code decides, and ffmpeg's output is only consulted to explain a run
 * that parsed nothing.
 */
function extractRpu(
  filePath: string,
  rpuPath: string,
  opts: {
    limit?: number;
    durationSec?: number;
    onProgress?: (p: DoviProgress) => void;
  },
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const ffArgs = [
      "-nostdin",
      "-loglevel",
      "error",
      ...(opts.onProgress ? ["-progress", "pipe:2"] : []),
      "-i",
      filePath,
      // The enhancement layer of a dual-layer file rides in the same track as
      // the base layer, so copying the first video track carries both.
      "-map",
      "0:v:0",
      "-c",
      "copy",
      "-f",
      "hevc",
      "-",
    ];

    const ff = spawn("ffmpeg", ffArgs);
    const dovi = spawn("dovi_tool", [
      "extract-rpu",
      ...(opts.limit ? ["--limit", String(opts.limit)] : []),
      "-o",
      rpuPath,
      "-",
    ]);

    // Both are ours to stop. A head scan is over before anyone could click, so
    // in practice this is the full pass being cancelled.
    stopCurrent = () => {
      ff.stdout.destroy();
      ff.kill();
      dovi.kill();
    };

    ff.stdout.pipe(dovi.stdin);

    // Without these the broken pipe at the end of a head scan surfaces as an
    // unhandled 'error' event, which takes down the whole dev server.
    ff.stdout.on("error", () => {});
    dovi.stdin.on("error", () => {});

    let ffErr = "";
    let doviErr = "";
    let pending = "";

    ff.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();

      if (!opts.onProgress) {
        ffErr += text;
        return;
      }

      // `-progress` writes key=value lines to the same stream as errors, so
      // anything that does not look like a progress key is kept as an error.
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";

      let frames = 0;
      let percent: number | undefined;

      for (const line of lines) {
        const [key, value] = line.split("=");
        if (value === undefined) {
          ffErr += line + "\n";
        } else if (key === "frame") {
          frames = Number(value) || 0;
        } else if (key === "out_time_us" && opts.durationSec) {
          const seconds = Number(value) / 1e6;
          if (Number.isFinite(seconds)) {
            percent = Math.min(100, (seconds / opts.durationSec) * 100);
          }
        }
      }

      if (frames) opts.onProgress({ percent, frames });
    });

    dovi.stderr.on("data", (chunk: Buffer) => {
      doviErr += chunk.toString();
    });

    let ffDone = false;
    let doviCode: number | null = null;

    const settle = () => {
      if (!ffDone || doviCode === null) return;
      if (doviCode === 0) return resolve({ ok: true });
      resolve({
        ok: false,
        error:
          doviErr.trim() || ffErr.trim() || `dovi_tool exited ${doviCode}`,
      });
    };

    ff.on("error", (err) => {
      ffErr += err.message;
      ffDone = true;
      settle();
    });
    ff.on("close", () => {
      ffDone = true;
      settle();
    });
    dovi.on("error", (err) => {
      doviErr += err.message;
      doviCode = -1;
      settle();
    });
    dovi.on("close", (code) => {
      doviCode = code ?? -1;
      // Unconditional, including the ordinary end of a `--limit` scan. Node
      // holds the read end of this pipe, so ffmpeg never receives EPIPE on its
      // own — it simply blocks on a full buffer and the scan hangs forever.
      ff.stdout.destroy();
      ff.kill();
      settle();
    });
  });
}

/**
 * dovi_tool prints its summary for people, not for parsing, so every field is
 * optional and the raw text is kept alongside. A line that changes shape in a
 * future release costs that one field, not the scan.
 */
function parseSummary(text: string, depth: DoviDepth): DoviScan {
  const one = (re: RegExp) => text.match(re);
  const nits = (raw: string) =>
    raw
      .split(",")
      .map((part) => Number.parseFloat(part.trim()))
      .filter((n) => Number.isFinite(n));

  const profile = one(/Profile:\s*(\d+)(?:\s*\((MEL|FEL)\))?/i);
  const cm = one(/DM version:\s*\d+\s*\(([^)]+)\)/i);
  const frames = one(/Frames:\s*(\d+)/i);
  const scenes = one(/Scene\/shot count:\s*(\d+)/i);
  const mastering = one(/RPU mastering display:\s*([\d.]+)\/(\d+)\s*nits/i);
  const l1 = one(
    /content light level \(L1\):\s*MaxCLL:\s*([\d.]+)\s*nits,\s*MaxFALL:\s*([\d.]+)\s*nits/i,
  );
  const l6 = one(
    /L6 metadata:\s*Mastering display:\s*([\d.]+)\/(\d+)\s*nits\.\s*MaxCLL:\s*([\d.]+)\s*nits,\s*MaxFALL:\s*([\d.]+)\s*nits/i,
  );
  const l5 = one(
    /L5 offsets:\s*top=(\d+),\s*bottom=(\d+),\s*left=(\d+),\s*right=(\d+)/i,
  );
  const l2 = one(/L2 trims:\s*(.+)/i);
  const l8 = one(/L8 trims:\s*(.+)/i);
  const l9 = one(/L9 MDP:\s*(.+)/i);
  const l11 = one(/L11(?:[^:]*):\s*(.+)/i);

  return {
    depth,
    scannedAt: Date.now(),
    frames: frames ? Number(frames[1]) : 0,
    profile: profile ? Number(profile[1]) : undefined,
    elType: profile?.[2] as "MEL" | "FEL" | undefined,
    cmVersion: cm?.[1],
    scenes: scenes ? Number(scenes[1]) : undefined,
    mastering: mastering
      ? { min: Number(mastering[1]), max: Number(mastering[2]) }
      : undefined,
    l1: l1 ? { maxCll: Number(l1[1]), maxFall: Number(l1[2]) } : undefined,
    l6: l6
      ? {
          min: Number(l6[1]),
          max: Number(l6[2]),
          maxCll: Number(l6[3]),
          maxFall: Number(l6[4]),
        }
      : undefined,
    l5: l5
      ? {
          top: Number(l5[1]),
          bottom: Number(l5[2]),
          left: Number(l5[3]),
          right: Number(l5[4]),
        }
      : undefined,
    l2Trims: l2 ? nits(l2[1]) : undefined,
    l8Trims: l8 ? nits(l8[1]) : undefined,
    l9: l9?.[1].trim(),
    l11: l11?.[1].trim(),
    hdr10plus: /HDR10\+/i.test(text) || undefined,
    summary: text.trim(),
  };
}

/**
 * Parses the RPU of one film and stores the result. Returns the scan rather
 * than throwing, so one unreadable file cannot end a library-wide pass.
 */
export async function scanDovi(
  filePath: string,
  opts: {
    depth?: DoviDepth;
    durationSec?: number;
    onProgress?: (p: DoviProgress) => void;
  } = {},
): Promise<DoviScan> {
  const depth = opts.depth ?? "head";
  const dir = await mkdtemp(path.join(tmpdir(), "ripgrade-rpu-"));
  const rpuPath = path.join(dir, "rpu.bin");

  const fail = (error: string): DoviScan => ({
    depth,
    scannedAt: Date.now(),
    frames: 0,
    summary: "",
    error,
  });

  try {
    const extracted = await extractRpu(filePath, rpuPath, {
      limit: depth === "head" ? HEAD_FRAMES : undefined,
      durationSec: opts.durationSec,
      onProgress: opts.onProgress,
    });

    let scan: DoviScan;
    if (!extracted.ok) {
      scan = fail(extracted.error ?? "RPU extraction failed");
    } else {
      // A file MediaInfo called Dolby Vision but which carries no RPU ends up
      // here, and dovi_tool says so by exiting non-zero. Worth its own sentence
      // rather than the raw command line it failed on.
      const summary = await execFileAsync(
        "dovi_tool",
        ["info", "-i", rpuPath, "-s"],
        { maxBuffer: 8 * 1024 * 1024 },
      ).catch((err: Error) => err);

      scan =
        summary instanceof Error
          ? fail(
              /No RPU found/i.test(summary.message)
                ? "No Dolby Vision RPU in this video stream"
                : summary.message,
            )
          : parseSummary(summary.stdout, depth);

      if (!scan.error && scan.frames === 0) {
        scan = fail("No Dolby Vision RPU in this video stream");
      }
    }

    // A cancelled run knows nothing; storing its failure would replace a good
    // head scan with an error.
    if (!cancelled) saveDoviScan(filePath, scan);
    return scan;
  } catch (err) {
    const scan = fail(err instanceof Error ? err.message : String(err));
    if (!cancelled) saveDoviScan(filePath, scan);
    return scan;
  } finally {
    stopCurrent = undefined;
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The full pass, as a background job
// ---------------------------------------------------------------------------

export type DoviJob = {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  /** Which film is being read — the page only shows progress for its own. */
  path?: string;
  percent: number;
  frames: number;
  error?: string;
  finishedAt?: number;
};

const IDLE_JOB: DoviJob = { status: "idle", percent: 0, frames: 0 };

/**
 * The job lives on globalThis and is read from there every time — never copied
 * into a module-local variable.
 *
 * This module can exist more than once in one server: a dev reload replaces it
 * while work is still running, and route handlers, server components and
 * actions do not always share one instance. A local copy is seeded once at
 * import and then never hears about anything the running job does, which is
 * how a pass that had finished went on reporting 59% for good.
 */
const globalForJob = globalThis as unknown as { medlibDoviJob?: DoviJob };

const current = (): DoviJob => globalForJob.medlibDoviJob ?? IDLE_JOB;

function setJob(next: DoviJob) {
  globalForJob.medlibDoviJob = next;
}

export function getDoviJob(): DoviJob {
  return current();
}

/**
 * Reads every frame of one film. Minutes of disk, so it runs detached and the
 * page polls — the same shape as a library scan, for the same reason.
 */
export function startFullDoviScan(
  filePath: string,
  durationSec?: number,
): DoviJob {
  if (current().status === "running") return current();

  cancelled = false;
  const startedAt = Date.now();
  setJob({ status: "running", path: filePath, percent: 0, frames: 0 });

  void (async () => {
    const scan = await scanDovi(filePath, {
      depth: "full",
      durationSec,
      onProgress: ({ percent, frames }) =>
        setJob({ ...current(), percent: percent ?? current().percent, frames }),
    });

    // Folded in here rather than by whoever started the pass: minutes are long
    // enough to close the tab in, and a reading that never reaches the derived
    // rows is a reading the film's page will not show.
    //
    // Imported dynamically because library.ts reads this module — statically it
    // would be a cycle.
    if (!scan.error) {
      try {
        const { deriveAll } = await import("./library");
        deriveAll();
      } catch {
        // The reading is stored either way; the next derive will pick it up.
      }
    }

    if (cancelled) {
      recordRun({
        kind: "dovi",
        label: filePath.split("/").pop(),
        startedAt,
        finishedAt: Date.now(),
        status: "cancelled",
        detail: `${current().frames.toLocaleString("en-GB")} frames read`,
      });
      setJob({ ...current(), status: "cancelled", finishedAt: Date.now() });
      return;
    }

    recordRun({
      kind: "dovi",
      label: filePath.split("/").pop(),
      startedAt,
      finishedAt: Date.now(),
      status: scan.error ? "error" : "done",
      detail:
        scan.error ?? `${scan.frames.toLocaleString("en-GB")} frames read`,
    });

    setJob({
      ...current(),
      status: scan.error ? "error" : "done",
      percent: scan.error ? current().percent : 100,
      frames: scan.frames || current().frames,
      error: scan.error,
      finishedAt: Date.now(),
    });
  })();

  return current();
}

/**
 * Stops a pass in progress. Nothing is stored — the film keeps whatever reading
 * it already had, which is the point: a cancel should cost only the time spent,
 * not the knowledge.
 */
export function cancelDoviScan(): DoviJob {
  if (current().status !== "running") return current();

  cancelled = true;
  stopCurrent?.();
  setJob({ ...current(), status: "cancelled", finishedAt: Date.now() });
  return current();
}
