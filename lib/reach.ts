import "server-only";

import { statSync } from "node:fs";
import path from "node:path";

/**
 * Whether the drive a file lives on is plugged in.
 *
 * One question, asked in one place, because getting it wrong is expensive in
 * both directions. Asked per file it is a stat per row, and a stat against a
 * volume that is not mounted does not fail quickly — a library of four hundred
 * films is four hundred timeouts and a page that never paints. Not asked at
 * all, everything derived from the database gets quietly filtered down to
 * whatever happens to be mounted, and the app reports a smaller library rather
 * than an absent drive.
 *
 * So it is asked of the folder, once per folder, and memoised for the length of
 * one request. A volume comes and goes as a whole: if its directory answers,
 * every file under it is worth stat-ing individually, and if it does not, none
 * of them are.
 */

/** Whether a folder is there and readable, right now. */
export function folderReachable(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The same question over a list of files, at one stat per folder.
 *
 * A closure rather than a module-level cache: it must be true for the request
 * that asks it and stale by the next one, since plugging a drive in is the
 * event this whole thing exists to notice.
 */
export function reachabilityReader(): (filePath: string) => boolean {
  const byDir = new Map<string, boolean>();

  return (filePath: string) => {
    const dir = path.dirname(filePath);
    let known = byDir.get(dir);
    if (known === undefined) {
      known = folderReachable(dir);
      byDir.set(dir, known);
    }
    return known;
  };
}
