import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
