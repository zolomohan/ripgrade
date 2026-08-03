import "server-only";

import { open, stat } from "node:fs/promises";

import path from "node:path";

import { db } from "./db";
import { titleKey } from "./derive";
import { imageUrl } from "./image-url";
import { getShows } from "./shows";
import { getImages, getTvImages, hasCredentials, type TmdbImage } from "./tmdb";

/**
 * Working out which TMDb image a file on the drive actually is.
 *
 * Artwork downloaded before the source was recorded is just a file: the app
 * knows `poster.jpeg` exists and nothing about where it came from, so with the
 * drive unplugged it has no URL to fall back to. Re-downloading everything by
 * hand would fix that, and this is the alternative.
 *
 * It works because `saveArtwork` writes the response body verbatim — the file
 * on disk is byte-for-byte the `original` TMDb served. So its pixel dimensions
 * and its byte count together identify it among that title's candidates,
 * usually uniquely, without downloading a thing.
 */

/** Width and height read from the file's own header. */
async function dimensions(
  file: string,
): Promise<{ width: number; height: number } | undefined> {
  let handle;
  try {
    handle = await open(file, "r");

    const read = async (at: number, length: number) => {
      const { buffer, bytesRead } = await handle!.read(
        Buffer.alloc(length),
        0,
        length,
        at,
      );
      return buffer.subarray(0, bytesRead);
    };

    const head = await read(0, 4096);

    // PNG: IHDR is fixed-position, so this is just an offset.
    if (head.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    }

    if (head[0] !== 0xff || head[1] !== 0xd8) return undefined;

    // JPEG: hop from segment to segment, each of which declares its own
    // length, until a start-of-frame carries the size. Seeking rather than
    // scanning a fixed window matters: an embedded colour profile or thumbnail
    // pushes the frame header past any window worth reading in one go, and
    // those files were being reported as unreadable.
    let at = 2;
    for (let hops = 0; hops < 64; hops++) {
      const marker = await read(at, 4);
      if (marker.length < 4 || marker[0] !== 0xff) return undefined;

      const kind = marker[1];
      // SOF0–SOF15, minus the four in that range that are not frame headers.
      const isFrame =
        kind >= 0xc0 &&
        kind <= 0xcf &&
        kind !== 0xc4 &&
        kind !== 0xc8 &&
        kind !== 0xcc;

      if (isFrame) {
        const frame = await read(at + 4, 5);
        if (frame.length < 5) return undefined;
        return { height: frame.readUInt16BE(1), width: frame.readUInt16BE(3) };
      }

      // Start of scan: the image data begins, and no size was declared.
      if (kind === 0xda) return undefined;

      at += 2 + marker.readUInt16BE(2);
    }

    return undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

/** The byte count TMDb serves for one image, without fetching the image. */
async function remoteSize(path: string): Promise<number | undefined> {
  try {
    const response = await fetch(imageUrl(path, "original"), {
      method: "HEAD",
    });
    if (!response.ok) return undefined;
    const length = response.headers.get("content-length");
    return length ? Number(length) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which candidate this file is.
 *
 * Dimensions come first because they cost nothing and usually leave one
 * answer. Where several images share a size — the same poster in two
 * languages, most often — the byte count separates them, at one HEAD request
 * each.
 */
async function identify(
  file: string,
  candidates: TmdbImage[],
): Promise<{ path: string; exact: boolean } | undefined> {
  if (candidates.length === 0) return undefined;

  const size = await dimensions(file);
  if (!size) return undefined;

  const sameShape = candidates.filter(
    (c) => c.width === size.width && c.height === size.height,
  );
  if (sameShape.length === 1) {
    return { path: sameShape[0].file_path, exact: true };
  }
  if (sameShape.length === 0) return undefined;

  let bytes: number;
  try {
    bytes = (await stat(file)).size;
  } catch {
    return undefined;
  }

  for (const candidate of sameShape) {
    if ((await remoteSize(candidate.file_path)) === bytes) {
      return { path: candidate.file_path, exact: true };
    }
  }

  // Same dimensions, different bytes: a re-encode, or an image TMDb has since
  // replaced. The best of the same shape is still the right thing to show.
  return { path: sameShape[0].file_path, exact: false };
}

type Target = { dir: string; tmdbId: number; media: "movie" | "tv" };

/** Every folder holding artwork whose source is not yet known. */
function pending(): Target[] {
  const rows = db
    .prepare(
      `SELECT dir, poster, fanart, logo, poster_src, fanart_src, logo_src
         FROM artwork
        WHERE (poster IS NOT NULL AND poster_src IS NULL)
           OR (fanart IS NOT NULL AND fanart_src IS NULL)
           OR (logo   IS NOT NULL AND logo_src   IS NULL)`,
    )
    .all() as { dir: string }[];

  // A folder's TMDb id comes from whatever lives in it: a film from its own
  // match, a show from the season folders below it.
  const films = db
    .prepare("SELECT path, derived FROM movies WHERE present = 1")
    .all() as { path: string; derived: string }[];

  const byDir = new Map<string, { id: number; media: "movie" | "tv" }>();
  for (const row of films) {
    let derived: {
      path: string;
      kind?: string;
      tmdb?: { id: number };
    };
    try {
      derived = JSON.parse(row.derived);
    } catch {
      continue;
    }
    if (derived.kind === "episode" || !derived.tmdb) continue;
    byDir.set(row.path.replace(/\/[^/]*$/, ""), {
      id: derived.tmdb.id,
      media: "movie",
    });
  }

  // A show's folder is the one above its seasons, which only `getShows` knows.
  for (const show of getShows()) {
    if (show.tmdb) byDir.set(show.dir, { id: show.tmdb.id, media: "tv" });
  }

  // Failing that, the folder's own name against the shows already matched.
  // Artwork outlives the episodes it sits beside — a root removed from the
  // library, or not yet scanned back in, leaves the folder unclaimed — and the
  // name is enough to place it.
  const byName = new Map(
    (
      db
        .prepare(
          "SELECT show_key, tmdb_id FROM tv_matches WHERE tmdb_id IS NOT NULL",
        )
        .all() as { show_key: string; tmdb_id: number }[]
    ).map((r) => [r.show_key, r.tmdb_id]),
  );

  for (const { dir } of rows) {
    if (byDir.has(dir)) continue;
    const id = byName.get(
      titleKey(path.basename(dir).replace(/\s*-\s*/g, " ")),
    );
    if (id !== undefined) byDir.set(dir, { id, media: "tv" });
  }

  return rows
    .map(({ dir }) => {
      const known = byDir.get(dir);
      return known ? { dir, tmdbId: known.id, media: known.media } : undefined;
    })
    .filter((t): t is Target => t !== undefined);
}

/** Images on the drive whose source is still unknown. */
export function countUnidentifiedArtwork(): number {
  const row = db
    .prepare(
      `SELECT
         SUM(poster IS NOT NULL AND poster_src IS NULL)
       + SUM(fanart IS NOT NULL AND fanart_src IS NULL)
       + SUM(logo   IS NOT NULL AND logo_src   IS NULL) AS n
       FROM artwork`,
    )
    .get() as { n: number | null };
  return row.n ?? 0;
}

export type IdentifyResult = {
  exact: number;
  approximate: number;
  unknown: number;
};

/**
 * Fills in the source of artwork already on the drive.
 *
 * Runs once per folder and remembers the answer, so a second call does nothing.
 * Anything it cannot place is left alone rather than guessed at wholesale — a
 * blank is honest, and the next run can try again.
 */
export async function identifyArtwork(
  extra: Target[] = [],
  /**
   * Kinds where showing the title's best image beats showing nothing.
   *
   * A file that is not a TMDb image at all — a fanart.tv logo, a crop of your
   * own — cannot be identified, and for a poster or a backdrop that costs
   * nothing: the record's own image already stands in. A logo has no such
   * stand-in, so without this the title simply has no logo whenever the drive
   * is unplugged. What is recorded is a substitute, and it is only ever read
   * when the real file cannot be.
   */
  substitute: readonly ("poster" | "fanart" | "logo")[] = [],
): Promise<IdentifyResult> {
  const result: IdentifyResult = { exact: 0, approximate: 0, unknown: 0 };
  if (!hasCredentials()) return result;

  const targets = [...pending(), ...extra];

  for (const target of targets) {
    const row = db
      .prepare(
        `SELECT poster, fanart, logo, poster_src, fanart_src, logo_src
           FROM artwork WHERE dir = ?`,
      )
      .get(target.dir) as
      | Record<
          | "poster"
          | "fanart"
          | "logo"
          | "poster_src"
          | "fanart_src"
          | "logo_src",
          string | null
        >
      | undefined;
    if (!row) continue;

    let images;
    try {
      images =
        target.media === "tv"
          ? await getTvImages(target.tmdbId)
          : await getImages(target.tmdbId);
    } catch {
      continue;
    }

    const lists = {
      poster: images.posters,
      fanart: images.backdrops,
      logo: (images.logos ?? []).filter((i) => !i.file_path.endsWith(".svg")),
    } as const;

    for (const kind of ["poster", "fanart", "logo"] as const) {
      const file = row[kind];
      if (!file || row[`${kind}_src`]) continue;

      let found = await identify(file, lists[kind]);
      if (!found && substitute.includes(kind) && lists[kind].length > 0) {
        found = { path: lists[kind][0].file_path, exact: false };
      }
      if (!found) {
        result.unknown += 1;
        continue;
      }

      db.prepare(`UPDATE artwork SET ${kind}_src = ? WHERE dir = ?`).run(
        found.path,
        target.dir,
      );
      if (found.exact) result.exact += 1;
      else result.approximate += 1;
    }
  }

  return result;
}
