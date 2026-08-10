"use client";

import { useState } from "react";

import { FIELD } from "@/app/controls";
import { Field, PRIMARY, QUIET } from "@/app/settings/parts";
import { Spinner } from "@/app/spinner";
import {
  audioChoices,
  ENTRY_HDR,
  ENTRY_RESOLUTIONS,
  type DiscEntry,
  type EntryHdr,
  type EntryResolution,
  type EntrySource,
} from "@/lib/disc-entry";

/**
 * The specs of a disc, typed in.
 *
 * The way out of the dead end the other two paths leave you in: the search
 * found nothing and there is no page to paste, so nothing is standing over the
 * film and its score means something different from every other score in the
 * library. What you own — or what you know exists — goes in here instead.
 *
 * Only the fields that move a score are asked for, and only two of those are
 * required, because the two that decide most of it are resolution and dynamic
 * range. Everything else sharpens the comparison if you know it and is left out
 * if you do not: a blank bitrate simply means the app never says your copy is
 * short of one.
 */
export function DiscByHand({
  initial,
  defaultTitle,
  pending,
  onSave,
  onCancel,
}: {
  /** What is already recorded, so editing is not retyping. */
  initial?: DiscEntry;
  /** The film or season's own name, which is the honest default. */
  defaultTitle: string;
  pending: boolean;
  onSave: (entry: DiscEntry) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? defaultTitle);
  const [source, setSource] = useState<EntrySource>(initial?.source ?? "disc");
  const [resolution, setResolution] = useState<EntryResolution>(
    initial?.resolution ?? "2160p",
  );
  const [hdr, setHdr] = useState<EntryHdr>(initial?.hdr ?? "SDR");
  const [codec, setCodec] = useState(initial?.videoCodec ?? "");
  const [bitrate, setBitrate] = useState(
    initial?.videoBitrateMbps ? String(initial.videoBitrateMbps) : "",
  );
  const [aspect, setAspect] = useState(initial?.aspectRatio ?? "");
  const [audio, setAudio] = useState<string[]>(initial?.audio ?? []);

  // The catalogue, plus anything this release already carries that is not in
  // it. Fixed at open: a track you deselect stays on offer until you close.
  const [choices] = useState(() => audioChoices(initial?.audio ?? []));

  const toggleTrack = (track: string) =>
    setAudio((chosen) =>
      chosen.includes(track)
        ? chosen.filter((t) => t !== track)
        : // Kept in the catalogue's order rather than the order you clicked,
          // so the list reads best-first the way the panel prints it.
          choices.filter((t) => t === track || chosen.includes(t)),
    );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const mbps = Number(bitrate);

    onSave({
      title: title.trim() || defaultTitle,
      source,
      resolution,
      hdr,
      videoCodec: codec.trim() || undefined,
      videoBitrateMbps:
        bitrate.trim() && Number.isFinite(mbps) && mbps > 0 ? mbps : undefined,
      aspectRatio: aspect.trim() || undefined,
      audio,
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Field
        label="What you are comparing against"
        hint="A release name, or just the title — it is what the panel will say."
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={`${FIELD.default} w-full`}
        />
      </Field>

      <Field
        label="Best release is"
        hint={
          source === "web"
            ? "Nothing is scored short of a disc that was never pressed: a WEB-DL of this is the top of the scale."
            : "A disc exists, so an untouched remux of it is the top of the scale."
        }
      >
        <Choice
          options={["disc", "web"] as const}
          value={source}
          onChange={setSource}
          render={(option) => (option === "disc" ? "A disc" : "WEB-DL only")}
        />
      </Field>

      <Field label="Resolution">
        <Choice
          options={ENTRY_RESOLUTIONS}
          value={resolution}
          onChange={setResolution}
        />
      </Field>

      <Field
        label="Dynamic range"
        hint="The top format the disc carries; the HDR10 base layer is assumed."
      >
        <Choice options={ENTRY_HDR} value={hdr} onChange={setHdr} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Video codec">
          <input
            value={codec}
            onChange={(event) => setCodec(event.target.value)}
            spellCheck={false}
            placeholder="HEVC"
            className={`${FIELD.default} w-full`}
          />
        </Field>

        <Field label="Bitrate (Mbps)">
          <input
            value={bitrate}
            onChange={(event) => setBitrate(event.target.value)}
            inputMode="decimal"
            placeholder="72"
            className={`${FIELD.default} w-full`}
          />
        </Field>

        <Field label="Aspect ratio">
          <input
            value={aspect}
            onChange={(event) => setAspect(event.target.value)}
            spellCheck={false}
            placeholder="2.39:1"
            className={`${FIELD.default} w-full`}
          />
        </Field>
      </div>

      <Field
        label="Audio tracks"
        hint={
          audio.length
            ? "The best of them is what your copy is measured against."
            : "Unknown, so nothing here is measured on sound."
        }
      >
        <Tracks
          choices={choices}
          chosen={audio}
          onToggle={toggleTrack}
          onUnknown={() => setAudio([])}
        />
      </Field>

      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending && <Spinner />}
          Save these specs
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className={QUIET}
        >
          Back to the search
        </button>
      </div>
    </form>
  );
}

/**
 * Which tracks the release carries — any number of them, or none.
 *
 * "Unknown" is first and is a real answer: a disc whose sound nobody has
 * stated should not hold a copy short on sound, and an empty list is exactly
 * what the scorer reads as "no claim made". So it is not a chip beside the
 * others but the state of having chosen none, which is why picking it clears
 * them and picking any of them clears it.
 */
function Tracks({
  choices,
  chosen,
  onToggle,
  onUnknown,
}: {
  choices: string[];
  chosen: string[];
  onToggle: (track: string) => void;
  onUnknown: () => void;
}) {
  const chip = "rounded-full px-3 py-1 text-xs transition-colors";
  const on = "bg-foreground text-background";
  const off = "ring-1 ring-line-strong ring-inset hover:bg-surface-strong";

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        aria-pressed={chosen.length === 0}
        onClick={onUnknown}
        className={`${chip} ${chosen.length === 0 ? on : `${off} italic`}`}
      >
        Unknown
      </button>

      {/* A hairline rather than a gap: the first chip answers a different
          question from the rest, and a space alone does not say so. */}
      <span aria-hidden className="mx-1 w-px self-stretch bg-line" />

      {choices.map((track) => (
        <button
          key={track}
          type="button"
          aria-pressed={chosen.includes(track)}
          onClick={() => onToggle(track)}
          className={`${chip} ${chosen.includes(track) ? on : off}`}
        >
          {track}
        </button>
      ))}
    </div>
  );
}

/**
 * A short closed list, as the chips it will be displayed as.
 *
 * A `<select>` would hide three options behind a click to save a line of space,
 * and these are the two fields that decide most of the score — worth seeing all
 * of at once.
 */
function Choice<T extends string>({
  options,
  value,
  onChange,
  render,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  /** Where the stored value is not what to call it — "web" is "WEB-DL only". */
  render?: (option: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={`rounded-full px-3 py-1 text-xs transition-colors ${
            option === value
              ? "bg-foreground text-background"
              : "ring-1 ring-line-strong ring-inset hover:bg-surface-strong"
          }`}
        >
          {render ? render(option) : option}
        </button>
      ))}
    </div>
  );
}
