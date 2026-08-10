import type { AudioTrack } from "./derive";

/**
 * Deciding which audio tracks go, and what removing them is worth.
 *
 * Kept apart from `audio-strip.ts`, which is the part that spawns mkvmerge and
 * renames files, because this half is pure and is where the mistakes would
 * live: every check below stands between a tick on a page and a track being
 * removed from a file that may no longer be the file the page described. The
 * same split `torznab.ts` makes from `jackett.ts`, and for the same reason —
 * this is the half worth testing exhaustively, and it can be.
 */

/** One track as mkvmerge itself sees it — the only authority on its own IDs. */
export type ContainerTrack = {
  /** What `--audio-tracks` selects on: every stream counted from zero. */
  id: number;
  type: string;
  /** The Matroska track number, which MediaInfo reports as `ID`. */
  number?: number;
  language?: string;
  codec?: string;
};

/**
 * What the page asked for, in the only terms it can safely ask in.
 *
 * Audio tracks are named by their position among the audio tracks alone,
 * because that is what the table on the page is a list of — and unlike a
 * container ID it means the same thing whether or not the film has been
 * re-derived since the fields carrying those IDs were added.
 */
export type StripPlan = {
  /** Which audio tracks go, counted among the audio tracks alone from zero. */
  removeOrdinals: number[];
  /** How many audio tracks the page believed the file held. */
  audioCount: number;
  /**
   * Every audio track's Matroska number as the page had it, by ordinal — the
   * second opinion the check below is made against. Sent whole rather than
   * only for the removed ones so the two lists line up by index.
   */
  numbers?: (number | undefined)[];
};

export type ResolvedPlan = {
  /**
   * The audio tracks mkvmerge should keep, in its own numbering. Audio only:
   * `--audio-tracks` is a filter over the audio tracks alone, and video,
   * subtitles, chapters and attachments are all kept by not being mentioned.
   */
  keepIds: number[];
  /** How many audio tracks the film will be left with. */
  keptAudio: number;
  removedAudio: number;
};

/** Only Matroska. mkvmerge reads an MP4 but can only write an MKV, and
    silently changing a film's container is not what "remove a track" means. */
export const canStripAudio = (filePath: string) =>
  filePath.toLowerCase().endsWith(".mkv");

/**
 * Turns a plan into a keep list, and refuses if anything about the file has
 * moved underneath it.
 *
 * Every check here exists because the alternative is removing the wrong track
 * from a 90 GB file, so all of them run before anything is spawned and each
 * fails with the sentence the page should show.
 */
export function resolvePlan(
  container: ContainerTrack[],
  plan: StripPlan,
): ResolvedPlan {
  const audio = container.filter((t) => t.type === "audio");

  if (audio.length !== plan.audioCount) {
    throw new Error(
      `This file now holds ${audio.length} audio track${
        audio.length === 1 ? "" : "s"
      }, not the ${plan.audioCount} this page was showing. Rescan and try again.`,
    );
  }

  const remove = new Set(plan.removeOrdinals);
  if (remove.size === 0) throw new Error("No audio tracks were selected.");

  for (const ordinal of remove) {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= audio.length) {
      throw new Error(`No audio track ${ordinal} in this file.`);
    }
  }

  // MediaInfo numbered these tracks when the film was scanned and mkvmerge is
  // numbering them now. If the two disagree about which Matroska track sits at
  // a given position, the file is not the one the page described, and nothing
  // should be rewritten on the strength of it. Only the tracks being removed
  // are checked: a keeper that has moved is caught by the count, and failing on
  // it would refuse a removal that is still perfectly well specified.
  plan.numbers?.forEach((number, ordinal) => {
    if (number === undefined || !remove.has(ordinal)) return;
    const found = audio[ordinal]?.number;
    if (found !== undefined && found !== number) {
      throw new Error(
        "The file's audio tracks are not in the order this page was showing. Rescan and try again.",
      );
    }
  });

  const keptAudio = audio.length - remove.size;
  if (keptAudio < 1) {
    throw new Error(
      "That would leave the film with no audio at all. Keep at least one track.",
    );
  }

  return {
    keepIds: audio
      .filter((_, ordinal) => !remove.has(ordinal))
      .map((t) => t.id),
    keptAudio,
    removedAudio: remove.size,
  };
}

/**
 * What removing a set of tracks would free.
 *
 * Three answers rather than one number, because the three are different
 * promises and the page has to word them differently. MediaInfo counts a
 * track's size for nearly all of them, works it out from the bitrate for the
 * rest, and on the odd track can do neither — so a total can be exact, an
 * approximation, or a floor, and saying "frees 8.4 GB" when it is a floor is
 * the one outcome worth avoiding.
 */
export function savingsOf(
  tracks: AudioTrack[],
  ordinals: Iterable<number>,
): { bytes: number; estimated: boolean; incomplete: boolean } {
  let bytes = 0;
  let estimated = false;
  let incomplete = false;

  for (const ordinal of new Set(ordinals)) {
    const track = tracks[ordinal];
    if (!track) continue;
    if (track.sizeBytes === undefined) {
      incomplete = true;
      continue;
    }
    bytes += track.sizeBytes;
    if (track.sizeEstimated) estimated = true;
  }

  return { bytes, estimated, incomplete };
}

