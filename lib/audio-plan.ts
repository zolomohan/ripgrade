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
 * Tracks are named by their position among the tracks of their own kind,
 * because that is what each table on the page is a list of — and unlike a
 * container ID it means the same thing whether or not the film has been
 * re-derived since the fields carrying those IDs were added.
 *
 * Audio and subtitles travel together in one plan because they are one
 * operation: mkvmerge rewrites the whole file either way, and the original is
 * kept beside it under a single name. Removing the two in two passes would
 * rewrite a 90 GB film twice and — since a second removal refuses while that
 * original is still there — could not be done at all without restoring in
 * between.
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
  /** The same three, for the text tracks. Absent means "leave subtitles be". */
  removeSubtitleOrdinals?: number[];
  subtitleCount?: number;
  subtitleNumbers?: (number | undefined)[];
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
  /**
   * The text tracks to keep, and the one field here where empty and absent
   * differ. `undefined` means the plan said nothing about subtitles, so none
   * are mentioned to mkvmerge and every one of them survives untouched. An
   * empty array means every one of them was ticked, which is a thing somebody
   * may legitimately want and which `--no-subtitles` is how you ask for.
   */
  keepSubtitleIds?: number[];
  keptSubtitles: number;
  removedSubtitles: number;
};

/** Only Matroska. mkvmerge reads an MP4 but can only write an MKV, and
    silently changing a film's container is not what "remove a track" means. */
export const canStripTracks = (filePath: string) =>
  filePath.toLowerCase().endsWith(".mkv");

/**
 * One kind of track, in the terms the checks below need to talk about it.
 *
 * Audio and text are checked identically and differ in exactly two ways: the
 * noun a refusal is worded with, and whether the film has to be left holding
 * at least one. Writing that difference down here rather than as two near-copies
 * of the same forty lines is what stops the two drifting apart, which on this
 * particular pair of functions means one of them quietly losing a guard.
 */
type Kind = {
  /** mkvmerge's own word for it, which is what `ContainerTrack.type` holds. */
  type: "audio" | "subtitles";
  noun: string;
  /** Whether removing every one of them is a thing to refuse. */
  atLeastOne: boolean;
};

const AUDIO: Kind = { type: "audio", noun: "audio", atLeastOne: true };
/** A film with no subtitles at all is a normal film, so nothing is held back. */
const TEXT: Kind = { type: "subtitles", noun: "subtitle", atLeastOne: false };

/**
 * Checks one kind of track against what the page believed, and returns the
 * keep list for it.
 *
 * Every check here exists because the alternative is removing the wrong track
 * from a 90 GB file, so all of them run before anything is spawned and each
 * fails with the sentence the page should show.
 */
function resolveKind(
  container: ContainerTrack[],
  kind: Kind,
  count: number,
  removeOrdinals: number[],
  numbers?: (number | undefined)[],
): { keepIds: number[]; kept: number; removed: number } {
  const tracks = container.filter((t) => t.type === kind.type);

  if (tracks.length !== count) {
    throw new Error(
      `This file now holds ${tracks.length} ${kind.noun} track${
        tracks.length === 1 ? "" : "s"
      }, not the ${count} this page was showing. Rescan and try again.`,
    );
  }

  const remove = new Set(removeOrdinals);

  for (const ordinal of remove) {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= tracks.length) {
      throw new Error(`No ${kind.noun} track ${ordinal} in this file.`);
    }
  }

  // MediaInfo numbered these tracks when the film was scanned and mkvmerge is
  // numbering them now. If the two disagree about which Matroska track sits at
  // a given position, the file is not the one the page described, and nothing
  // should be rewritten on the strength of it. Only the tracks being removed
  // are checked: a keeper that has moved is caught by the count, and failing on
  // it would refuse a removal that is still perfectly well specified.
  numbers?.forEach((number, ordinal) => {
    if (number === undefined || !remove.has(ordinal)) return;
    const found = tracks[ordinal]?.number;
    if (found !== undefined && found !== number) {
      throw new Error(
        `The file's ${kind.noun} tracks are not in the order this page was showing. Rescan and try again.`,
      );
    }
  });

  const kept = tracks.length - remove.size;
  if (kind.atLeastOne && kept < 1) {
    throw new Error(
      `That would leave the film with no ${kind.noun} at all. Keep at least one track.`,
    );
  }

  return {
    keepIds: tracks
      .filter((_, ordinal) => !remove.has(ordinal))
      .map((t) => t.id),
    kept,
    removed: remove.size,
  };
}

