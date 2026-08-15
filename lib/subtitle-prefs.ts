import "server-only";

import { languageKey, ORIGINAL, type SubtitlePreference } from "./audio-plan";
import { getSetting, setSetting } from "./db";
import { languageName } from "./derive";
import { getLibrary } from "./library";

/**
 * Which subtitle languages you keep, stored once and read everywhere.
 *
 * Deliberately its own setting rather than the audio one reused. The two
 * answers are different in most houses and the difference is not a detail:
 * plenty of people keep one audio language and three subtitle languages, and
 * anyone who watches foreign films in the original keeps *fewer* audio tracks
 * than subtitle ones. Folding them together would make the safe answer to one
 * question the wrong answer to the other.
 *
 * Kept beside `audio-prefs.ts` and shaped the same, so the two settings panels
 * are the same panel twice.
 */

const LANGUAGES_KEY = "subtitleLanguages";
const FORCED_KEY = "subtitleForced";
const SDH_KEY = "subtitleSdh";

/**
 * English, the film's own language, every forced track, and SDH kept.
 *
 * The last one is the conservative half: keeping SDH costs a line in a menu,
 * and dropping it by default would quietly remove the only usable track for
 * someone who needs it on a library nobody has configured.
 */
const DEFAULT: SubtitlePreference = {
  languages: ["en"],
  original: true,
  forced: true,
  sdh: true,
};

/** Stored as "1"/"0", and absent means the default rather than false. */
const flag = (key: string, fallback: boolean): boolean => {
  const stored = getSetting(key);
  return stored === undefined ? fallback : stored === "1";
};

export function getSubtitlePreference(): SubtitlePreference {
  const stored = getSetting(LANGUAGES_KEY);

  // The same encoding the audio list uses — one comma-separated list with the
  // "original" literal sitting among the languages, because that is how it is
  // chosen. An empty string is a deliberate empty list, not an unanswered one.
  const languages =
    stored === undefined
      ? DEFAULT.languages
      : stored
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);

  return {
    languages: languages
      .filter((part) => part !== ORIGINAL)
      .map(languageKey),
    original:
      stored === undefined ? DEFAULT.original : languages.includes(ORIGINAL),
    forced: flag(FORCED_KEY, DEFAULT.forced),
    sdh: flag(SDH_KEY, DEFAULT.sdh),
  };
}

export function setSubtitlePreference(preference: SubtitlePreference): void {
  const parts = [
    ...new Set(preference.languages.map(languageKey)),
    ...(preference.original ? [ORIGINAL] : []),
  ];
  setSetting(LANGUAGES_KEY, parts.join(","));
  setSetting(FORCED_KEY, preference.forced ? "1" : "0");
  setSetting(SDH_KEY, preference.sdh ? "1" : "0");
}

/** One subtitle language the library holds, and how much of it there is. */
export type SubtitleLanguage = {
  key: string;
  name: string;
  /** How many text tracks across the library are in it. */
  tracks: number;
  /** True where it is the language a film in the library was made in. */
  original: boolean;
  /** How many of those tracks are forced, which the panel says out loud. */
  forced: number;
  sdh: number;
};

/**
 * The subtitle languages to choose between, taken from the library itself.
 *
 * The audio panel's counterpart asks the same question of the audio tracks and
 * for the same reason — a list of the eleven languages your discs carry is a
 * better question than a dropdown of every language there is. Counted
 * separately because the two lists genuinely differ: a disc pressed for one
 * market often carries one audio language and nine subtitle ones.
 */
export function librarySubtitleLanguages(): SubtitleLanguage[] {
  const found = new Map<string, SubtitleLanguage>();

  const record = (
    code: string,
    delta: { tracks?: number; forced?: number; sdh?: number; original?: boolean },
  ) => {
    const key = languageKey(code);
    if (!key || key === "und" || key === "zxx") return;

    const seen = found.get(key) ?? {
      key,
      name: languageName(key),
      tracks: 0,
      original: false,
      forced: 0,
      sdh: 0,
    };

    seen.tracks += delta.tracks ?? 0;
    seen.forced += delta.forced ?? 0;
    seen.sdh += delta.sdh ?? 0;
    seen.original ||= delta.original ?? false;
    found.set(key, seen);
  };

  for (const item of getLibrary()) {
    for (const track of item.subtitles ?? []) {
      if (!track.language) continue;
      record(track.language, {
        tracks: 1,
        forced: track.forced ? 1 : 0,
        sdh: track.sdh ? 1 : 0,
      });
    }
    if (item.tmdb?.originalLanguage) {
      record(item.tmdb.originalLanguage, { original: true });
    }
  }

  return [...found.values()].sort(
    (a, b) => b.tracks - a.tracks || a.name.localeCompare(b.name, "en-GB"),
  );
}
