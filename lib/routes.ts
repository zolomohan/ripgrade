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
 *
 * `width` asks for the cached thumbnail instead of the full file — one of the
 * widths lib/thumbs.ts allows. Omit it for the originals the detail heroes
 * want.
 */
export const artUrl = (filePath: string, version?: number, width?: number) =>
  `/api/art?p=${encodeURIComponent(filePath)}${version ? `&v=${version}` : ""}${
    width ? `&w=${width}` : ""
  }`;

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
 * The same idea for a collection's name: the title in the list and the heading
 * on the set's own page are one piece of text, and this is what says so.
 *
 * Takes a key rather than a number, because there are two kinds of set now and
 * they number themselves separately: TMDb's id 10 and your tenth collection are
 * different sets, and a name they shared would pair the wrong two headings.
 * `collectionKey` below is what keeps them apart.
 */
export const collectionTitleName = (key: number | string) =>
  `collection-title-${key}`;

/** And the line under it, which says the same thing in both places. */
export const collectionMetaName = (key: number | string) =>
  `collection-meta-${key}`;

/** A set of your own, named apart from the TMDb set that shares its number. */
export const customCollectionKey = (id: number) => `c${id}`;

/**
 * What names a film inside a set — a React key on both shelves, and the key a
 * set of your own files its membership under.
 *
 * TMDb's number wherever there is one, so a film keeps its place in a set
 * through a rescan, a re-rip, and a move to another drive. A film TMDb never
 * matched falls back to its path, which is the only other thing it has — and a
 * film that is nothing but a path is one the app cannot say anything about
 * anyway.
 *
 * A set of your own hands its own key down rather than letting this work it
 * out: a film added off the shelf and since gone from it has neither a number
 * nor a copy left to read a path off, and only the row it was written into
 * still remembers which film the line is about.
 *
 * Here rather than beside `CollectionFilm` because the tiles that call it are
 * in the browser and lib/collections.ts is server-only — the same reason
 * `posterName` above lives here. Typed by the shape it reads rather than by
 * that type, so this module goes on importing nothing.
 */
export const filmKey = (film: {
  key?: string;
  tmdbId?: number;
  owned?: { path: string };
}): string =>
  film.key ??
  (film.tmdbId !== undefined
    ? `t${film.tmdbId}`
    : `p${film.owned?.path ?? ""}`);

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