/**
 * Ticking a row, and ticking every row between it and the last one touched.
 *
 * Shift-click does what it does in every file list: whichever way the clicked
 * box was going, the whole run between it and the anchor goes the same way. A
 * rip with twelve foreign tracks is one gesture rather than twelve, and
 * unticking a run works identically — which is the half that makes it a
 * checkbox rather than a shortcut.
 *
 * Here rather than in the component because it is the only part of that
 * interaction a test can reach: what a browser does with a shift-held click on
 * a label is the browser's business, but which boxes end up ticked is this
 * function's, and a range that comes out inverted or off by one is a track
 * removed from a 90 GB file that nobody meant to remove.
 */
export function tickRange(
  selected: ReadonlySet<number>,
  ordinal: number,
  /** The last row ticked by hand, or null if this is the first of a session. */
  anchor: number | null,
  /** Whether shift was held, which extends instead of toggling. */
  range: boolean,
  /** How many audio tracks the file holds, which is the ceiling below. */
  total: number,
): Set<number> {
  const next = new Set(selected);
  // What the clicked box itself is doing decides what the whole run does.
  const checking = !next.has(ordinal);

  // With nothing to measure from, a shift-click is simply a click.
  const extend = range && anchor !== null;
  const first = extend ? Math.min(anchor, ordinal) : ordinal;
  const last = extend ? Math.max(anchor, ordinal) : ordinal;

  for (let i = first; i <= last; i += 1) {
    if (checking) next.add(i);
    else next.delete(i);
  }

  // A run across the whole table stops one short. Removing every audio track
  // leaves a silent film, which nobody has ever meant to ask for — and a
  // gesture that covers everything means "all of these", not "all of these and
  // never mind what is left". The first track is what survives it: it is the
  // one a player reaches for by default, and keeping a fixed end means the
  // rule can be stated rather than discovered.
  while (next.size >= total && next.size > 0) {
    next.delete(Math.min(...next));
  }
  return next;
}

// ---------------------------------------------------------------------------
// Which languages are worth keeping
// ---------------------------------------------------------------------------

/**
 * One language, however it happened to be spelled.
 *
 * A track carries whatever the muxer wrote and the three sources never agree:
 * MediaInfo normalises to the two-letter "en", mkvmerge reports the
 * three-letter "eng", TMDb says "en", and a disc rip is as likely to say "fre"
 * as "fra" or "fr-FR". The platform already knows all of it — the canonicaliser
 * maps the bibliographic codes onto the modern ones — so it is asked rather than
 * a table being kept here and going stale.
 *
 * Regions are dropped: someone who wants Portuguese wants the Brazilian track
 * too, and a preference list that distinguished them would be a list nobody
 * could finish filling in.
 */
export function languageKey(code: string): string {
  const tag = code.trim().replace(/_/g, "-");
  try {
    return (Intl.getCanonicalLocales(tag)[0] ?? tag).split("-")[0].toLowerCase();
  } catch {
    // Not a tag at all — a private code, or something the muxer invented. It
    // still names itself consistently, so it can still be matched on.
    return tag.split("-")[0].toLowerCase();
  }
}

/**
 * Both codes for English, and a region after either.
 *
 * A track with no language tag at all is not evidence of anything: on an
 * English-language release an untagged track is usually the English one. So
 * this answers only the question it can — a track it says no to is a track that
 * named a language, and named another one.
 */
export const isEnglish = (code?: string) =>
  code !== undefined && languageKey(code) === "en";

/**
 * The languages you want kept, and whether the film's own counts as one.
 *
 * `original` is a language you cannot name in advance: it is Japanese on a
 * Japanese film and Danish on a Danish one, and it is the one track that is the
 * performance rather than a dub of it. TMDb knows which it is per film, so the
 * preference names the *idea* and each film resolves it.
 */
export type AudioPreference = {
  /** Canonical keys — see `languageKey`. */
  languages: string[];
  /** Keep whatever language the film was made in, whichever that turns out to be. */
  original: boolean;
};

/** The literal that stands for the original language in stored settings. */
export const ORIGINAL = "original";

/**
 * Whether a track is one you asked to keep.
 *
 * Untagged is never "not preferred": a track that names no language has not
 * told us anything, and reading silence as "some language you did not ask for"
 * is how the English track of an English film gets removed.
 */
export function isPreferred(
  code: string | undefined,
  preference: AudioPreference,
  /** What TMDb says the film was made in, where the film is matched. */
  originalLanguage?: string,
): boolean {
  if (code === undefined) return true;

  const key = languageKey(code);
  if (preference.languages.some((wanted) => languageKey(wanted) === key)) {
    return true;
  }
  return Boolean(
    preference.original &&
      originalLanguage &&
      languageKey(originalLanguage) === key,
  );
}

/**
 * Which tracks a rip could shed, given what you want kept.
 *
 * Ordinals rather than tracks, because that is what the page ticks and what the
 * plan above is written in. Never every track: a proposal that would silence
 * the film is not a proposal, and the caller is told to leave the file alone
 * rather than handed a shortened list that no longer means what it says.
 */
export function removableTracks(
  tracks: AudioTrack[],
  preference: AudioPreference,
  originalLanguage?: string,
): number[] {
  const removable = tracks
    .map((track, ordinal) => ({ track, ordinal }))
    .filter(({ track }) => !isPreferred(track.language, preference, originalLanguage))
    .map(({ ordinal }) => ordinal);

  return removable.length >= tracks.length ? [] : removable;
}

/**
 * Whether the preference cannot be answered for this film.
 *
 * "Keep the original language" is a promise about a fact nobody has: an
 * unmatched film has no TMDb record, so there is no telling which of its five
 * tracks is the performance. Better to say nothing about that file than to
 * guess at it with a rewrite.
 */
export const originalUnknown = (
  preference: AudioPreference,
  originalLanguage?: string,
) => preference.original && !originalLanguage;
