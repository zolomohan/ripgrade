import "server-only";

import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

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
 *
 * `null` clears it, which is what an upload records: an image of your own has
 * no TMDb path, and leaving the last one there would mean that unplugging the
 * drive brings back the poster you replaced.
 */
export function recordArtworkSource(
  dir: string,
  kind: keyof typeof SAVED_NAMES,
  tmdbPath: string | null,
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

/**
 * The format each saved name promises. `SAVED_NAMES` says it in its
 * extensions, but an extension is a string to compare against and this is the
 * thing to compare it to.
 */
const ENCODED_AS: Record<keyof typeof SAVED_NAMES, "jpeg" | "png"> = {
  poster: "jpeg",
  fanart: "jpeg",
  logo: "png",
};

/**
 * The largest upload accepted, and the reason `serverActions.bodySizeLimit` in
 * next.config.ts is set above it. A 4K backdrop as PNG runs to twenty-odd
 * megabytes; past this it is not artwork, it is a mistake.
 */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/**
 * Writes an image of your own into the folder, under the same name TMDb's
 * would have taken — so everything downstream (the folder index, the art
 * route, Kodi and the *arr tools reading the same drive) finds it without
 * being told an upload is a different kind of thing.
 *
 * The format is sniffed rather than taken from the browser's word for it: the
 * filename and the Content-Type are both the client's to invent, and what has
 * to be true here is that the bytes are an image — which is the same question
 * as "can this be re-encoded", asked once.
 *
 * A file already in the format its name promises is written through untouched.
 * Re-encoding a JPEG as a JPEG only spends detail, and the point of uploading
 * is that this file, exactly, is the one you want.
 */
export async function saveUploadedArtwork(
  dir: string,
  kind: keyof typeof SAVED_NAMES,
  bytes: Buffer,
): Promise<string> {
  let format: string | undefined;
  try {
    format = (await sharp(bytes).metadata()).format;
  } catch {
    // Fall through to the same error an unrecognised format gets: to a person
    // handing over a file, "sharp could not parse this" and "this is not an
    // image" are one answer.
  }
  if (!format) throw new Error("That file is not an image.");

  const want = ENCODED_AS[kind];
  const target = path.join(dir, SAVED_NAMES[kind]);

  if (format === want) {
    await writeFile(target, bytes);
    return target;
  }

  // `rotate()` bakes in any EXIF orientation, for the reason lib/thumbs.ts
  // gives: the tag survives a re-encode and the browser would then apply a
  // turn that is already in the pixels.
  const image = sharp(bytes).rotate();

  await writeFile(
    target,
    want === "jpeg"
      ? // JPEG has no transparency to carry a cut-out PNG's into, and sharp's
        // default fill is white — which is the one colour a poster is likely
        // to disappear against on this app's dark surfaces.
        await image
          .flatten({ background: "#000000" })
          .jpeg({ quality: 92 })
          .toBuffer()
      : await image.png().toBuffer(),
  );

  return target;
}
