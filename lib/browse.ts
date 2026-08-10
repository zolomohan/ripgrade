import "server-only";

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export type DirEntry = {
  name: string;
  path: string;
};

export type DirListing = {
  path: string;
  parent: string | null;
  entries: DirEntry[];
  /** Raw message when the directory can't be read — unmounted drive, no permission, not a directory. */
  error?: string;
};

/**
 * External drives mount here on macOS, so it's the natural starting point. The
 * container image binds the host's `/Volumes` to the same path inside itself,
 * precisely so every path already in the database keeps resolving; the
 * override is for the host that mounts its drives somewhere else.
 */
export const DEFAULT_ROOT = process.env.RIPGRADE_BROWSE_ROOT || "/Volumes";

export async function listDirectory(target: string): Promise<DirListing> {
  const resolved = path.resolve(target);
  const parentPath = path.dirname(resolved);
  const parent = parentPath === resolved ? null : parentPath;

  let dirents;
  try {
    dirents = await readdir(resolved, { withFileTypes: true });
  } catch (err) {
    return {
      path: resolved,
      parent,
      entries: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const entries: DirEntry[] = [];
  for (const dirent of dirents) {
    if (dirent.name.startsWith(".")) continue;

    const full = path.join(resolved, dirent.name);
    if (dirent.isDirectory()) {
      entries.push({ name: dirent.name, path: full });
    } else if (dirent.isSymbolicLink()) {
      // /Volumes/Macintosh HD is a symlink to /, so these are worth following.
      try {
        if ((await stat(full)).isDirectory()) {
          entries.push({ name: dirent.name, path: full });
        }
      } catch {
        // Broken link — not useful to show.
      }
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { path: resolved, parent, entries };
}
