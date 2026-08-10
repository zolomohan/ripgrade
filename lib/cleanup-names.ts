import { AUDIO_BACKUP_SUFFIX, BACKUP_SUFFIX } from "./derive";

/**
 * Reading a filename and saying what this app left it there for.
 *
 * Kept apart from the scan in `queue-tasks.ts`, which reads directories and
 * deletes things, because this half is pure and is where the mistakes would
 * live: every answer below stands between a name on a drive and a row offering
 * to delete it. Getting it wrong in one direction leaves junk lying around, and
 * in the other offers somebody's only copy of a film as rubbish to be swept up.
 * The same split `audio-plan.ts` makes from `audio-strip.ts`, and for the same
 * reason — this is the half worth testing exhaustively, and it can be.
 */

export type CleanupKind = "dovi-backup" | "audio-backup" | "leftover";

export type Artefact = {
  kind: CleanupKind;
  /**
   * What the name says it was made from: the film's own filename, or — where
   * the tool replaced the extension rather than appending to it — the stem.
   */
  base: string;
  /** True when `base` is that stem, and so has to be matched without one. */
  fromStem: boolean;
};

/** What dovi_convert and mkvmerge leave behind when they are not allowed to
    finish. Both write beside the film, under a name derived from its own. */
const LEFTOVER_SUFFIXES = [".p81.hevc", ".p81.tmp", ".audio-strip.tmp"];

/** `<film>.restoring-4821` — the aside a restore renames the film through, and
    all that is left of one if the process dies between the two renames. */
const RESTORING = /\.restoring-\d+$/;

/**
 * macOS writes a `._name` beside every file on an exFAT drive to hold the
 * metadata the filesystem cannot. One exists for each artefact below — named
 * after a file that matches, so it matches too — and it is four kilobytes of
 * Finder bookkeeping rather than anything worth reclaiming. Never listed; it is
 * deleted with the file it describes instead.
 */
export const isSidecar = (name: string) => name.startsWith("._");

/** The sidecar macOS would have written for a given file. */
export const sidecarFor = (name: string) => `._${name}`;

/** A filename with its final extension removed — `Film.mkv` → `Film`. */
export const stemOf = (filePath: string) => filePath.replace(/\.[^.]+$/, "");

/**
 * What this app wrote a file for, or undefined if it did not write it.
 *
 * Anchored at the end of the name in every case: a film called
 * `The.Restoring-1988.mkv` is a film, and a prefix or a loose match anywhere in
 * the name is how it would end up on a list of things to throw away.
 */
export function artefactOf(name: string): Artefact | undefined {
  if (isSidecar(name)) return undefined;

  if (name.endsWith(BACKUP_SUFFIX)) {
    return {
      kind: "dovi-backup",
      base: name.slice(0, -BACKUP_SUFFIX.length),
      fromStem: false,
    };
  }
  if (name.endsWith(AUDIO_BACKUP_SUFFIX)) {
    return {
      kind: "audio-backup",
      base: name.slice(0, -AUDIO_BACKUP_SUFFIX.length),
      fromStem: false,
    };
  }
  if (RESTORING.test(name)) {
    return {
      kind: "leftover",
      base: name.replace(RESTORING, ""),
      fromStem: false,
    };
  }

  for (const suffix of LEFTOVER_SUFFIXES) {
    if (!name.endsWith(suffix)) continue;
    return {
      kind: "leftover",
      base: name.slice(0, -suffix.length),
      // dovi_convert names its working files from the film with the extension
      // replaced, so what is left is the stem and not the file. mkvmerge's is
      // appended to the whole name, extension and all.
      fromStem: suffix.startsWith(".p81"),
    };
  }

  return undefined;
}
