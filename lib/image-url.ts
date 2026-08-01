/**
 * TMDb image URLs. Shared by server and client, so no `server-only` import —
 * these are public CDN paths and carry no credentials.
 */
export const IMAGE_BASE = "https://image.tmdb.org/t/p";

/** `size` is a TMDb bucket: w92, w342, w780, original… */
export const imageUrl = (filePath: string, size: string) =>
  `${IMAGE_BASE}/${size}${filePath}`;