/**
 * Turns a plan into keep lists, and refuses if anything about the file has
 * moved underneath it.
 *
 * Both kinds are resolved even when only one of them is being touched, because
 * the count check is worth running on the kind that is not: a file whose
 * subtitle count no longer matches is a file that has been remuxed since the
 * page was drawn, and that is exactly when the audio ordinals should not be
 * trusted either.
 */
export function resolvePlan(
  container: ContainerTrack[],
  plan: StripPlan,
): ResolvedPlan {
  const audio = resolveKind(
    container,
    AUDIO,
    plan.audioCount,
    plan.removeOrdinals,
    plan.numbers,
  );

  const text =
    plan.subtitleCount === undefined
      ? undefined
      : resolveKind(
          container,
          TEXT,
          plan.subtitleCount,
          plan.removeSubtitleOrdinals ?? [],
          plan.subtitleNumbers,
        );

  if (audio.removed === 0 && (text?.removed ?? 0) === 0) {
    throw new Error("No tracks were selected.");
  }

  return {
    keepIds: audio.keepIds,
    keptAudio: audio.kept,
    removedAudio: audio.removed,
    // Only mentioned to mkvmerge when the plan actually asked for a change:
    // naming a keep list that happens to be every track is the same file and a
    // needless way to get it wrong.
    keepSubtitleIds: text && text.removed > 0 ? text.keepIds : undefined,
    keptSubtitles: text?.kept ?? 0,
    removedSubtitles: text?.removed ?? 0,
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
  /** Anything that costs bytes — both track tables are read by this. */
  tracks: readonly { sizeBytes?: number; sizeEstimated?: boolean }[],
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
  /**
   * Every ordinal of this kind, in the order the table actually draws them.
   *
   * The rows are not in file order — the tracks the preference keeps are
   * lifted to the top — so a run has to be measured across the table as it is
   * seen rather than between two numbers. Handed the ordinals in file order
   * this behaves exactly as it did when it took a count.
   */
  order: readonly number[],
  /**
   * Whether one has to survive. True of audio, where a run across the whole
   * table stops one short; false of subtitles, where removing the lot is a
   * perfectly ordinary thing to want and stopping short of it would be the
   * surprise.
   */
  keepOne = true,
): Set<number> {
  const next = new Set(selected);
  // What the clicked box itself is doing decides what the whole run does.
  const checking = !next.has(ordinal);

  const at = order.indexOf(ordinal);
  // A click on a row this table is not drawing is not a click on anything.
  if (at === -1) return next;

  // With nothing to measure from, a shift-click is simply a click — and an
  // anchor the table no longer draws is nothing to measure from.
  const from = range && anchor !== null ? order.indexOf(anchor) : -1;
  const first = from === -1 ? at : Math.min(from, at);
  const last = from === -1 ? at : Math.max(from, at);

  for (let i = first; i <= last; i += 1) {
    if (checking) next.add(order[i]);
    else next.delete(order[i]);
  }

  // A run across the whole table stops one short. Removing every audio track
  // leaves a silent film, which nobody has ever meant to ask for — and a
  // gesture that covers everything means "all of these", not "all of these and
  // never mind what is left".
  //
  // The lowest ordinal is what survives it, which is the film's first audio
  // track and not necessarily the table's first row. That is deliberate: the
  // reason to keep that one is that it is the track a player reaches for by
  // default, and a player reads the file rather than this table.
  while (keepOne && next.size >= order.length && next.size > 0) {
    next.delete(Math.min(...next));
  }
  return next;
}

/**
 * The order a table draws its rows in: everything you keep, first.
 *
 * A rip pressed for nine markets is a table where the two rows that matter —
 * the track you will actually play, and the subtitle you will actually turn on
 * — are somewhere in the middle of it. Lifting them out is the difference
 * between reading the table and scanning it.
 *
 * Stable within each half, so file order still governs among the kept and
 * among the rest, and ordinals rather than tracks: the selection, the plan and
 * every check on the way to mkvmerge are written in a track's position in the
 * file, and none of them should learn that a table reordered itself.
 *
 * Worth computing from the preference alone and never from the ticks. An order
 * that answered to the selection would move a row out from under the cursor at
 * the moment it was clicked.
 */
export function keptFirst<T>(
  tracks: readonly T[],
  kept: (track: T, ordinal: number) => boolean,
): number[] {
  const ordinals = tracks.map((_, ordinal) => ordinal);
  return [
    ...ordinals.filter((ordinal) => kept(tracks[ordinal], ordinal)),
    ...ordinals.filter((ordinal) => !kept(tracks[ordinal], ordinal)),
  ];
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

// ---------------------------------------------------------------------------
// Which subtitles are worth keeping
// ---------------------------------------------------------------------------

/**
 * The same language question as audio, plus the two flags that override it.
 *
 * Subtitles need the extra two because a text track's language is not on its
 * own a reason to keep or drop it, the way an audio track's is:
 *
 * - **Forced** subtitles are not a translation of the film, they are the signs
 *   and the twenty seconds of Elvish. On an English film watched in English
 *   they are the one text track that gets used, and dropping them because
 *   "English is the language I keep, and this is tagged Hungarian" is how you
 *   lose the subtitle you actually needed.
 * - **SDH** goes the other way. It is in a language you keep by definition, so
 *   the language rule can never remove it — and a house with nobody hard of
 *   hearing has one of these per film doing nothing but lengthening the menu.
 *
 * So one flag rescues across languages and the other condemns within one. They
 * are not symmetrical because the things they describe are not.
 */
export type SubtitlePreference = AudioPreference & {
  /** Keep a forced track whatever language it names. */
  forced: boolean;
  /** Keep the hard-of-hearing tracks, rather than dropping them where kept. */
  sdh: boolean;
};

/** What a track has to say about itself for the rules above to read it. */
type SubtitleFacts = { language?: string; forced: boolean; sdh: boolean };

/**
 * Whether a subtitle track is one you asked to keep.
 *
 * Ordered, and the order is the whole of it: forced rescues before anything
 * else looks at the language, and SDH is asked only of a track the language
 * rule was otherwise going to keep.
 */
export function isSubtitleKept(
  track: SubtitleFacts,
  preference: SubtitlePreference,
  originalLanguage?: string,
): boolean {
  if (preference.forced && track.forced) return true;
  if (!preference.sdh && track.sdh) return false;
  return isPreferred(track.language, preference, originalLanguage);
}

/**
 * Which text tracks a rip could shed, given what you want kept.
 *
 * Unlike its audio counterpart this may return every track there is. A film
 * with no subtitles is an ordinary film, and somebody who keeps only English
 * on a disc pressed for six European markets means exactly what the list says.
 */
export function removableSubtitles(
  tracks: SubtitleFacts[],
  preference: SubtitlePreference,
  originalLanguage?: string,
): number[] {
  return tracks
    .map((track, ordinal) => ({ track, ordinal }))
    .filter(({ track }) => !isSubtitleKept(track, preference, originalLanguage))
    .map(({ ordinal }) => ordinal);
}
