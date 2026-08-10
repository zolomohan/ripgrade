import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Whether there is a Finder on the other side of this process to reveal
 * anything in. False inside the container image, where the drive is a bind
 * mount and the desktop it belongs to is somewhere the app cannot reach — so
 * the button is not drawn there rather than drawn and always failing.
 */
export const canRevealInFinder = process.platform === "darwin";

/**
 * Hands a file to the OS. This is what makes the audit actionable — the app
 * tells you which copy is the weak one, and these get you to it.
 *
 * macOS `open` only. Checked rather than assumed: the action is reachable by
 * anyone who kept a bookmark, and `spawn open ENOENT` explains nothing.
 */
export async function revealInFinder(filePath: string): Promise<void> {
  if (!canRevealInFinder) {
    throw new Error(
      "Revealing a file needs macOS, and this is not running on it.",
    );
  }
  await execFileAsync("open", ["-R", filePath]);
}
