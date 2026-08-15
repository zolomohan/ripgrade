"use client";

import { useState, useTransition } from "react";

import { setSubtitleLanguages } from "../actions";
import type { SubtitlePreference } from "@/lib/audio-plan";
import type { SubtitleLanguage } from "@/lib/subtitle-prefs";
import { Note, Row, Toggle } from "./parts";

/**
 * Which subtitle tracks are worth keeping in the menu.
 *
 * The audio panel's counterpart, and deliberately a second question rather than
 * the same answer reused. Most houses keep fewer audio languages than subtitle
 * ones — anybody who watches a foreign film in its own language keeps one audio
 * track and two sets of subtitles — and folding the two together would make the
 * safe answer to one the wrong answer to the other.
 *
 * The saving is smaller than audio's and that is not really the point. A PGS
 * track is tens of megabytes where a TrueHD track is gigabytes; what nine
 * unwanted text tracks actually cost you is a subtitle menu you have to read
 * every time you press the button.
 *
 * Nothing is removed by changing this. The queue is a proposal recomputed on
 * every read, and every removal still happens one film at a time with the
 * original kept beside it.
 */
export function SubtitleLanguages({
  preference,
  available,
}: {
  preference: SubtitlePreference;
  available: SubtitleLanguage[];
}) {
  // Held locally so a tick lands under the finger rather than after a round
  // trip; the server hears about it in the same breath.
  const [chosen, setChosen] = useState<SubtitlePreference>(preference);
  const [, startTransition] = useTransition();

  const commit = (next: SubtitlePreference) => {
    setChosen(next);
    startTransition(async () => {
      await setSubtitleLanguages(next);
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
                      ? [
                          `${language.tracks.toLocaleString("en-GB")} track${
                            language.tracks === 1 ? "" : "s"
                          } in the library`,
                          language.forced > 0 && `${language.forced} forced`,
                          language.sdh > 0 && `${language.sdh} SDH`,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : "No tracks in this language — it is the original language of a film you have"
                  }
                  // The audio panel's chip, because it is the same kind of
                  // choice: several can be on at once, and the ones that are
                  // should read at a glance.
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
            {chosen.languages.length === 0 &&
            !chosen.original &&
            !chosen.forced
              ? "Nothing is preferred, so every subtitle track in the library is offered for removal."
              : "Everything else is what the queue offers to remove. A track that names no language at all is always kept."}
          </Note>
        </div>
      ) : (
        <Note>
          Nothing scanned yet. The subtitle languages your discs carry appear
          here once a scan has read them.
        </Note>
      )}

      <Row
        title="The film's original language"
        hint="Japanese on a Japanese film, Danish on a Danish one. Taken per film from TMDb, so a film nothing has matched is left out of the proposal entirely rather than guessed at."
      >
        <Toggle
          on={chosen.original}
          label="Keep the film's original language"
          onChange={() => commit({ ...chosen, original: !chosen.original })}
        />
      </Row>

      <Row
        title="Forced subtitles"
        hint="Not a translation of the film — the signs, the readouts, and the twenty seconds of Elvish. On a film watched in its own language it is the one text track that gets used, and its language tag is often the film's rather than yours. Kept whatever language it names."
      >
        <Toggle
          on={chosen.forced}
          label="Keep forced tracks in any language"
          onChange={() => commit({ ...chosen, forced: !chosen.forced })}
        />
      </Row>

      <Row
        title="Hard-of-hearing subtitles"
        hint="SDH names the speaker and describes the sounds. It is in a language you keep by definition, so the list above can never remove it — this is the switch that can. Turn it off and every SDH track goes, including the English ones; leave it on and a house that needs them keeps them."
      >
        <Toggle
          on={chosen.sdh}
          label="Keep SDH tracks"
          onChange={() => commit({ ...chosen, sdh: !chosen.sdh })}
        />
      </Row>
    </div>
  );
}
