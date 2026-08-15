"use client";

import { useMemo, useRef, useState } from "react";

import { beginStripAudio } from "@/app/actions";
import { BUTTON } from "@/app/controls";
import { useJobs } from "@/app/jobs-provider";
import { CloseButton, Modal } from "@/app/modal";
import { Spinner } from "@/app/spinner";
import { stagger } from "@/app/stagger";
import { Tick } from "@/app/tick";
import { keptFirst, savingsOf, tickRange } from "@/lib/audio-plan";
import { languageName } from "@/lib/derive";
import type { AudioTrack, SubtitleTrack } from "@/lib/derive";
import type { AudioTask } from "@/lib/queue-tasks";
import { size } from "@/app/format";

/**
 * Which tracks actually go, asked where the row is.
 *
 * The list already knows the answer it would give: the queue proposes every
 * track in a language you do not keep, and the figure on the row is what
 * removing exactly those would free. What it could not do was let you disagree
 * — a row was a signpost to the film's own console, where the same tracks are
 * listed with the same boxes beside them, and the walk was the whole of what
 * the second page added.
 *
 * So the boxes come to the row. The dialog opens with the proposal ticked,
 * which makes the common case one click on a button labelled Next; and it is a
 * table rather than a sentence, because the case that brought you here is the
 * one where the proposal is nearly right — the commentary you want gone, the
 * duplicate English track, the one Hungarian DTS-HD track that is actually the
 * film's own language.
 *
 * It asks in three screens rather than one. Audio and subtitles are different
 * questions asked of different tables — one is about gigabytes, the other about
 * a menu you read every time you press play — and stacked in a single scroll
 * the second was something you met on the way past the buttons. Splitting them
 * costs a click and buys a decision made twice on purpose. The third screen is
 * the one that was missing: what you have actually asked for, said back before
 * a 90 GB file is rewritten.
 *
 * The film's page keeps its console, and keeps everything this cannot say: what
 * the file has been through, the way back once the tracks are gone, and the
 * backup sitting beside it. Nothing here points at it, though. A dialog with
 * three buttons makes you read three before pressing one, and the two that
 * matter are the answer and the way out — the film is a row away in the list
 * behind this, which is where somebody who wants the page will look anyway.
 */

/**
 * The two-tier form the rest of the app writes a film's size in, with the two
 * tiers under it that a *track* needs.
 *
 * A film is always gigabytes and this stopped there. A subtitle track is tens
 * of megabytes, so every one of them drew as "0.0 GB" — which does not read as
 * a rounded figure, it reads as a track that costs nothing at all, and it made
 * the subtitle half of a removal look pointless. The same point `format.ts`
 * makes about the thumbnail cache, arriving on a list of tracks: rounding 40 MB
 * to nothing is not a coarser answer, it is a wrong one.
 */

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** One track named in a line, for the checkbox a screen reader reads out. */
const audioName = (track: AudioTrack) =>
  `${track.label}${track.language ? ` (${languageName(track.language)})` : ""}`;

const textName = (track: SubtitleTrack) =>
  [
    track.language ? languageName(track.language) : "untagged",
    track.forced ? "forced" : null,
    track.sdh ? "SDH" : null,
    track.format,
  ]
    .filter(Boolean)
    .join(" ");

/**
 * One track as the review lists it: what it is, and everything else about it.
 *
 * Two lines rather than one string. The single line these were built from read
 * "TrueHD Atmos (Hungarian)" and "German forced PGS" in the same column, which
 * put the codec, the language and the flags in a different order on every row
 * and left nothing to scan down.
 *
 * The language leads because it is the axis the decision is actually made on —
 * you are deciding about Hungarian, not about DTS-HD — and it means the two
 * lists read alike whichever kind of track a row happens to be.
 */
type Row = { key: string; title: string; meta: string; bytes?: number };

