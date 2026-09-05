"use client";

import { useState } from "react";

import type { AudioPreference, SubtitlePreference } from "@/lib/audio-plan";
import type { LibraryLanguage } from "@/lib/audio-prefs";
import type { SubtitleLanguage } from "@/lib/subtitle-prefs";
import { AudioLanguages } from "./audio-languages";
import { SubtitleLanguages } from "./subtitle-languages";
import { SettingDialog } from "./dialog";
import { PRIMARY, Value } from "./parts";

/**
 * The languages you keep, as a row that opens onto the choosing.
 *
 * Both of these are a chip per language the library actually carries, and a
 * library spread across a few markets carries a dozen — a grid that grew a row
 * every time a disc arrived, sitting open in a settings row beside a toggle.
 * The row says how many are kept, which is what you check; the grid is what
 * you go and change.
 *
 * The same shape the folders and the glass bench already have, so the page has
 * one answer to "this needs more room than a row" rather than one per setting.
 */
function Picker({
  kept,
  title,
  lede,
  children,
}: {
  /** The languages in force, named — what the row shows without opening. */
  kept: string[];
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* The count, not the list. Naming them was the row growing with the
          library — and the answer to "how many languages am I keeping" is a
          number, with the names one press away. */}
      <Value>
        {kept.length
          ? `${kept.length} language${kept.length === 1 ? "" : "s"}`
          : "None preferred"}
      </Value>

      <button type="button" onClick={() => setOpen(true)} className={PRIMARY}>
        Choose
      </button>

      <SettingDialog
        open={open}
        onClose={() => setOpen(false)}
        size="wide"
        title={title}
        lede={lede}
      >
        {children}
      </SettingDialog>
    </>
  );
}

export function AudioLanguagePicker({
  preference,
  available,
  kept,
}: {
  preference: AudioPreference;
  available: LibraryLanguage[];
  kept: string[];
}) {
  return (
    <Picker
      kept={kept}
      title="Audio languages"
      lede="Which languages are worth the space they take. On a remux the audio is routinely half the file."
    >
      <AudioLanguages preference={preference} available={available} />
    </Picker>
  );
}

export function SubtitleLanguagePicker({
  preference,
  available,
  kept,
}: {
  preference: SubtitlePreference;
  available: SubtitleLanguage[];
  kept: string[];
}) {
  return (
    <Picker
      kept={kept}
      title="Subtitle languages"
      lede="Which text tracks are worth keeping in the menu. A disc carries a set for every market it was pressed for."
    >
      <SubtitleLanguages preference={preference} available={available} />
    </Picker>
  );
}
