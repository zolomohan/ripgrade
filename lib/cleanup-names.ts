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

/**
 * What dovi_convert and mkvmerge leave behind when they are not allowed to
 * finish. Both write beside the film, under a name derived from its own.
 *
 * The last five are a rebuild's: the base layer, the base layer with its
 * Profile 8.1 metadata stripped, the enhancement layer unpacked out of the
 * archive, the two of them interleaved, and the rebuilt film itself in the
 * moment before it is renamed over the one it replaces. Every one of them is
 * named from the stem with an underscore, which is dovi_convert's convention
 * for a working file and not a name any film arrives with.
 *
 * The rebuilt file is the only one of these that is a playable film, and it is
 * still rubbish: it exists only where a rebuild was killed between the mux and
 * the rename, and the film it was rebuilt from is still sitting beside it.
 */
const LEFTOVERS: { suffix: string; fromStem: boolean }[] = [
  // dovi_convert names its working files from the film with the extension
  // replaced, so what is left when one is stripped off is the stem and not the
  // file. mkvmerge's is appended to the whole name, extension and all.
  { suffix: ".p81.hevc", fromStem: true },
  { suffix: ".p81.tmp", fromStem: true },
  { suffix: ".audio-strip.tmp", fromStem: false },
  { suffix: "_bl.hevc", fromStem: true },
  { suffix: "_bl_clean.hevc", fromStem: true },
  { suffix: "_el.hevc", fromStem: true },
  { suffix: "_restored.hevc", fromStem: true },
  { suffix: ".restored.mkv", fromStem: true },
];

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

  for (const { suffix, fromStem } of LEFTOVERS) {
    if (!name.endsWith(suffix)) continue;
    return { kind: "leftover", base: name.slice(0, -suffix.length), fromStem };
  }

  return undefined;
}
