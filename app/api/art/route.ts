import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { MIME_TYPES } from "@/lib/artwork";
import { db } from "@/lib/db";
import { getThumb, THUMB_WIDTHS } from "@/lib/thumbs";

/**
 * Artwork lives on the external drive, outside `public/`, so it cannot be served
 * statically. This streams it from disk instead.
 *
 * With `?w=` it streams a cached thumbnail from the internal disk instead —
 * generated on first ask, and served even with the drive unplugged. See
 * lib/thumbs.ts. Without it, the original file as before: the detail pages
 * want full resolution, and full resolution is the drive's to give.
 *
 * Only paths already recorded in the `artwork` table are served — not as a
 * security boundary (this app is local-only) but so a malformed query returns a
 * clean 404 rather than streaming some unrelated file.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = params.get("p");
  if (!target) return new Response("Missing ?p", { status: 400 });

  // Every artwork column, not a list that has to be remembered: a kind added to
  // the table but not to this check is served as a 404, which is exactly how
  // logos arrived broken.
  const known = db
    .prepare("SELECT 1 FROM artwork WHERE poster = ? OR fanart = ? OR logo = ?")
    .get(target, target, target);
  if (!known)
    return new Response(`Not a known artwork path: ${target}`, { status: 404 });

  let type = MIME_TYPES[path.extname(target).toLowerCase()];
  if (!type) return new Response("Unsupported image type", { status: 415 });

  // The file actually sent: the original, or its cached thumbnail. A thumb
  // request that cannot be honoured — sharp choking on the file — falls back
  // to the original rather than failing; only a missing original is a 404,
  // and the <img> onError fallback takes over from there.
  let served = target;
  const width = Number(params.get("w"));
  if (width && THUMB_WIDTHS.has(width)) {
    const thumb = await getThumb(target, width);
    if (thumb) {
      served = thumb;
      type = "image/webp";
    }
  }

  let size: number;
  let mtimeMs: number;
  try {
    const stats = await stat(served);
    size = stats.size;
    mtimeMs = stats.mtimeMs;
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), {
      status: 404,
    });
  }

  // A versioned URL is a new URL every time the folder is re-indexed, so it can
  // be held without asking. An unversioned one is the same URL before and after
  // a poster is replaced, so it has to be revalidated — cheap, since the ETag
  // below turns an unchanged file into a 304.
  const versioned = params.has("v");
  const cacheControl = versioned
    ? "public, max-age=3600, must-revalidate"
    : "no-cache";

  const etag = `"${size}-${Math.floor(mtimeMs)}"`;
  if (request.headers.get("if-none-match") === etag) {
    // Repeated on the 304 as well: it is what tells the browser how long the
    // copy it already has stays good for.
    return new Response(null, {
      status: 304,
      headers: { "Cache-Control": cacheControl, ETag: etag },
    });
  }

  const stream = Readable.toWeb(createReadStream(served)) as ReadableStream;

  return new Response(stream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(size),
      "Cache-Control": cacheControl,
      ETag: etag,
    },
  });
}
