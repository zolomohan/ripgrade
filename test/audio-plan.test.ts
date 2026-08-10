import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canStripAudio,
  isEnglish,
  isPreferred,
  languageKey,
  originalUnknown,
  removableTracks,
  resolvePlan,
  savingsOf,
  tickRange,
  type ContainerTrack,
} from "../lib/audio-plan";
import type { AudioTrack } from "../lib/derive";

/*
 * The checks between a tick on a page and a track leaving a 90 GB file.
 *
 * Every refusal below is a real way the plan and the file can disagree, and
 * each one is only worth writing if it actually fires — a guard that silently
 * passes is worse than no guard, because the console reports success either
 * way and the wrong track is already gone.
 */

/** A film as mkvmerge reports one: video, then audio, then subtitles. */
const container = (): ContainerTrack[] => [
  { id: 0, type: "video", number: 1 },
  { id: 1, type: "audio", number: 2, language: "eng" },
  { id: 2, type: "audio", number: 3, language: "fre" },
  { id: 3, type: "audio", number: 4, language: "ger" },
  { id: 4, type: "subtitles", number: 5, language: "eng" },
];

// ---------------------------------------------------------------------------
// Turning a selection into a keep list
// ---------------------------------------------------------------------------

test("removing by position keeps the other audio tracks, by mkvmerge's IDs", () => {
  // Ordinals 1 and 2 are the second and third *audio* tracks, which sit at
  // container IDs 2 and 3 — the off-by-one this whole indirection exists for.
  const plan = resolvePlan(container(), {
    removeOrdinals: [1, 2],
    audioCount: 3,
  });

  assert.deepEqual(plan.keepIds, [1]);
  assert.equal(plan.keptAudio, 1);
  assert.equal(plan.removedAudio, 2);
});

test("the keep list names audio tracks only", () => {
  // Video and subtitles are kept by not being mentioned: `--audio-tracks` is a
  // filter over the audio tracks alone, and listing a video ID there would be
  // asking mkvmerge a question about a track it is not being asked about.
  const plan = resolvePlan(container(), {
    removeOrdinals: [2],
    audioCount: 3,
  });

  assert.deepEqual(plan.keepIds, [1, 2]);
});

test("a repeated position counts once", () => {
  const plan = resolvePlan(container(), {
    removeOrdinals: [1, 1, 1],
    audioCount: 3,
  });

  assert.equal(plan.removedAudio, 1);
  assert.equal(plan.keptAudio, 2);
});

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

test("a file that has gained or lost a track since the page rendered is refused", () => {
  // The page was showing four audio tracks; the file has three. Whatever the
  // ticks meant, they do not mean it now.
  assert.throws(
    () => resolvePlan(container(), { removeOrdinals: [1], audioCount: 4 }),
    /3 audio tracks, not the 4/,
  );
});

test("removing every audio track is refused", () => {
  assert.throws(
    () =>
      resolvePlan(container(), { removeOrdinals: [0, 1, 2], audioCount: 3 }),
    /no audio at all/,
  );
});

test("an empty selection is refused", () => {
  assert.throws(
    () => resolvePlan(container(), { removeOrdinals: [], audioCount: 3 }),
    /No audio tracks were selected/,
  );
});

test("a position that is not an audio track is refused", () => {
  assert.throws(
    () => resolvePlan(container(), { removeOrdinals: [3], audioCount: 3 }),
    /No audio track 3/,
  );
  assert.throws(
    () => resolvePlan(container(), { removeOrdinals: [-1], audioCount: 3 }),
    /No audio track -1/,
  );
});

test("MediaInfo and mkvmerge disagreeing about track numbers is refused", () => {
  // The count still matches, so only the second opinion catches this: the
  // tracks have been reordered under a page that is still showing the old
  // order, and ordinal 1 no longer means the track the tick meant.
  assert.throws(
    () =>
      resolvePlan(container(), {
        removeOrdinals: [1],
        audioCount: 3,
        // The page had the French track as Matroska number 9, not 3.
        numbers: [2, 9, 4],
      }),
    /not in the order this page was showing/,
  );
});

test("a track number that moved is ignored unless that track is being removed", () => {
  // Refusing here would block a removal that is still perfectly well specified
  // — the tick is on ordinal 0, and ordinal 0 is exactly where the page left
  // it. Only the tracks actually going are checked.
  const plan = resolvePlan(container(), {
    removeOrdinals: [0],
    audioCount: 3,
    numbers: [2, 9, 4],
  });

  assert.deepEqual(plan.keepIds, [2, 3]);
});

test("a page that knows no track numbers is still allowed to remove tracks", () => {
  // Rows derived before `number` existed carry undefined, and the count check
  // plus mkvmerge's own reading is enough to proceed on.
  const plan = resolvePlan(container(), {
    removeOrdinals: [1],
    audioCount: 3,
    numbers: [undefined, undefined, undefined],
  });

  assert.deepEqual(plan.keepIds, [1, 3]);
});

