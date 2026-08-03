import "server-only";

import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { db } from "./db";

export type Artwork = { poster?: string; fanart?: string; logo?: string };

/** Where each image came from on TMDb, for when the drive is not there. */
export type ArtworkSources = {
  poster?: string;
  fanart?: string;
  logo?: string;
};

/**
 * Checked in this order, so the result never depends on readdir ordering. It
 * also means a newly saved `poster.jpeg` takes precedence over an older
 * `poster.jpg` sitting beside it.
 */
const EXTENSION_PRIORITY = [".jpeg", ".jpg", ".png", ".webp"];

export const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * What this app writes when you pick artwork from TMDb.
 *
 * The logo is a PNG and must stay one: it is a title treatment cut out against
 * transparency, and re-encoding it as JPEG would fill that transparency with
 * white and make it useless over a backdrop.
 */
export const SAVED_NAMES = {
  poster: "poster.jpeg",
  fanart: "fanart.jpeg",
  logo: "logo.png",
};

/**
 * Stems recognised on disk. `clearlogo` is what Kodi and the *arr stack write,
 * so a library organised by those tools is picked up without renaming anything.
 */
const STEMS = {
  poster: ["poster"],
  fanart: ["fanart"],
  logo: ["logo", "clearlogo"],
};

/**
 * Finds the poster and backdrop sitting alongside a movie file. Stems are
 * matched exactly so `poster-1.jpeg` (a second copy) does not displace
 * `poster.jpeg`.
 */
export async function findArtwork(dir: string): Promise<Artwork> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return {};
  }

  const byStem = new Map<string, Map<string, string>>();

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!MIME_TYPES[ext]) continue;

    const stem = path
      .basename(entry.name, path.extname(entry.name))
      .toLowerCase();
    if (!Object.values(STEMS).some((names) => names.includes(stem))) continue;

    const found = byStem.get(stem) ?? new Map<string, string>();
    found.set(ext, path.join(dir, entry.name));
    byStem.set(stem, found);
  }

  const pick = (stems: string[]) => {
    for (const stem of stems) {
      const found = byStem.get(stem);
      if (!found) continue;
      for (const ext of EXTENSION_PRIORITY) {
        const hit = found.get(ext);
        if (hit) return hit;
      }
    }
    return undefined;
  };

  return {
    poster: pick(STEMS.poster),
    fanart: pick(STEMS.fanart),
    logo: pick(STEMS.logo),
  };
}

/** Refreshes one folder's row after artwork is added or replaced. */
export async function reindexDir(dir: string): Promise<Artwork> {
  const art = await findArtwork(dir);

  // The source columns are left alone: they say where a file came from, which
  // re-reading the folder cannot know and must not erase.
  db.prepare(
    `INSERT INTO artwork (dir, poster, fanart, logo, found_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(dir) DO UPDATE SET
       poster = excluded.poster,
       fanart = excluded.fanart,
       logo = excluded.logo,
       found_at = excluded.found_at`,
  ).run(
    dir,
    art.poster ?? null,
    art.fanart ?? null,
    art.logo ?? null,
    Date.now(),
  );

  return art;
}

/**
 * Remembers the TMDb path an image was taken from.
 *
 * The file on the drive stays the artwork — full resolution, yours, and there
 * whether or not the internet is. This is only so the app has something to show
 * when the drive is unplugged, which is the one case where a local file is
 * worse than a URL.
 */
export function recordArtworkSource(
  dir: string,
  kind: keyof typeof SAVED_NAMES,
  tmdbPath: string,
): void {
  const column = `${kind}_src`;
  db.prepare(
    `INSERT INTO artwork (dir, found_at, ${column}) VALUES (?, ?, ?)
     ON CONFLICT(dir) DO UPDATE SET ${column} = excluded.${column}`,
  ).run(dir, Date.now(), tmdbPath);
}

/**
 * Downloads an image into the movie's own folder. Existing files of the same
 * name are replaced; a differently-named leftover (poster.jpg beside a new
 * poster.jpeg) is left alone but loses to the priority order above.
 */
export async function saveArtwork(
  dir: string,
  kind: keyof typeof SAVED_NAMES,
  url: string,
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download artwork: HTTP ${response.status}`);
  }

  const target = path.join(dir, SAVED_NAMES[kind]);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  return target;
}
