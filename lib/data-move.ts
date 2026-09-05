import "server-only";

import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  DATA_DIR,
  DEFAULT_DATA_DIR,
  forgetDataDir,
  rememberDataDir,
} from "./data-dir";
import { db } from "./db";

/**
 * Putting the store somewhere else.
 *
 * Kept apart from `data-dir.ts` because that module is read at the very first
 * moment of the process, before there is a database to reach for — and this
 * one needs the database open in order to fold its write-ahead log back in
 * before anything is copied. Importing it there would be a cycle, and a cycle
 * on the module every other module waits for.
 *
 * Copied rather than moved, which is the whole of the safety here. The server
 * has this database open: SQLite is holding a file descriptor, the WAL and the
 * shared-memory file beside it are its bookkeeping, and renaming any of that
 * out from under a live connection is how a store gets half-written into two
 * places at once. A copy leaves the running app exactly as it was — still
 * reading and writing the old directory, still correct — and the new one is
 * only ever read after a restart, by a process that opened it from the start.
 *
 * Which is why the old copy is left behind rather than tidied up. Deleting it
 * would mean deleting the database this very request is being served from, on
 * the strength of a copy nothing has opened yet. It is a `rm -rf` for whoever
 * moved it, once they have seen the library come back up in its new home.
 */

/**
 * What the store is made of.
 *
 * The write-ahead log and the shared-memory file are deliberately not here:
 * the checkpoint below folds the first into the database and the second is
 * pure scratch, so both are SQLite's to recreate wherever it next opens.
 * Copying a WAL to sit beside a database it is no longer the log for is how
 * you arrive with a store that will not open.
 */
const CONTENTS = ["medlib.db", "thumbs", "collections"];

export type MoveResult =
  | { ok: true; from: string; to: string; warning?: string }
  | { ok: false; error: string };

/**
 * Copies the store to `target` and records it as the place to look next time.
 *
 * Returns rather than throws for every refusal a person can do something
 * about, which is all of them: a path that is not a folder, a folder with
 * somebody else's library already in it, the place it is already kept.
 */
export async function moveDataStore(target: string): Promise<MoveResult> {
  const to = path.resolve(target);

  if (to === DATA_DIR) {
    return { ok: false, error: "That is where it is kept already." };
  }

  try {
    await mkdir(to, { recursive: true });
    if (!(await stat(to)).isDirectory()) {
      return { ok: false, error: `Not a folder: ${to}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // A database already there is somebody's library, and this would write over
  // it. Refused rather than merged: the two stores know nothing about each
  // other, and the one being copied would win a field at a time.
  try {
    await stat(path.join(to, "medlib.db"));
    return {
      ok: false,
      error: `There is already a library in ${to}. Choose an empty folder, or move that one out of the way first.`,
    };
  } catch {
    // Nothing there, which is what we want.
  }

  // Folds the log into the database so that the single file about to be copied
  // is the whole truth. Without this the copy is the database as it stood at
  // the last checkpoint, and every scan since is in a log left behind.
  db.pragma("wal_checkpoint(TRUNCATE)");

  try {
    for (const entry of CONTENTS) {
      const from = path.join(DATA_DIR, entry);
      try {
        await stat(from);
      } catch {
        // A store with no thumbnails yet, or no sets of your own. Nothing to
        // carry over, and nothing wrong.
        continue;
      }
      await cp(from, path.join(to, entry), { recursive: true });
    }
  } catch (err) {
    return {
      ok: false,
      error: `Copied part of the way and stopped: ${
        err instanceof Error ? err.message : String(err)
      }. Nothing was removed from ${DATA_DIR}.`,
    };
  }

  if (to === DEFAULT_DATA_DIR) forgetDataDir();
  else rememberDataDir(to);

  return {
    ok: true,
    from: DATA_DIR,
    to,
    // The reason the setting exists at all, so choosing the one place it does
    // not help is worth saying out loud rather than silently honouring.
    warning: inProject(to)
      ? "That folder is inside the project, which is the directory `next dev` watches — the scan's write-ahead log will go on being change events for the dev server. Somewhere outside it is what this setting is for."
      : undefined,
  };
}

/** Whether a path sits under the project, watcher and all. */
function inProject(target: string): boolean {
  const root = process.cwd();
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
