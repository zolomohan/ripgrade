import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Hands a file to the OS. This is what makes the audit actionable — the app
 * tells you which copy is the weak one, and these get you to it.
 *
 * macOS `open` only; this app runs nowhere else.
 */
export async function revealInFinder(filePath: string): Promise<void> {
  await execFileAsync("open", ["-R", filePath]);
}
