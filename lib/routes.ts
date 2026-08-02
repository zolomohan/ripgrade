/**
 * URL helpers shared by server and client code, so this module must stay free
 * of `server-only` imports and Node built-ins.
 */

/** Streams artwork off the external drive; see app/api/art/route.ts. */
export const artUrl = (filePath: string) =>
  `/api/art?p=${encodeURIComponent(filePath)}`;

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
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
