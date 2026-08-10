import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { RUNTIME_DRIFT, runtimeDrift } from "./derive";

const execFileAsync = promisify(execFile);

export const VIDEO_EXTENSIONS = new Set([
  ".mkv",
  ".mp4",
  ".m4v",
  ".avi",
  ".mov",
  ".ts",
  ".m2ts",
  ".mpg",
  ".mpeg",
  ".wmv",
  ".webm",
]);

/**
 * MediaInfo reports everything ffprobe would (codecs, HDR format, Dolby Vision
 * profile, Atmos via Format_Commercial_IfAny, encoder settings), so running both
 * would double the scan cost for no extra information.
 */
export async function probe(
  filePath: string,
): Promise<{ mediainfo?: unknown; error?: string }> {
  try {
    const { stdout } = await execFileAsync(
      "mediainfo",
      ["--Output=JSON", filePath],
      // Chapter lists on long films get big; the timeout guards a stalled drive.
      { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
    );
    return { mediainfo: JSON.parse(stdout) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Seconds, read the same way for every file so comparisons are like for like. */
export async function durationOf(
  filePath: string,
): Promise<number | undefined> {
  const { mediainfo } = await probe(filePath);
  const tracks = (
    mediainfo as { media?: { track?: Record<string, unknown>[] } }
  )?.media?.track;
  const general = tracks?.find((t) => t["@type"] === "General");
  const value = Number.parseFloat(String(general?.["Duration"] ?? ""));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

const clock = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/**
 * Checks a rewritten file against the original it replaced.
 *
 * Every tool this app drives verifies its own output, and each does it on
 * metadata: a mux that emits the stream twice satisfies both dovi_convert and
 * mkvmerge, and produces a film of double the runtime. Reading both files
 * settles it in about a second, which is nothing against the minutes already
 * spent — so it is the last step of anything that rewrites a film, and it is
 * the same step whichever tool did the rewriting.
 */
export async function compareRuntime(
  originalPath: string,
  rewrittenPath: string,
): Promise<{ ok: boolean; message: string }> {
  const [before, after] = await Promise.all([
    durationOf(originalPath),
    durationOf(rewrittenPath),
  ]);

  if (before === undefined || after === undefined) {
    return {
      ok: true,
      message: "runtime could not be compared — check the file plays through",
    };
  }

  return runtimeDrift(before, after) > RUNTIME_DRIFT
    ? {
        ok: false,
        message: `the new file runs ${clock(after)} against the original's ${clock(before)}. The mux is faulty — restore the original rather than keeping this.`,
      }
    : { ok: true, message: `runtime matches the original at ${clock(after)}` };
}
