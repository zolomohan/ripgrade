import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Where everything the app makes for itself lives: the database, the thumbnail
 * cache, the artwork for sets of your own. Not the films — those are the
 * library roots, and they are yours to place. See lib/roots.ts.
 *
 * This was `data/` under the project, and in a Docker install that is exactly
 * right: `/app/data` is the volume, and nothing is watching the directory it
 * sits in. Run from source it is the wrong place, and expensively so. `next
 * dev` watches the project root and nothing narrower — Turbopack takes the
 * root as the whole of what it watches, and `watchOptions` offers a poll
 * interval and no way to exclude a path — so the SQLite write-ahead log,
 * rewritten continuously for the length of a scan, and every thumbnail
 * generated while you browse, all arrive as change events on the dev server's
 * own file watcher. A server left running through an afternoon of scanning
 * pays for that in memory, and it is memory nothing ever gives back.
 *
 * So the location is a setting, and one you set from outside the app. It was
 * briefly a row on the Settings page; the row went, because the deployment
 * that most needs the directory moved is the one where the environment has
 * already decided and the app may not argue — and a control that is inert
 * wherever it matters is a control that lies.
 *
 * It could not have been a row in `settings` in any case, and the reason is
 * the shape of the thing: that table lives in the database, and this names the
 * directory the database is in. Reading it would mean opening the file whose
 * location it is the answer to. So it is read from where it can be read before
 * anything else exists — one line, one absolute path, in the file below.
 *
 * Three places it can come from, strongest first:
 *
 *   `RIPGRADE_DATA_DIR`   The environment. Docker sets it in the image, beside
 *                         the volume, so a container's two halves cannot end
 *                         up naming different directories. Wins over a choice
 *                         made in the app, because a container's filesystem is
 *                         not the one the chooser was looking at.
 *   the pointer file      What Settings wrote. The ordinary case.
 *   `data/`               What it has always been, for an install that has
 *                         never been asked.
 */

/**
 * One line holding one absolute path.
 *
 * Beside the project rather than inside the data directory, which would be a
 * note about where to look kept in the place you would have to already know
 * about to find it. Git-ignored, and `.dockerignore`d: it names a path on the
 * machine that wrote it, and inside an image that path means nothing.
 */
export const POINTER_FILE = path.join(process.cwd(), ".ripgrade-data-dir");

/** Where it lands when nobody has said otherwise. */
export const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");


function chosenDataDir(): string | undefined {
  try {
    const written = readFileSync(POINTER_FILE, "utf8").trim();
    return written ? path.resolve(written) : undefined;
  } catch {
    // No file, or one this process may not read. Either way nothing was
    // chosen, which is a state and not a failure.
    return undefined;
  }
}

const fromEnvironment = process.env.RIPGRADE_DATA_DIR
  ? path.resolve(process.env.RIPGRADE_DATA_DIR)
  : undefined;

const fromPointer = fromEnvironment ? undefined : chosenDataDir();

export const DATA_DIR = fromEnvironment ?? fromPointer ?? DEFAULT_DATA_DIR;

