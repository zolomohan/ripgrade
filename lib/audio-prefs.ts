import "server-only";

import { languageKey, ORIGINAL, type AudioPreference } from "./audio-plan";
import { getSetting, setSetting } from "./db";
import { languageName } from "./derive";
import { getLibrary } from "./library";

/**
 * Which audio languages you keep, stored once and read everywhere.
 *
 * The app used to have this opinion hard-coded: keep English, drop anything
 * that names another language. That is one household's answer written into the
 * source, and it is wrong for most of them — a bilingual house wants two, an
 * anime shelf wants the Japanese track above the English one, and a film in
 * Danish has no English track to keep in the first place.
 *
 * So it is a setting, and it is the setting the audio queue is computed from
 * rather than a filter applied afterwards. What you keep decides what the queue
 * offers to remove; nothing else in the app decides it.
 */

const LANGUAGES_KEY = "audioLanguages";

/**
 * English, plus whatever the film was actually made in.
 *
 * The second half is what makes the default safe on a library nobody has
 * configured: without it, the first sweep over an anime shelf proposes removing
 * every Japanese track on it.
 */
const DEFAULT: AudioPreference = { languages: ["en"], original: true };

export function getAudioPreference(): AudioPreference {
  const stored = getSetting(LANGUAGES_KEY);
  if (stored === undefined) return DEFAULT;

  // Stored as one list with a literal in it, because that is how it is chosen:
  // "original" sits among the languages in the settings panel and is ticked the
  // same way. An empty string is a deliberate empty list — somebody who wants
  // nothing removed anywhere — and is not the same as never having chosen.
  const parts = stored
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    languages: parts.filter((part) => part !== ORIGINAL).map(languageKey),
    original: parts.includes(ORIGINAL),
  };
}

export function setAudioPreference(preference: AudioPreference): void {
  const parts = [
    ...new Set(preference.languages.map(languageKey)),
    ...(preference.original ? [ORIGINAL] : []),
  ];
  setSetting(LANGUAGES_KEY, parts.join(","));
}

/** One language the library actually holds, and how much of it there is. */
export type LibraryLanguage = {
  /** Canonical key — what the setting stores. */
  key: string;
  name: string;
  /** How many audio tracks across the library are in it. */
  tracks: number;
  /** True where it is the language a film in the library was made in. */
  original: boolean;
};

/**
 * The languages to choose between, taken from the library rather than a list of
 * every language there is.
 *
 * A dropdown of seven thousand ISO codes is a worse question than "which of the
 * eleven your discs actually carry". Sorted by how much of each there is, so the
 * ones worth an opinion are at the top — and a language that is only ever some
 * film's original still appears, because that is exactly the one somebody with
 * a foreign-language shelf came here to tick.
 */
export function libraryLanguages(): LibraryLanguage[] {
  const found = new Map<string, LibraryLanguage>();

  const record = (code: string, tracks: number, original: boolean) => {
    const key = languageKey(code);
    if (!key || key === "und" || key === "zxx") return;
    const seen = found.get(key);
    if (seen) {
      seen.tracks += tracks;
      seen.original ||= original;
    } else {
      found.set(key, { key, name: languageName(key), tracks, original });
    }
  };

  for (const item of getLibrary()) {
    for (const track of item.audio) {
      if (track.language) record(track.language, 1, false);
    }
    if (item.tmdb?.originalLanguage) {
      record(item.tmdb.originalLanguage, 0, true);
    }
  }

  return [...found.values()].sort(
    (a, b) => b.tracks - a.tracks || a.name.localeCompare(b.name, "en-GB"),
  );
}
