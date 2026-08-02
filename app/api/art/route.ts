import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { MIME_TYPES } from "@/lib/artwork";
import { db } from "@/lib/db";

/**
 * Artwork lives on the external drive, outside `public/`, so it cannot be served
 * statically. This streams it from disk instead.
 *
 * Only paths already recorded in the `artwork` table are served — not as a
 * security boundary (this app is local-only) but so a malformed query returns a
 * clean 404 rather than streaming some unrelated file.
 */
export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("p");
  if (!target) return new Response("Missing ?p", { status: 400 });

  // Every artwork column, not a list that has to be remembered: a kind added to
  // the table but not to this check is served as a 404, which is exactly how
  // logos arrived broken.
  const known = db
    .prepare(
      "SELECT 1 FROM artwork WHERE poster = ? OR fanart = ? OR logo = ?",
    )
    .get(target, target, target);
  if (!known) return new Response(`Not a known artwork path: ${target}`, { status: 404 });

  const type = MIME_TYPES[path.extname(target).toLowerCase()];
  if (!type) return new Response("Unsupported image type", { status: 415 });

  let size: number;
  let mtimeMs: number;
  try {
    const stats = await stat(target);
    size = stats.size;
    mtimeMs = stats.mtimeMs;
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 404 });
  }

  const etag = `"${size}-${Math.floor(mtimeMs)}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304 });
  }

  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream;

  return new Response(stream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(size),
      // Posters change only when the file on disk does, and the ETag catches that.
      "Cache-Control": "public, max-age=3600, must-revalidate",
      ETag: etag,
    },
  });
}
