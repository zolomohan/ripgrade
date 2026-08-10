"use client";

import { useState, useTransition } from "react";

import { setAudioLanguages } from "../actions";
import type { AudioPreference } from "@/lib/audio-plan";
import type { LibraryLanguage } from "@/lib/audio-prefs";
import { Note, Row, Toggle } from "./parts";

/**
 * Which audio languages are worth the space they take.
 *
 * A disc rip carries every language it was pressed with, and on a remux the
 * audio is routinely half the file. Which of them you would ever play is the
 * one thing the app cannot work out for itself — so it asks once, here, and the
 * audio queue is computed from the answer.
 *
 * The choice is made against the languages the library actually holds rather
 * than a list of every language there is: a shelf carries a dozen, and picking
 * from a dozen is a decision where picking from seven thousand is a chore.
 *
 * Nothing is removed by changing this. The queue is a proposal recomputed on
 * every read, so a language ticked here takes its tracks off the list and a
 * language unticked brings them back — and every removal still happens one film
 * at a time, on that film's own page, with the original kept beside it.
 */
export function AudioLanguages({
  preference,
  available,
}: {
  preference: AudioPreference;
  available: LibraryLanguage[];
}) {
  // Held locally so a tick lands under the finger rather than after a round
  // trip; the server hears about it in the same breath.
  const [chosen, setChosen] = useState<AudioPreference>(preference);
  const [, startTransition] = useTransition();

  const commit = (next: AudioPreference) => {
    setChosen(next);
    startTransition(async () => {
      await setAudioLanguages(next);
    });
  };

  const toggle = (key: string) =>
    commit({
      ...chosen,
      languages: chosen.languages.includes(key)
        ? chosen.languages.filter((language) => language !== key)
        : [...chosen.languages, key],
    });

  return (
    <div className="flex flex-col gap-4">
      {available.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {available.map((language) => {
              const on = chosen.languages.includes(language.key);
              return (
                <button
                  key={language.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(language.key)}
                  title={
                    language.tracks > 0
                      ? `${language.tracks.toLocaleString("en-GB")} track${
                          language.tracks === 1 ? "" : "s"
                        } in the library`
                      : "No tracks in this language — it is the original language of a film you have"
                  }
                  // The library shelf's own filter chip, and for the same
                  // reason: a set of choices where several can be on at once,
                  // and the ones that are on should read at a glance.
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    on
                      ? "border-transparent bg-foreground text-background"
                      : "border-line hover:bg-surface-strong"
                  }`}
                >
                  {language.name}
                  {language.tracks > 0 && (
                    <span
                      className={`ml-1.5 tabular-nums ${
                        on ? "opacity-60" : "opacity-35"
                      }`}
                    >
                      {language.tracks}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <Note>
            {chosen.languages.length === 0 && !chosen.original
              ? "Nothing is preferred, so nothing is proposed for removal."
              : "Everything else is what the audio queue offers to remove. A track that names no language at all is always kept — on an English release that is usually the English one."}
          </Note>
        </div>
      ) : (
        <Note>
          Nothing scanned yet. The languages your discs carry appear here once a
          scan has read them.
        </Note>
      )}

      <Row
        title="The film's original language"
        hint="Japanese on a Japanese film, Danish on a Danish one — the track that is the performance rather than a dub of it. Taken per film from TMDb, so a film nothing has matched is left out of the queue entirely rather than guessed at."
      >
        <Toggle
          on={chosen.original}
          label="Keep the film's original language"
          onChange={() => commit({ ...chosen, original: !chosen.original })}
        />
      </Row>
    </div>
  );
}
