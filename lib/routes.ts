/**
 * URL helpers shared by server and client code, so this module must stay free
 * of `server-only` imports and Node built-ins.
 */

/**
 * Streams artwork off the external drive; see app/api/art/route.ts.
 *
 * `version` is when the folder was last re-indexed. Replacing a poster writes
 * over `poster.jpg`, so without it the URL after the swap is the one the
 * browser already has: React sees an unchanged `src` and leaves the `<img>`
 * alone, and even a reload is answered from the disk cache. Changing the URL is
 * what makes the new picture appear. The route ignores the parameter.
 */
export const artUrl = (filePath: string, version?: number) =>
  `/api/art?p=${encodeURIComponent(filePath)}${version ? `&v=${version}` : ""}`;

/**
 * Names a poster so the browser can recognise it on both sides of a
 * navigation: the tile in a listing and the poster on the page it opens are
 * one object, and this is what says so.
 *
 * Takes the same key the route does — a film's path, a show's key — so the two
 * cannot drift apart. Prefixed because the encoding can begin with a digit, and
 * a CSS identifier cannot.
 */
export const posterName = (key: string) => `poster-${encodeId(key)}`;

/**
 * Route id for a film. The absolute path is the natural key but contains
 * slashes, so it is base64url-encoded to survive a single URL segment.
 *
 * Encoded via TextEncoder rather than Buffer: this runs in the browser too, and
 * folder names contain non-ASCII characters (exFAT-safe titles use U+A789 in
 * place of a colon) that a byte-naive encoder would corrupt.
 */
export function encodeId(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeId(id: string): string {
  const base64 = id.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export const movieId = encodeId;
export const decodeMovieId = decodeId;

/** Route id for a duplicate group, built from its title+year grouping key. */
export const compareId = encodeId;

/** A show is addressed by its title key, which survives a rescan unchanged. */
export const showId = encodeId;
export const decodeShowId = decodeId;
