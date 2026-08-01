import "server-only";

import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { db } from "./db";

export type Artwork = { poster?: string; fanart?: string };

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

/** What this app writes when you pick artwork from TMDb. */
export const SAVED_NAMES = { poster: "poster.jpeg", fanart: "fanart.jpeg" };

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

    const stem = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
    if (stem !== "poster" && stem !== "fanart") continue;

    const found = byStem.get(stem) ?? new Map<string, string>();
    found.set(ext, path.join(dir, entry.name));
    byStem.set(stem, found);
  }

  const pick = (stem: string) => {
    const found = byStem.get(stem);
    if (!found) return undefined;
    for (const ext of EXTENSION_PRIORITY) {
      const hit = found.get(ext);
      if (hit) return hit;
    }
    return undefined;
  };

  return { poster: pick("poster"), fanart: pick("fanart") };
}

/** Refreshes one folder's row after artwork is added or replaced. */
export async function reindexDir(dir: string): Promise<Artwork> {
  const art = await findArtwork(dir);

  db.prepare(
    `INSERT INTO artwork (dir, poster, fanart, found_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(dir) DO UPDATE SET
       poster = excluded.poster, fanart = excluded.fanart, found_at = excluded.found_at`,
  ).run(dir, art.poster ?? null, art.fanart ?? null, Date.now());

  return art;
}

/**
 * Downloads an image into the movie's own folder. Existing files of the same
 * name are replaced; a differently-named leftover (poster.jpg beside a new
 * poster.jpeg) is left alone but loses to the priority order above.
 */
export async function saveArtwork(
  dir: string,
  kind: "poster" | "fanart",
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