const join = (parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(" · ");

const audioRow = (track: AudioTrack, ordinal: number): Row => ({
  key: `a${ordinal}`,
  title: track.language ? languageName(track.language) : "Untagged",
  meta: join([
    track.label,
    track.channels ? `${track.channels}ch` : undefined,
    track.title,
    track.forced && "forced",
    track.default && "default",
  ]),
  bytes: track.sizeBytes,
});

const textRow = (track: SubtitleTrack, ordinal: number): Row => ({
  key: `s${ordinal}`,
  title: track.language ? languageName(track.language) : "Untagged",
  meta: join([
    track.format,
    track.title,
    track.forced && "forced",
    track.sdh && "SDH",
    track.default && "default",
  ]),
  bytes: track.sizeBytes,
});

type Step = "audio" | "subtitles" | "review";

const HEADING: Record<Step, string> = {
  audio: "Audio",
  subtitles: "Subtitles",
  review: "Review",
};

export function TrackPicker({
  task,
  open,
  onClose,
  /** Why nothing can be started right now — another rewrite is under way. */
  blocked,
}: {
  task: AudioTask;
  open: boolean;
  onClose: () => void;
  blocked?: string;
}) {
  const { apply } = useJobs();

  const { tracks, subtitles } = task;

  /**
   * The proposal, ticked, as the row promised it.
   *
   * Seeded once per dialog — the component is mounted by the row being opened
   * and unmounted when it closes, so there is no case where a new task arrives
   * under an old selection.
   */
  const [selected, setSelected] = useState<ReadonlySet<number>>(
    () => new Set(task.proposed),
  );
  const [selectedText, setSelectedText] = useState<ReadonlySet<number>>(
    () => new Set(task.proposedSubtitles),
  );
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Which screens this file has, and where in them you are.
   *
   * A film with no text tracks has no subtitle screen — an empty table under a
   * heading is a step that exists to be clicked past — so the run is built from
   * what the file actually holds rather than being three screens always.
   */
  const steps = useMemo<Step[]>(
    () => [
      "audio",
      ...(subtitles.length > 0 ? (["subtitles"] as const) : []),
      "review",
    ],
    [subtitles.length],
  );
  const [at, setAt] = useState(0);
  const step = steps[Math.min(at, steps.length - 1)];
  const last = at >= steps.length - 1;

  /**
   * The last row ticked by hand in each table, which is what a shift-click
   * measures from. One per table: a run started in the audio list has no
   * meaning in the subtitle one.
   */
  const anchor = useRef<number | null>(null);
  const anchorText = useRef<number | null>(null);

  /**
   * The order each table draws its rows in — what the preference keeps, first.
   *
   * Built from the proposal rather than from the ticks, so a row's place is
   * fixed for as long as the dialog is open. An order that answered to the
   * selection would move the next row out from under the cursor at the moment
   * it was clicked.
   */
  const order = useMemo(
    () =>
      keptFirst(tracks, (_track, ordinal) => !task.proposed.includes(ordinal)),
    [tracks, task.proposed],
  );
  const orderText = useMemo(
    () =>
      keptFirst(
        subtitles,
        (_track, ordinal) => !task.proposedSubtitles.includes(ordinal),
      ),
    [subtitles, task.proposedSubtitles],
  );

  // Both tables asked and the answers added, because one remux takes both.
  const audioSaving = savingsOf(tracks, selected);
  const textSaving = savingsOf(subtitles, selectedText);
  const freed = audioSaving.bytes + textSaving.bytes;
  const anyEstimated = audioSaving.estimated || textSaving.estimated;
  const anyUnsized = audioSaving.incomplete || textSaving.incomplete;
  const total = selected.size + selectedText.size;

  const removingAudio = order.filter((ordinal) => selected.has(ordinal));
  const removingText = orderText.filter((ordinal) => selectedText.has(ordinal));
  const keepingAudio = order.filter((ordinal) => !selected.has(ordinal));
  const keepingText = orderText.filter((ordinal) => !selectedText.has(ordinal));

  /**
   * The rows of a column, under the kind of track they are.
   *
   * Grouped rather than run together. Listed as one stack the two kinds were
   * indistinguishable — "English · PGS · SDH" and "English · TrueHD · 7.1ch"
   * are the same shape of row, and telling them apart meant reading the codec
   * on the second line and knowing which names were codecs. That is a quiz,
   * not a list.
   *
   * An empty kind draws no heading at all, so a film with no subtitles never
   * grows a label saying so, and a column that holds only one kind still says
   * which kind it is.
   *
   * Inside each group the order is the one its table drew, so a row sits where
   * you last saw it rather than where the file happens to keep it.
   */
  const groupsOf = (audio: number[], text: number[]) =>
    [
      {
        kind: "Audio",
        rows: audio.map((ordinal) => audioRow(tracks[ordinal], ordinal)),
      },
      {
        kind: "Subtitles",
        rows: text.map((ordinal) => textRow(subtitles[ordinal], ordinal)),
      },
    ]
      .filter((group) => group.rows.length > 0)
      .map((group) => ({
        ...group,
        // Each card's own total rather than a share of one figure at the top.
        // "Removing · Subtitles · 180 MB" is the answer to a question the headline
        // cannot be asked — whether the text tracks are worth the trouble.
        bytes: group.rows.reduce((sum, row) => sum + (row.bytes ?? 0), 0),
      }));

  const removingGroups = groupsOf(removingAudio, removingText);
  const keepingGroups = groupsOf(keepingAudio, keepingText);

  /**
   * A film has to keep one audio track. Enforced three times over on the film's
   * own console and for the same reason here: `tickRange` will not carry a run
   * across the last box, the last box itself refuses, and the server refuses
   * anyway in `resolvePlan`.
   */
  const lastStanding = (ordinal: number) =>
    !selected.has(ordinal) && selected.size >= tracks.length - 1;

  /** Set only when the drive is away, so it overrides every other tooltip. */
  const offline = task.offline
    ? "The drive this file lives on is not connected"
    : undefined;
  const refusal = offline ?? blocked;

  function tick(ordinal: number, range: boolean) {
    const from = anchor.current;
    anchor.current = ordinal;
    setSelected((current) => tickRange(current, ordinal, from, range, order));
  }

  function tickText(ordinal: number, range: boolean) {
    const from = anchorText.current;
    anchorText.current = ordinal;
    setSelectedText((current) =>
      // `false`: every subtitle track may go, so a run across the whole table
      // means the whole table rather than all-but-one.
      tickRange(current, ordinal, from, range, orderText, false),
    );
  }

  async function start() {
    setError(null);
    setStarting(true);

    const ordinals = [...selected].sort((a, b) => a - b);
    const textOrdinals = [...selectedText].sort((a, b) => a - b);

    const result = await beginStripAudio({
      path: task.path,
      removeOrdinals: ordinals,
      audioCount: tracks.length,
      // The Matroska numbers as this list has them, for the server to check
      // against what mkvmerge reports before it rewrites anything. Sent by
      // ordinal so the two lists line up on the far side — the order the table
      // drew them in never leaves this component.
      numbers: tracks.map((track) => track.number),
      ...(subtitles.length > 0 && {
        removeSubtitleOrdinals: textOrdinals,
        subtitleCount: subtitles.length,
        subtitleNumbers: subtitles.map((track) => track.number),
      }),
      freedBytes: freed || undefined,
    });
    setStarting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    apply({
      strip: {
        status: "running",
        path: task.path,
        percent: 0,
        removed: ordinals.length,
        kept: tracks.length - ordinals.length,
        removedSubtitles: textOrdinals.length,
        keptSubtitles: subtitles.length - textOrdinals.length,
        freedBytes: freed || undefined,
      },
    });
    onClose();
  }

  /*
   * A KEPT chip used to sit beside the language on every row the preference
   * keeps, which was most of the table: a badge that appears on the majority
   * of rows says nothing about any of them, and it was answering a question
   * the table already answers twice over — the tick box is empty and the row
   * is not struck through. What is kept is what you have not ticked. The rows
   * the preference keeps still come first, which is the ordering that fact was
   * worth.
   */

  /** What the line above the buttons reads, which is the step's own answer. */
  const reading =
    step === "audio" ? (
      selected.size === 0 ? (
        <span className="opacity-60">
          Tick the audio tracks you will never play.
        </span>
      ) : (
        <>
          <span className="font-medium">
            {audioSaving.incomplete
              ? "Frees at least"
              : audioSaving.estimated
                ? "Frees about"
                : "Frees"}{" "}
            {size(audioSaving.bytes)}
          </span>
          <span className="opacity-60">
            {" · "}
            {selected.size} of {tracks.length} audio tracks
          </span>
        </>
      )
    ) : step === "subtitles" ? (
      selectedText.size === 0 ? (
        <span className="opacity-60">
          Tick the subtitle tracks you will never turn on.
        </span>
      ) : (
        <>
          <span className="font-medium">
            {textSaving.incomplete
              ? "Frees at least"
              : textSaving.estimated
                ? "Frees about"
                : "Frees"}{" "}
            {size(textSaving.bytes)}
          </span>
          <span className="opacity-60">
            {" · "}
            {selectedText.size} of {subtitles.length} subtitle tracks
          </span>
        </>
      )
    ) : // Nothing on the review screen. The figure and the arithmetic under it
    // are the first thing on that screen, at four times this size — saying
    // them again a hand's width below, smaller, is the same sentence twice on
    // one page, and the smaller of the two is the one nobody needed.
    null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!starting}
      label={`Choose which tracks to remove from ${task.fileName}`}
      // Wider than the app's other dialogs, which ask a question in a sentence
      // or two. This one holds a five-column table whose cells are a codec, a
      // language, a muxer's name for a track and a size — at the width of a
      // confirmation every one of those wraps, and a table that wraps in four
      // places at once stops reading as rows.
      //
      // Capped in height and scrolled inside rather than out: a rip with
      // eighteen audio tracks is exactly the file worth opening this on, and a
      // dialog taller than the window puts its own buttons off the bottom of it.
      panelClassName="flex max-h-[85dvh] w-full max-w-4xl flex-col gap-3 glass-panel rounded-card border border-line p-6 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{task.title}</h2>
          <p className="mt-0.5 truncate font-mono text-xs opacity-55">
            {task.fileName}
          </p>
        </div>
        <CloseButton onClick={onClose} disabled={starting} />
      </div>

      {/* Where you are, and how much of this there is left.

          A line of small caps reading "Step 2 of 3" said both of those and was
          read as neither — set at the weight of a caption directly under a
          title, it was furniture. This is the same two facts given the size
          they deserve: every step named at once, so the shape of the thing is
          visible from the first screen, and the one you are on carrying the
          only filled badge on the row.

          The steps behind you are buttons. Back reaches the previous screen and
          nothing reaches the one before that, which on a three-step dialog is a
          door you can see and cannot open. Forward is not offered: the last
          screen is a review, and a review you can jump to before the choices it
          reviews is not one. */}
      <nav aria-label="Steps">
        <ol className="flex items-center gap-2">
          {steps.map((each, index) => {
            const done = index < at;
            const now = index === at;
            const label = (
              <>
                <span
                  aria-hidden
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors ${
                    now
                      ? "border-transparent bg-foreground text-background"
                      : done
                        ? "border-line-strong"
                        : "border-line opacity-40"
                  }`}
                >
                  {done ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3 w-3"
                    >
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={`text-sm ${
                    now ? "font-medium" : done ? "opacity-70" : "opacity-40"
                  }`}
                >
                  {HEADING[each]}
                </span>
              </>
            );

            return (
              <li key={each} className="flex items-center gap-2">
                {done ? (
                  <button
                    type="button"
                    onClick={() => setAt(index)}
                    disabled={starting}
                    title={`Back to ${HEADING[each].toLowerCase()}`}
                    className="flex items-center gap-2 rounded-control px-1 py-0.5 -mx-1 transition-colors hover:bg-surface-strong disabled:pointer-events-none"
                  >
                    {label}
                  </button>
                ) : (
                  <span
                    aria-current={now ? "step" : undefined}
                    className="flex items-center gap-2 px-1 py-0.5"
                  >
                    {label}
                  </span>
                )}

                {/* The hairline between two steps, carrying the same reading as
                    the badges: behind you it is drawn, ahead of you it is not
                    quite. */}
                {index < steps.length - 1 && (
                  <span
                    aria-hidden
                    className={`h-px w-6 sm:w-10 ${
                      done ? "bg-line-strong" : "bg-line"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div aria-hidden className="rule-head" />

      {/* The only part that scrolls. The reading and the buttons under it are
          the two things you came for, and both stay where they were put.

          It spans the panel's full inner width and pads its content back in,
          rather than sitting in the content column and being scrolled inside
          it. This app styles its scrollbars, which opts it out of the overlay
          kind macOS hides — the bar is ten real pixels wide and it is placed at
          the inline end of this box. Sitting in the content column that put it
          on top of the cards; spanning the panel, it rides the panel's own edge
          with the padding between it and anything you are reading.

          `scrollbar-gutter: stable` for the reason `html` carries it: the audio
          table fits on some files and the review never does, so without the
          gutter held the content would step sideways on the way between two
          screens of the same dialog. */}
      <div className="-mx-6 min-h-0 flex-1 overflow-y-auto pl-6 pr-4 [scrollbar-gutter:stable]">
        {step === "audio" && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide opacity-50">
              <tr>
                {/* Unlabelled, as on the film's own table: a header over a
                    column of checkboxes has to be a word like "Remove", and
                    that word then sits over every row as an instruction. */}
                <th className="w-8 px-4 py-2" />
                <th className="px-4 py-2 font-medium">Format</th>
                <th className="px-4 py-2 font-medium">Language</th>
                <th className="px-4 py-2 font-medium">Track</th>
                <th className="px-4 py-2 text-right font-medium">Size</th>
              </tr>
            </thead>
            <tbody>
              {order.map((ordinal) => {
                const track = tracks[ordinal];
                const ticked = selected.has(ordinal);

                return (
                  <tr
                    key={ordinal}
                    // Struck through rather than merely ticked: the row is
                    // about to stop existing, and the table should look like
                    // what the file will be.
                    className={ticked ? "opacity-45" : undefined}
                  >
                    <td className="p-0">
                      <Tick
                        checked={ticked}
                        disabled={
                          Boolean(refusal) || starting || lastStanding(ordinal)
                        }
                        refusal={
                          refusal ??
                          (lastStanding(ordinal)
                            ? "A film has to keep one audio track — untick another to remove this one instead"
                            : undefined)
                        }
                        onTick={(range) => tick(ordinal, range)}
                        label={`Remove ${audioName(track)}`}
                      />
                    </td>
                    <td className={`px-4 py-2 ${ticked ? "line-through" : ""}`}>
                      {track.label}
                    </td>
                    <td className="px-4 py-2 opacity-70">
                      {track.language ? languageName(track.language) : "—"}
                    </td>
                    <td className="px-4 py-2 opacity-70">
                      {[
                        track.title,
                        track.forced ? "forced" : null,
                        track.default ? "default" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums opacity-70">
                      {track.sizeBytes === undefined ? (
                        "—"
                      ) : (
                        <span
                          title={
                            track.sizeEstimated
                              ? "Bitrate × runtime — MediaInfo could not count this track"
                              : undefined
                          }
                        >
                          {track.sizeEstimated && "~"}
                          {size(track.sizeBytes)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {step === "subtitles" && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide opacity-50">
              <tr>
                <th className="w-8 px-4 py-2" />
                <th className="px-4 py-2 font-medium">Format</th>
                <th className="px-4 py-2 font-medium">Language</th>
                <th className="px-4 py-2 font-medium">Track</th>
                <th className="px-4 py-2 font-medium">Flags</th>
                <th className="px-4 py-2 text-right font-medium">Size</th>
              </tr>
            </thead>
            <tbody>
              {orderText.map((ordinal) => {
                const track = subtitles[ordinal];
                const ticked = selectedText.has(ordinal);

                return (
                  <tr
                    key={ordinal}
                    className={ticked ? "opacity-45" : undefined}
                  >
                    <td className="p-0">
                      <Tick
                        checked={ticked}
                        disabled={Boolean(refusal) || starting}
                        refusal={refusal}
                        onTick={(range) => tickText(ordinal, range)}
                        label={`Remove ${textName(track)}`}
                      />
                    </td>
                    <td className={`px-4 py-2 ${ticked ? "line-through" : ""}`}>
                      {track.format}
                    </td>
                    <td className="px-4 py-2 opacity-70">
                      {track.language ? languageName(track.language) : "—"}
                    </td>
                    <td className="px-4 py-2 opacity-70">
                      {track.title || "—"}
                    </td>
                    <td className="px-4 py-2 opacity-70">
                      {[
                        track.forced ? "forced" : null,
                        track.sdh ? "SDH" : null,
                        track.default ? "default" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums opacity-70">
                      {track.sizeBytes === undefined
                        ? "—"
                        : size(track.sizeBytes)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {step === "review" && (
          <div className="flex flex-col gap-6 py-2">
            {/* The figure first, at the size of the thing it is.

                Two screens of ticking answer "which tracks"; this answers "and
                so what", which is one number and the shape of the file it
                leaves.

                Bare on the panel rather than in a card of its own. Everything
                under it is bordered, and a headline inside a fourth box was
                one box among four — the thing the screen exists to say, given
                the same frame as the lists it summarises. Standing on the panel
                with nothing drawn around it, it is the only thing up there and
                does not have to compete to look like it. */}
            <div className="py-2">
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {total === 0
                  ? "Nothing selected"
                  : `${
                      anyUnsized
                        ? "Frees at least "
                        : anyEstimated
                          ? "Frees about "
                          : "Frees "
                    }${size(freed)}`}
              </p>
              <p className="mt-1 text-sm opacity-55 tabular-nums">
                {total === 0 ? (
                  "Go back and tick the tracks you will never play."
                ) : (
                  <>
                    {size(task.sizeBytes)}
                    <span aria-hidden className="mx-1.5 opacity-60">
                      →
                    </span>
                    {size(Math.max(0, task.sizeBytes - freed))}
                  </>
                )}
              </p>

              {/* The file as a strip, with what is being removed shown as the
                  slice of it that it is. A percentage is the honest scale here
                  and the number alone never gives it: 8 GB off a 61 GB remux
                  and 8 GB off a 12 GB one are the same sentence and nothing
                  like the same decision.

                  Green, which is what this app paints reclaimed space
                  everywhere else — and the same pair of shades the `gain`
                  figures use rather than one tone for both themes: emerald-500
                  is washed out on a light panel and a flat mid-tone is the one
                  thing a two-segment bar cannot afford, since the whole bar is
                  the comparison. It reads against the red in the lists below on
                  purpose, because the two are not describing the same thing:
                  those are the tracks you are giving up, and this is the space
                  you are getting back. */}
              {total > 0 && task.sizeBytes > 0 && (
                <div
                  aria-hidden
                  className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-line"
                >
                  <div
                    className="bg-foreground/60"
                    style={{
                      width: `${Math.max(0, 100 - (freed / task.sizeBytes) * 100)}%`,
                    }}
                  />
                  <div
                    className="bg-emerald-600 dark:bg-emerald-400"
                    style={{
                      width: `${Math.min(100, (freed / task.sizeBytes) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>

            {/* One card per kind, in two columns: what survives down the left,
                what goes down the right.

                "Removing" and "Keeping" rather than the "Going" and "Staying"
                these were first written as. Every other surface in the app
                already says both words — the button under this reads Remove,
                the tables ask which tracks to remove, and Settings asks which
                languages you keep — so a review screen that invented a third
                pair was the only place in the app using them.

                The two stay side by side because the reassurance is only
                reassuring next to the thing it answers — read one under the
                other, the second list is a list you scroll past. Removals sit
                on the right, under the button that performs them and last in
                reading order, so the screen ends on what is about to happen
                rather than opening on it.

                But audio and subtitles are their own cards rather than two
                groups sharing one, because they are two decisions and each
                carries its own figure: what the text tracks come to is a
                question the headline at the top cannot be asked.

                Removals carry the sizes and the colour; what is kept carries
                neither. What survives does not need a number against it, and
                colouring the safe half would make a screen of two warnings. */}
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  {
                    heading: "Keeping",
                    groups: keepingGroups,
                    tone: "",
                    empty: "Nothing at all, which cannot happen.",
                    sizes: false,
                  },
                  {
                    heading: "Removing",
                    groups: removingGroups,
                    tone: "text-red-700 dark:text-red-300",
                    empty:
                      "Nothing ticked — the file is left exactly as it is.",
                    sizes: true,
                  },
                ] as const
              ).map((column) => (
                // The column, so a kind's two cards line up across it however
                // many rows the one beside them happens to hold.
                <div key={column.heading} className="flex flex-col gap-4">
                  {/* The column's name, said once above it rather than at the
                      top of every card in it.

                      Carried in each card header it was the same word twice
                      down a column two cards long, and the word that actually
                      differed between them — Audio, Subtitles — was the one set
                      second and lighter. Out here it names the column once, and
                      a card header is free to say only the thing that card
                      alone says.

                      The rule under it is the app's own `rule-head`, at the
                      scale of a heading inside a dialog rather than the page
                      heading `SectionHeading` draws: the panel's own title is
                      set at `text-base`, and a section inside it cannot be the
                      larger of the two. */}
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold tracking-tight">
                      {column.heading}
                    </h3>
                    <div aria-hidden className="rule-head" />
                  </div>

                  {column.groups.length === 0 ? (
                    <p className="rounded-3xl border border-line px-4 py-3 text-sm opacity-45">
                      {column.empty}
                    </p>
                  ) : (
                    column.groups.map((group) => (
                      <section
                        key={group.kind}
                        className="overflow-hidden rounded-3xl border border-line"
                      >
                        <header className="card-band flex items-baseline justify-between gap-3 px-4 py-3">
                          <h4 className="min-w-0 truncate text-xs font-semibold tracking-wide uppercase opacity-50">
                            {group.kind}
                          </h4>
                          <p className="shrink-0 text-xs tabular-nums opacity-45">
                            {join([
                              `${group.rows.length}`,
                              column.sizes && group.bytes > 0
                                ? size(group.bytes)
                                : undefined,
                            ])}
                          </p>
                        </header>

                        <ul className="card-band ruled">
                          {group.rows.map((row, i) => (
                            <li
                              key={row.key}
                              style={stagger(i)}
                              className="row-enter flex items-baseline gap-3 px-4 py-2.5"
                            >
                              <span className="min-w-0 flex-1">
                                <span
                                  className={`block truncate text-sm ${column.tone}`}
                                >
                                  {row.title}
                                </span>
                                {row.meta && (
                                  <span className="mt-0.5 block truncate text-xs opacity-45">
                                    {row.meta}
                                  </span>
                                )}
                              </span>
                              {column.sizes && (
                                <span className="shrink-0 text-sm tabular-nums opacity-45">
                                  {row.bytes === undefined
                                    ? "—"
                                    : size(row.bytes)}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))
                  )}
                </div>
              ))}
            </div>

            {/* What the operation is, said once and last. The same three
                promises the film's own confirmation makes, because it is the
                same operation and it would be strange to hear them in only one
                of the two places it can be started from.

                Each led by the word it is really about. Three bullets of prose
                are three sentences you read or do not; three words you can take
                in without reading past them are what someone about to press the
                button actually needs. */}
            <div className="flex flex-col gap-2">
              <div aria-hidden className="rule-head" />
              <dl className="grid gap-x-8 gap-y-1.5 text-xs opacity-60 sm:grid-cols-3">
                {(
                  [
                    [
                      "Reversible",
                      "the original, with every track, is kept beside the film until you delete it",
                    ],
                    [
                      "Lossless",
                      "nothing is re-encoded — the tracks you keep are copied byte for byte",
                    ],
                    [
                      "Interruptible",
                      "it rewrites the whole file, and cancelling leaves the original untouched",
                    ],
                  ] as const
                ).map(([term, rest]) => (
                  <div key={term}>
                    <dt className="inline font-medium">{term}</dt>{" "}
                    <dd className="inline">— {rest}.</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}
      </div>

      <div aria-hidden className="rule-head" />

      {error && (
        <p className="text-sm wrap-anywhere text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* One row: what the ticks come to on the left, and what to do about it
          on the right. Stacked, the reading and its small print pushed the
          buttons a third of the dialog's height further down and left a band of
          empty panel beside them — and the sentence and the button it justifies
          read as two unrelated things when they are the same statement. Wrapped
          rather than squeezed at a narrow window, where the buttons drop under
          the words instead of shrinking them.

          Aligned on the baseline of the last line of text: the left column is
          two lines of different sizes, and centring it against a row of pills
          leaves neither the number nor the buttons lined up with anything. */}
      {/* Justified to the end rather than between, so that the screen with no
          reading keeps its buttons where the other two put them. `mr-auto` on
          the reading is what pushes them apart when there is one — the same
          result on those screens, and no empty column holding a place on this
          one. */}
      <div className="mt-1 flex flex-wrap items-end justify-end gap-x-6 gap-y-3">
        {reading && (
          <div className="mr-auto flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-sm">{reading}</p>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2">
          {/* Back on every screen but the first, where the way out is Cancel.
              Both sit in the same place, because they are the same gesture at
              different depths and a button that moves is a button you have to
              find twice. */}
          <button
            type="button"
            onClick={() => (at === 0 ? onClose() : setAt(at - 1))}
            disabled={starting}
            className={BUTTON.secondary}
          >
            {at === 0 ? "Cancel" : "Back"}
          </button>

          {last ? (
            <button
              type="button"
              onClick={start}
              disabled={Boolean(refusal) || starting || total === 0}
              title={
                refusal ??
                "Remuxes the file without them. The original is kept beside it."
              }
              autoFocus
              className={BUTTON.primary}
            >
              {starting && <Spinner />}
              Remove {count(total, "track")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setAt(at + 1)}
              disabled={starting}
              autoFocus
              className={BUTTON.primary}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
