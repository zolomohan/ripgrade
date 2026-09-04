import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { volumeOf } from "./drive";

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

/**
 * Why a file the library knows about is not where the library left it. An
 * unplugged drive and a deleted file are the same ENOENT underneath, and
 * completely different sentences to read: one is "plug it back in", the other
 * is "that copy is gone". Naming the drive is the whole point of the first.
 */
export function missingFileReason(filePath: string): string {
  const volume = volumeOf(filePath);
  if (volume && !existsSync(volume.path)) {
    return `The drive “${volume.name}” is not connected.`;
  }
  return "That file is no longer where the library left it.";
}
