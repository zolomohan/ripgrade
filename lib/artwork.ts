import "server-only";

import { readdir } from "node:fs/promises";
import path from "node:path";

export type Artwork = { poster?: string; fanart?: string };

/** Libraries mix .jpg and .jpeg for the same role, so match on the stem. */
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
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

  const art: Artwork = {};

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;

    const stem = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
    if (stem === "poster" && !art.poster) art.poster = path.join(dir, entry.name);
    else if (stem === "fanart" && !art.fanart) art.fanart = path.join(dir, entry.name);
  }

  return art;
}