// ---------------------------------------------------------------------------
// What it is worth
// ---------------------------------------------------------------------------

const track = (over: Partial<AudioTrack> = {}): AudioTrack => ({
  label: "DTS-HD MA",
  format: "DTS",
  channels: 6,
  lossless: true,
  atmos: false,
  dtsx: false,
  ...over,
});

test("the saving is the sum of the chosen tracks", () => {
  const tracks = [
    track({ sizeBytes: 1e9 }),
    track({ sizeBytes: 2e9 }),
    track({ sizeBytes: 4e9 }),
  ];

  const saving = savingsOf(tracks, [0, 2]);
  assert.equal(saving.bytes, 5e9);
  assert.equal(saving.estimated, false);
  assert.equal(saving.incomplete, false);
});

test("a track whose size was worked out from the bitrate makes the total an estimate", () => {
  const saving = savingsOf(
    [track({ sizeBytes: 1e9 }), track({ sizeBytes: 2e9, sizeEstimated: true })],
    [0, 1],
  );

  assert.equal(saving.bytes, 3e9);
  assert.equal(saving.estimated, true);
  assert.equal(saving.incomplete, false);
});

test("a track of unknown size makes the total a floor rather than a number", () => {
  // The distinction the page words as "frees at least". Adding a silent zero
  // here would promise a figure the file cannot be held to.
  const saving = savingsOf([track({ sizeBytes: 1e9 }), track()], [0, 1]);

  assert.equal(saving.bytes, 1e9);
  assert.equal(saving.incomplete, true);
});

test("only the chosen tracks count towards the saving", () => {
  const saving = savingsOf(
    [track({ sizeBytes: 1e9 }), track({ sizeBytes: 2e9 })],
    [1],
  );
  assert.equal(saving.bytes, 2e9);
});

// ---------------------------------------------------------------------------
// Reading the labels on a track
// ---------------------------------------------------------------------------

test("every spelling of English is English", () => {
  for (const code of ["en", "eng", "en-GB", "en_US", "EN"]) {
    assert.equal(isEnglish(code), true, code);
  }
});

test("an untagged track is not treated as a foreign one", () => {
  // "Keep English only" must not tick a track that never said what it was:
  // on an English-language release it is usually the English one.
  assert.equal(isEnglish(undefined), false);
  assert.equal(isEnglish("und"), false);
  // Nor may a language that merely starts with those letters be swept in.
  assert.equal(isEnglish("enm"), false);
});

test("only Matroska files can have tracks removed", () => {
  assert.equal(canStripAudio("/m/Film/Film.mkv"), true);
  assert.equal(canStripAudio("/m/Film/Film.MKV"), true);
  assert.equal(canStripAudio("/m/Film/Film.mp4"), false);
  assert.equal(canStripAudio("/m/Film/Film.m2ts"), false);
});


// ---------------------------------------------------------------------------
// Ticking a run of boxes
// ---------------------------------------------------------------------------

const ticked = (...ordinals: number[]) => new Set(ordinals);
const listed = (set: Set<number>) => [...set].sort((a, b) => a - b);

/** A nine-track rip, which is what a disc of a big film routinely is. */
const NINE = 9;

test("a plain click ticks one box and leaves the rest alone", () => {
  assert.deepEqual(listed(tickRange(ticked(0), 2, 0, false, NINE)), [0, 2]);
  assert.deepEqual(listed(tickRange(ticked(0, 2), 2, 0, false, NINE)), [0]);
});

test("shift-click ticks the whole run between the anchor and the click", () => {
  assert.deepEqual(
    listed(tickRange(ticked(2), 6, 2, true, NINE)),
    [2, 3, 4, 5, 6],
  );
});

test("the run is the same whichever direction it is dragged", () => {
  assert.deepEqual(
    listed(tickRange(ticked(6), 2, 6, true, NINE)),
    [2, 3, 4, 5, 6],
  );
});

test("shift-clicking a ticked box unticks the whole run", () => {
  // The half that makes it a checkbox: what the clicked box does, the run does.
  assert.deepEqual(listed(tickRange(ticked(2, 3, 4, 5, 6), 4, 6, true, NINE)), [
    2, 3,
  ]);
});

test("a shift-click with nothing to measure from is simply a click", () => {
  assert.deepEqual(listed(tickRange(ticked(), 3, null, true, NINE)), [3]);
});

test("shift-clicking the anchor itself toggles only the anchor", () => {
  assert.deepEqual(listed(tickRange(ticked(4), 4, 4, true, NINE)), []);
  assert.deepEqual(listed(tickRange(ticked(), 4, 4, true, NINE)), [4]);
});

test("a run laid over one already ticked leaves the others where they were", () => {
  assert.deepEqual(
    listed(tickRange(ticked(0, 4), 5, 1, true, NINE)),
    [0, 1, 2, 3, 4, 5],
  );
});

test("the selection handed in is never modified", () => {
  const before = ticked(1, 2);
  tickRange(before, 5, 1, true, NINE);
  assert.deepEqual(listed(before), [1, 2]);
});

