"use client";

import { useRef, useState } from "react";

import { beginStripAudio } from "@/app/actions";
import { BUTTON } from "@/app/controls";
import { useJobs } from "@/app/jobs-provider";
import { CloseButton, Modal } from "@/app/modal";
import { Spinner } from "@/app/spinner";
import { Tick } from "@/app/tick";
import { savingsOf, tickRange } from "@/lib/audio-plan";
import { AUDIO_BACKUP_SUFFIX, languageName } from "@/lib/derive";
import type { AudioTask } from "@/lib/queue-tasks";

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
 * which makes the common case one click on a button labelled Continue; and it
 * is a table rather than a sentence, because the case that brought you here is
 * the one where the proposal is nearly right — the commentary you want gone,
 * the duplicate English track, the one Hungarian DTS-HD track that is actually
 * the film's own language.
 *
 * The film's page keeps its console, and keeps everything this cannot say: what
 * the file has been through, the way back once the tracks are gone, and the
 * backup sitting beside it. Nothing here points at it, though. A dialog with
 * three buttons makes you read three before pressing one, and the two that
 * matter are the answer and the way out — the film is a row away in the list
 * behind this, which is where somebody who wants the page will look anyway.
 */

/** Same two-tier form the row above this dialog is written in. */
const size = (bytes: number) =>
  bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(2)} TB`
    : `${(bytes / 1e9).toFixed(1)} GB`;

export function AudioPicker({
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

  const { tracks } = task;

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
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The last row ticked by hand, which is what a shift-click measures from. */
  const anchor = useRef<number | null>(null);

  const {
    bytes: freed,
    estimated: anyEstimated,
    incomplete: anyUnsized,
  } = savingsOf(tracks, selected);

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
    setSelected((current) =>
      tickRange(current, ordinal, from, range, tracks.length),
    );
  }

  async function start() {
    setError(null);
    setStarting(true);

    const ordinals = [...selected].sort((a, b) => a - b);
    const result = await beginStripAudio(
      task.path,
      ordinals,
      tracks.length,
      // The Matroska numbers as this list has them, for the server to check
      // against what mkvmerge reports before it rewrites anything. Sent by
      // ordinal so the two lists line up on the far side.
      tracks.map((track) => track.number),
      freed || undefined,
    );
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
        freedBytes: freed || undefined,
      },
    });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!starting}
      label={`Choose which audio tracks to remove from ${task.fileName}`}
      // Wider than the app's other dialogs, which ask a question in a sentence
      // or two. This one holds a five-column table whose cells are a codec, a
      // language, a muxer's name for a track and a size — at the width of a
      // confirmation every one of those wraps, and a table that wraps in four
      // places at once stops reading as rows.
      //
      // Capped in height and scrolled inside rather than out: a rip with
      // eighteen audio tracks is exactly the file worth opening this on, and a
      // dialog taller than the window puts its own Continue button off the
      // bottom of it.
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

      <div aria-hidden className="rule-head" />

      {/* The only part that scrolls. The reading and the buttons under it are
          the two things you came for, and both stay where they were put. */}
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide opacity-50">
            <tr>
              {/* Unlabelled, as on the film's own table: a header over a column
                  of checkboxes has to be a word like "Remove", and that word
                  then sits over every row as an instruction. */}
              <th className="w-8 px-4 py-2" />
              <th className="px-4 py-2 font-medium">Format</th>
              <th className="px-4 py-2 font-medium">Language</th>
              <th className="px-4 py-2 font-medium">Track</th>
              <th className="px-4 py-2 text-right font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track, ordinal) => {
              const ticked = selected.has(ordinal);
              // Everything the queue did not propose is a track the preference
              // keeps — which is the whole reason it is unticked, and worth
              // saying on the row rather than leaving to be inferred.
              const kept =
                track.language !== undefined &&
                !task.proposed.includes(ordinal);

              return (
                <tr
                  key={ordinal}
                  // Struck through rather than merely ticked: the row is about
                  // to stop existing, and the table should look like what the
                  // file will be.
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
                      label={`Remove ${track.label}${
                        track.language
                          ? ` (${languageName(track.language)})`
                          : ""
                      }`}
                    />
                  </td>
                  <td className={`px-4 py-2 ${ticked ? "line-through" : ""}`}>
                    {track.label}
                  </td>
                  <td className="px-4 py-2 opacity-70">
                    <span className="flex items-center gap-1.5">
                      {track.language ? languageName(track.language) : "—"}
                      {kept && (
                        <span
                          title="One of the languages you keep — set in Settings"
                          className="rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap opacity-60 ring-1 ring-line-strong ring-inset"
                        >
                          KEPT
                        </span>
                      )}
                    </span>
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
      <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* What the ticks come to, in the console's own words — an exact
              total, an approximation, or a floor, depending on which of the
              three the sizes behind it support. */}
          <p className="text-sm">
            {selected.size === 0 ? (
              <span className="opacity-60">
                Tick the tracks you will never play.
              </span>
            ) : (
              <>
                <span className="font-medium">
                  {anyUnsized
                    ? "Frees at least"
                    : anyEstimated
                      ? "Frees about"
                      : "Frees"}{" "}
                  {size(freed)}
                </span>
                <span className="opacity-60">
                  {" · "}
                  {selected.size} of {tracks.length} tracks removed, leaving{" "}
                  {size(Math.max(0, task.sizeBytes - freed))} of{" "}
                  {size(task.sizeBytes)}
                </span>
              </>
            )}
          </p>

          <p className="text-xs opacity-50">
            Nothing is re-encoded — the tracks you keep are copied exactly as
            they are, and the original is kept beside the film as{" "}
            <code className="font-mono">
              {task.fileName}
              {AUDIO_BACKUP_SUFFIX}
            </code>{" "}
            until you delete it.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={starting}
            className={BUTTON.secondary}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={start}
            disabled={Boolean(refusal) || starting || selected.size === 0}
            title={
              refusal ??
              "Remuxes the file without them. The original is kept beside it."
            }
            autoFocus
            className={BUTTON.primary}
          >
            {starting && <Spinner />}
            Continue
          </button>
        </div>
      </div>
    </Modal>
  );
}
