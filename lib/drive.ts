/**
 * What to call a folder when the sentence is about the drive it is on.
 *
 * A library root is a path, and a path is what the app says to itself. To
 * somebody reading a failure it is a drive with a name on it, sitting on the
 * desk or not — "Expansion is not plugged in" is a thing you can act on where
 * "/Volumes/Expansion/Movies (not plugged in)" is a thing you have to parse
 * first, and it is the same fact.
 *
 * No `node:` imports and no `server-only`: the scanner writes these sentences
 * and the toaster reads them, and the two must not disagree about what a drive
 * is called.
 */

/**
 * The volume an external drive is mounted under, for a path that lives on one.
 * Null for the internal disk, which is never the thing that went missing.
 */
export function volumeOf(
  filePath: string,
): { path: string; name: string } | null {
  const match = /^\/Volumes\/([^/]+)/.exec(filePath);
  return match ? { path: match[0], name: match[1] } : null;
}

/**
 * The drive if the path is on one, and otherwise the folder itself — a name
 * off the end of the path rather than the whole of it. Inside the container
 * every root is a bind mount with a plain name like `/movies`, which is
 * already the right thing to say.
 */
export function driveName(filePath: string): string {
  const volume = volumeOf(filePath);
  if (volume) return volume.name;
  const last = filePath.replace(/\/+$/, "").split("/").filter(Boolean).pop();
  return last ?? filePath;
}