// ---------------------------------------------------------------------------
// And the one thing it will not do
// ---------------------------------------------------------------------------

test("a run across every track stops one short of silencing the film", () => {
  // Eight of the nine, and the first is what survives it.
  assert.deepEqual(
    listed(tickRange(ticked(), 8, 0, true, NINE)),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
});

test("the ceiling holds however the run reaches it", () => {
  // Dragged the other way, off an existing selection, and on a two-track file
  // where "every track" is only two of them.
  assert.deepEqual(listed(tickRange(ticked(4), 0, 8, true, NINE)).length, 8);
  assert.deepEqual(listed(tickRange(ticked(1, 2, 3), 8, 0, true, NINE)), [
    1, 2, 3, 4, 5, 6, 7, 8,
  ]);
  assert.deepEqual(listed(tickRange(ticked(1), 0, 1, true, 2)), [1]);
});

test("a single track file can never have that track ticked", () => {
  assert.deepEqual(listed(tickRange(ticked(), 0, null, false, 1)), []);
});

test("unticking is never capped — it only ever leaves more behind", () => {
  assert.deepEqual(listed(tickRange(ticked(1, 2, 3), 2, 3, true, NINE)), [1]);
});

// ---------------------------------------------------------------------------
// Which languages are worth keeping
// ---------------------------------------------------------------------------

test("a language is one language however the muxer spelled it", () => {
  // MediaInfo's two letters, mkvmerge's three, and the bibliographic code a
  // disc rip is as likely to carry as either.
  for (const spelling of ["fr", "fra", "fre", "FR", "fr-FR", "fr_CA"]) {
    assert.equal(languageKey(spelling), "fr", spelling);
  }
  assert.equal(languageKey("ger"), "de");
  assert.equal(languageKey("cze"), "cs");
  assert.equal(languageKey("pt-BR"), "pt");
});

test("a code the platform cannot place still names itself consistently", () => {
  assert.equal(languageKey("qaa"), "qaa");
  assert.equal(languageKey("  ZXX  "), "zxx");
});

test("English is still English in every spelling, and Middle English is not", () => {
  assert.equal(isEnglish("en"), true);
  assert.equal(isEnglish("eng"), true);
  assert.equal(isEnglish("en-GB"), true);
  assert.equal(isEnglish("enm"), false);
  assert.equal(isEnglish(undefined), false);
});

const prefers = (
  languages: string[],
  original = false,
): { languages: string[]; original: boolean } => ({ languages, original });

test("a track in a language you asked for is kept", () => {
  assert.equal(isPreferred("eng", prefers(["en"])), true);
  assert.equal(isPreferred("ger", prefers(["en"])), false);
  // Spelled either way on either side of the comparison.
  assert.equal(isPreferred("de", prefers(["ger"])), true);
});

test("an untagged track is never treated as unwanted", () => {
  // Silence is not evidence: on an English release the untagged track is
  // usually the English one, and removing it is how a film loses its dialogue.
  assert.equal(isPreferred(undefined, prefers(["en"])), true);
  assert.equal(isPreferred(undefined, prefers([], true), "ja"), true);
});

test("the original language is kept when it has been asked for", () => {
  assert.equal(isPreferred("ja", prefers(["en"], true), "ja"), true);
  // And is nothing special when it has not.
  assert.equal(isPreferred("ja", prefers(["en"], false), "ja"), false);
  // A film nobody matched has no original language to keep.
  assert.equal(isPreferred("ja", prefers(["en"], true), undefined), false);
});

/** A rip of a Japanese film: the performance, a dub, and two more. */
const rip = (): AudioTrack[] =>
  [
    { language: "jpn", label: "TrueHD" },
    { language: "eng", label: "DTS-HD" },
    { language: "ger", label: "AC-3" },
    { language: "fre", label: "AC-3" },
  ].map((t) => ({
    ...t,
    format: "x",
    channels: 6,
    lossless: false,
    atmos: false,
    dtsx: false,
  }));

test("what a rip could shed is everything you did not ask to keep", () => {
  assert.deepEqual(removableTracks(rip(), prefers(["en"])), [0, 2, 3]);
  // The same rip with the original kept keeps the performance too.
  assert.deepEqual(removableTracks(rip(), prefers(["en"], true), "ja"), [2, 3]);
});

test("nothing is proposed when the proposal would silence the film", () => {
  // Every track is foreign to the preference, so there is no shortened list
  // that still means "keep what you asked for" — the file is left alone.
  assert.deepEqual(removableTracks(rip(), prefers(["es"])), []);
  assert.deepEqual(removableTracks(rip(), prefers([], true), "es"), []);
});

test("a promise about the original language cannot be kept for an unmatched film", () => {
  assert.equal(originalUnknown(prefers(["en"], true), undefined), true);
  assert.equal(originalUnknown(prefers(["en"], true), "ja"), false);
  assert.equal(originalUnknown(prefers(["en"], false), undefined), false);
});
