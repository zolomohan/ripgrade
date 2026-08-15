"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  beginStripAudio,
  discardAudioBackup,
  restoreAudioOriginal,
} from "@/app/actions";
import { useJobs } from "@/app/jobs-provider";
import { Panel } from "@/app/panel";
import { useClosing } from "@/app/modal";
import {
  canStripTracks,
  isPreferred,
  isSubtitleKept,
  keptFirst,
  languageKey,
  savingsOf,
  tickRange,
  type AudioPreference,
  type SubtitlePreference,
} from "@/lib/audio-plan";
import { AUDIO_BACKUP_SUFFIX, languageName } from "@/lib/derive";
import type { AudioTrack, SubtitleTrack } from "@/lib/derive";
import { BUTTON } from "@/app/controls";
import { Tick } from "@/app/tick";
import { ConfirmModal } from "@/app/confirm";
import { size } from "@/app/format";

/**
 * What a file's tracks are, and the one thing worth doing about them.
 *
 * A disc rip carries every language the disc was pressed with, and on a remux
 * the audio is routinely half the file — a lossless 7.1 track runs to several
 * gigabytes an hour, and there are often five of them for languages nobody
 * here speaks. This is the cheapest space in the library, and unlike every
 * other way of making a film smaller it costs nothing at all in quality: the
 * kept streams are copied byte for byte and the video is never touched.
 *
 * So the tables are not only a listing. Each row can be ticked, the total says
 * what ticking it would free before anything runs, and the original is kept
 * beside the film afterwards — the same bargain the Dolby Vision console
 * offers, because it is the same kind of decision: irreversible in principle,
 * made reversible by keeping a copy until you say otherwise.
 *
 * Audio and subtitles are one console rather than two, and that is forced
 * rather than chosen. Both are removed by the same remux, and the job refuses
 * to start a second one while the original from the first is still beside the
 * film — so two consoles would mean rewriting a 90 GB file twice with a
 * restore in between, to do something that was always one operation.
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

/** A count with its noun, which four separate sentences below all wanted. */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export function TrackTables({
  moviePath,
  fileName,
  summary,
  tracks,
  subtitles,
  sizeBytes,
  backupBytes,
  present = true,
  preference,
  subtitlePreference,
  originalLanguage,
}: {
  moviePath: string;
  fileName: string;
  /** Written by the page, so the shut row and the spec grid cannot disagree. */
  summary: string;
  tracks: AudioTrack[];
  subtitles: SubtitleTrack[];
  /** The whole file, so what is freed can be stated against what is left. */
  sizeBytes: number;
  /** Size of the original still holding every track, when one is beside it. */
  backupBytes?: number;
  /** False when the film's drive is away — which is also why `backupBytes`
      is undefined, so without this a stripped film on an unplugged drive
      would read as one that was never touched. */
  present?: boolean;
  /** The languages set in Settings, which the queue's proposal is built from. */
  preference: AudioPreference;
  /** Its subtitle counterpart, which has two flags the audio one has no use for. */
  subtitlePreference: SubtitlePreference;
  /** What TMDb says this film was made in, where it has been matched. */
  originalLanguage?: string;
}) {
  const { jobs, apply, subscribe } = useJobs();
  const { strip: job } = jobs;
  const router = useRouter();

  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [selectedText, setSelectedText] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [confirming, setConfirming] = useState(false);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Each confirm outlives its flag by the length of its exit animation.
  const stripMounted = useClosing(confirming);
  const restoreMounted = useClosing(confirmingRestore);
  const deleteMounted = useClosing(confirmingDelete);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = job.status === "running" && job.path === moviePath;

  // React only to the edge out of a run we saw on this film — the status alone
  // cannot mean "just finished", because the server reports "done" forever
  // after and a connect-time snapshot would look identical to a fresh finish.
  useEffect(
    () =>
      subscribe((next, prev) => {
        const was =
          prev.strip.status === "running" && prev.strip.path === moviePath;
        if (!was) return;

        if (next.strip.status === "done") {
          // The job re-probes and re-derives the rewritten file itself, so the
          // page only needs repainting — and the ticks go with the tracks they
          // referred to, which are no longer in the file.
          setSelected(new Set());
          setSelectedText(new Set());
          router.refresh();
        } else if (next.strip.status === "error") {
          setError(next.strip.error ?? "Removing the tracks failed");
        }
      }),
    [subscribe, moviePath, router],
  );

  // -------------------------------------------------------------------------
  // What ticking a box would cost, worked out before anything runs
  // -------------------------------------------------------------------------

  const chosen = tracks.filter((_, ordinal) => selected.has(ordinal));
  const chosenText = subtitles.filter((_, ordinal) =>
    selectedText.has(ordinal),
  );
  const total = selected.size + selectedText.size;

  // Worked out before anything runs, and worded by which of its three answers
  // came back: an exact total, an approximation, or a floor. Both tables are
  // asked and the answers added, because one remux takes both.
  const audioSaving = savingsOf(tracks, selected);
  const textSaving = savingsOf(subtitles, selectedText);
  const freed = audioSaving.bytes + textSaving.bytes;
  const anyEstimated = audioSaving.estimated || textSaving.estimated;
  const anyUnsized = audioSaving.incomplete || textSaving.incomplete;

  const matroska = canStripTracks(fileName);
  const stripped = backupBytes !== undefined;
  const justStripped = job.status === "done" && job.path === moviePath;
  /**
   * Whether there is an original to go back to. The filesystem is the authority
   * whenever it can be read; only with the drive away does the removal this
   * server ran stand in for it.
   */
  const hasBackup = stripped || (!present && justStripped);

  /** Set only when the drive is away, so it can override every other tooltip. */
  const offline = present ? undefined : "Drive not connected";

  /**
   * A film with no audio at all is not something anyone means to make, and it
   * is not something this page will let you ask for.
   *
   * Three layers say so, because the operation is irreversible once the backup
   * is gone: the selection itself cannot cover every track, the last unticked
   * box will not tick, and the button refuses anyway. The server refuses too,
   * in `resolvePlan`, which is the one that actually guarantees it — the three
   * here are so that nobody has to find out that way.
   *
   * None of it applies to the subtitle table. A film with no subtitles is an
   * ordinary film, and a rule that stopped you removing the last one would be
   * inventing a requirement Matroska does not have.
   */
  const wouldSilence = selected.size > 0 && selected.size >= tracks.length;
  const selectable = matroska && present && !hasBackup && !running;

  /** True of the one box that would empty the film if it were ticked. */
  const lastStanding = (ordinal: number) =>
    !selected.has(ordinal) && selected.size >= tracks.length - 1;

  /**
   * Whether a track is in a language you said you keep.
   *
   * Marked in the table and warned about in the dialog, but never refused: the
   * setting is what the *queue* proposes, not a lock on the file in front of
   * you. A duplicate English track, a commentary in your own language, a
   * lossless track you are replacing with the lossy one — all of them are
   * reasons to remove something the preference would otherwise keep, and none
   * of them is the app's business to prevent. Its business is making sure you
   * meant it.
   */
  const preferred = (track: AudioTrack) =>
    // An untagged track counts as preferred everywhere else in the app, which
    // is the right default when deciding what to *remove* — but a chip on every
    // untagged row would be claiming knowledge nobody has.
    track.language !== undefined &&
    isPreferred(track.language, preference, originalLanguage);

  /**
   * The same question of a text track, which has two more ways of answering it.
   *
   * A forced track is kept whatever language it names, and an SDH track can be
   * dropped from a language that is otherwise kept — so unlike the audio one
   * this is worth asking even of an untagged row, because the answer may have
   * nothing to do with its language.
   */
  const keptText = (track: SubtitleTrack) =>
    isSubtitleKept(track, subtitlePreference, originalLanguage);

  /** Which of the two rules is why, for the chip's own tooltip. */
  const keptTextWhy = (track: SubtitleTrack) =>
    subtitlePreference.forced && track.forced
      ? "Forced — kept whatever language it names, because it is the signs rather than the dialogue"
      : isOriginalTag(track.language)
        ? "The language this film was made in, which you keep"
        : "One of the subtitle languages you keep — set in Settings";

  /** True of a language tag that is the film's own. */
  const isOriginalTag = (language?: string) =>
    Boolean(
      preference.original &&
      originalLanguage &&
      language &&
      languageKey(language) === languageKey(originalLanguage),
    );

  /** True of a track kept only because it is the film's own language. */
  const isOriginal = (track: AudioTrack) => isOriginalTag(track.language);

  /**
   * The order the two tables draw their rows in — what you keep, first.
   *
   * From the preference only, never from the ticks: a table that reordered
   * itself as boxes were ticked would move the next row out from under the
   * cursor. So a row's place is fixed for as long as the settings behind it
   * are, and ticking never moves anything.
   */
  const order = useMemo(
    () => keptFirst(tracks, preferred),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, preference, originalLanguage],
  );
  const orderText = useMemo(
    () => keptFirst(subtitles, keptText),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subtitles, subtitlePreference, originalLanguage],
  );

  /** The preferred tracks about to be removed — the reason for the warning. */
  const preferredChosen = chosen.filter(preferred);
  const keptTextChosen = chosenText.filter(keptText);
  const warned = preferredChosen.length + keptTextChosen.length;

  /**
   * The last row ticked by hand in each table, which is what a shift-click
   * measures from. One per table: a run started in the audio list has no
   * meaning in the subtitle one, and sharing an anchor between them would make
   * a shift-click select a range nobody drew.
   *
   * Refs rather than state: nothing on the page is drawn from them, and moving
   * one should never be a reason to re-render a table.
   */
  const anchor = useRef<number | null>(null);
  const anchorText = useRef<number | null>(null);

  /** Ticking a row, or — with shift held — the run up to the last one ticked. */
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

  async function runStrip() {
    setError(null);
    setConfirming(false);

    const ordinals = [...selected].sort((a, b) => a - b);
    const textOrdinals = [...selectedText].sort((a, b) => a - b);

    const result = await beginStripAudio({
      path: moviePath,
      removeOrdinals: ordinals,
      audioCount: tracks.length,
      // The Matroska numbers as this page has them, for the server to check
      // against what mkvmerge reports before it rewrites anything. Sent by
      // ordinal so the two lists line up on the far side.
      numbers: tracks.map((track) => track.number),
      // Sent whenever the file has any, ticked or not: the count is what tells
      // the server the page and the file still agree about this half too.
      ...(subtitles.length > 0 && {
        removeSubtitleOrdinals: textOrdinals,
        subtitleCount: subtitles.length,
        subtitleNumbers: subtitles.map((track) => track.number),
      }),
      freedBytes: freed || undefined,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    apply({
      strip: {
        status: "running",
        path: moviePath,
        percent: 0,
        removed: ordinals.length,
        kept: tracks.length - ordinals.length,
        removedSubtitles: textOrdinals.length,
        keptSubtitles: subtitles.length - textOrdinals.length,
        freedBytes: freed || undefined,
      },
    });
  }

  async function runRestore() {
    setError(null);
    setWorking(true);
    const result = await restoreAudioOriginal(moviePath);
    setWorking(false);
    setConfirmingRestore(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function runDeleteBackup() {
    setError(null);
    setWorking(true);
    const result = await discardAudioBackup(moviePath);
    setWorking(false);
    setConfirmingDelete(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  // -------------------------------------------------------------------------
  // What the console says, and what it offers to do about it
  // -------------------------------------------------------------------------

  /** What is going, in the words the banner and the button both need. */
  const going = [
    selected.size > 0 && count(selected.size, "audio track"),
    selectedText.size > 0 && count(selectedText.size, "subtitle track"),
  ]
    .filter(Boolean)
    .join(" and ");

  /**
   * The one line at the top. Whatever is happening to the file outranks
   * anything about the selection — mid-removal, and afterwards while the
   * original is still recoverable, the state of the file *is* the answer.
   */
  const banner: { headline: string; body?: React.ReactNode } = running
    ? {
        headline: `Removing ${
          [
            job.removed && count(job.removed, "audio track"),
            job.removedSubtitles &&
              count(job.removedSubtitles, "subtitle track"),
          ]
            .filter(Boolean)
            .join(" and ") || "tracks"
        }…`,
        body: "Cancelling never touches the original.",
      }
    : hasBackup
      ? {
          headline: "Tracks removed",
          body: (
            <>
              Original kept as{" "}
              <code className="font-mono">
                {fileName}
                {AUDIO_BACKUP_SUFFIX}
              </code>
              {backupBytes !== undefined && <>, {size(backupBytes)}</>}.
            </>
          ),
        }
      : !matroska
        ? {
            headline: "Nothing to remove here",
            body: "Only Matroska (.mkv) files can have tracks removed — anything else would have to change container to do it.",
          }
        : tracks.length < 2 && subtitles.length === 0
          ? {
              headline:
                tracks.length === 1
                  ? "One audio track, no subtitles"
                  : "No tracks at all",
              body:
                tracks.length === 1
                  ? "Nothing to remove without leaving the film silent."
                  : undefined,
            }
          : total === 0
            ? {
                headline: [
                  count(tracks.length, "audio track"),
                  subtitles.length > 0 &&
                    count(subtitles.length, "subtitle track"),
                ]
                  .filter(Boolean)
                  .join(", "),
                body: "Tick the ones you will never play to see what removing them frees.",
              }
            : {
                headline: `${
                  anyUnsized
                    ? "Frees at least"
                    : anyEstimated
                      ? "Frees about"
                      : "Frees"
                } ${size(freed)}`,
                body: wouldSilence ? (
                  "That is every audio track — keep at least one."
                ) : (
                  <>
                    {going} removed, leaving{" "}
                    {size(Math.max(0, sizeBytes - freed))} of {size(sizeBytes)}.
                  </>
                ),
              };

  /** Whether there is anything on this file worth offering a button for. */
  const anythingToRemove = tracks.length > 1 || subtitles.length > 0;

  /**
   * One decision per state, so the console has one thing to press: remove while
   * there is something ticked, and put it back while the original is still
   * there. Every one of them reaches the file itself, so with the drive away
   * they go grey together rather than disappearing — an unplugged drive is a
   * temporary state, and a card that drops its buttons reads as one that never
   * had any.
   */
  const actions = hasBackup ? (
    <>
      <button
        type="button"
        onClick={() => setConfirmingDelete(true)}
        disabled={!present || working}
        title={
          offline ??
          `Frees ${backupBytes !== undefined ? size(backupBytes) : "the space"} — the one step here that cannot be undone.`
        }
        className={BUTTON.dangerStanding}
      >
        Delete backup
      </button>
      <button
        type="button"
        onClick={() => setConfirmingRestore(true)}
        disabled={!present || working}
        title={
          offline ?? "Puts the file with every track back under its own name."
        }
        className={BUTTON.secondary}
      >
        Restore original
      </button>
    </>
  ) : (
    matroska &&
    anythingToRemove && (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={!selectable || total === 0 || wouldSilence}
        title={
          offline ??
          (wouldSilence
            ? "That would leave the film with no audio at all."
            : "Remuxes the file without them. The original is kept beside it.")
        }
        className={BUTTON.primary}
      >
        {total > 0 ? `Remove ${count(total, "track")}` : "Remove tracks"}
      </button>
    )
  );

  /**
   * The columns each table carries.
   *
   * Written out per table rather than shared with a parameter or two. The two
   * genuinely differ — an audio track has channels and a bitrate, a text track
   * has cues and three flags worth reading — and a helper that took the
   * difference as arguments ended up dictating an order that suited neither.
   *
   * The first is unlabelled in both: a header over a column of checkboxes has
   * to be a word like "Remove", and that word then sits over every row as an
   * instruction rather than a description.
   */
  const head = (columns: [string, boolean][]) => (
    <thead className="text-xs uppercase tracking-wide opacity-50">
      <tr>
        <th className="w-8 px-4 py-2" />
        {columns.map(([label, right]) => (
          <th
            key={label}
            className={`px-4 py-2 font-medium ${right ? "text-right" : ""}`}
          >
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );

  /** One track's size cell, which both tables word identically. */
  const sizeCell = (track: { sizeBytes?: number; sizeEstimated?: boolean }) => (
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
  );

  /** The chip that says a row is one the preference keeps. */
  const chip = (label: string, title: string) => (
    <span
      title={title}
      className="rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap opacity-60 ring-1 ring-line-strong ring-inset"
    >
      {label}
    </span>
  );

  return (
    <Panel title="Audio and subtitle tracks" summary={summary}>
      <div className="flex flex-col gap-6">
        {/* One console, in bands parted by the same hairline the Dolby Vision
            card parts its own by: what the selection would cost, and — under
            the rule — the button that acts on it.

            The buttons sat on the same line as the reading until they were
            asked to stand apart, and the hairline is the whole of what that
            takes: `.card-band + .card-band` draws it, so a band that is only
            ever added or dropped brings its own rule with it. Skipped entirely
            when there is nothing to press, which is a real state here — a file
            that is not Matroska, or has a single track and no subtitles, is a
            card that reads and offers nothing — and an empty band under a rule
            would announce a decision that was never on the table. */}
        <div className="overflow-hidden rounded-3xl border border-line">
          <div className="card-band px-4 py-5">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium">{banner.headline}</p>
              {banner.body && (
                <p className="text-sm opacity-60">{banner.body}</p>
              )}
            </div>
          </div>

          {!running && actions && (
            <div className="card-band flex flex-wrap items-center justify-end gap-2 px-4 py-4">
              {total > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelected(new Set());
                    setSelectedText(new Set());
                  }}
                  className={BUTTON.text}
                >
                  Clear
                </button>
              )}
              {actions}
            </div>
          )}

          {running && (
            <div className="card-band px-4 py-5">
              {/* The rail carries this too, but a film's own page is where the
                  removal was started and where its progress is being watched. */}
              <div className="bar-track w-full">
                <div
                  className="bar-fill transition-[width] duration-500"
                  style={{ width: `${Math.max(2, job.percent ?? 0)}%` }}
                />
              </div>
              <p className="mt-2 text-xs opacity-50">
                {job.label ?? "Remuxing"}
                {job.percent !== undefined && ` · ${Math.round(job.percent)}%`}
              </p>
            </div>
          )}

          {error && (
            <div className="card-band px-4 py-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            {head([
              ["Format", false],
              ["Channels", false],
              ["Language", false],
              ["Track", false],
              ["Bitrate", true],
              ["Size", true],
            ])}
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
                    {/* No padding of its own: the label inside carries it, so
                        the whole cell is clickable rather than the 18 pixels
                        in the middle of it. */}
                    <td className="p-0">
                      <Tick
                        checked={ticked}
                        disabled={!selectable || lastStanding(ordinal)}
                        // Not simply dead: the one box it refuses says why, and
                        // unticking anything else lights it up again — which
                        // reads as a rule about films rather than as a row that
                        // would not respond.
                        refusal={
                          selectable && lastStanding(ordinal)
                            ? "A film has to keep one audio track — untick another to remove this one instead"
                            : undefined
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
                      {track.channels || "—"}
                    </td>
                    <td className="px-4 py-2 opacity-70">
                      <span className="flex items-center gap-1.5">
                        {track.language ? languageName(track.language) : "—"}
                        {/* Marked here rather than only in the dialog: the
                            point of a mark is to be seen before the decision,
                            not while it is being confirmed. */}
                        {preferred(track) &&
                          chip(
                            isOriginal(track) ? "ORIGINAL" : "KEPT",
                            isOriginal(track)
                              ? "The language this film was made in, which you keep"
                              : "One of the languages you keep — set in Settings",
                          )}
                      </span>
                    </td>
                    {/* The muxer's name for the track and the flags a player
                        reads are one answer to "which one is this", so they are
                        one column rather than three sparse ones — the same way
                        the subtitle table below puts them. */}
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
                      {track.bitrateKbps
                        ? `${track.bitrateKbps.toLocaleString()} kbps`
                        : "—"}
                    </td>
                    {sizeCell(track)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* The text tracks, under the same rule the console's bands use. The
            spec grid at the top of the page says which languages are in there;
            this says what they actually are, which is the difference between a
            full English track and a forced one that only translates the signs.

            A file with none of them draws no heading and no empty table: there
            is nothing to say about a film that carries no subtitles beyond the
            line the spec grid already carries. */}
        {subtitles.length > 0 && (
          <div className="flex flex-col gap-3">
            <div aria-hidden className="rule-head" />
            <h3 className="text-xs font-semibold uppercase tracking-wide opacity-50">
              Subtitles
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                {head([
                  ["Format", false],
                  ["Language", false],
                  ["Track", false],
                  ["Flags", false],
                  ["Cues", true],
                  ["Size", true],
                ])}
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
                            disabled={!selectable}
                            onTick={(range) => tickText(ordinal, range)}
                            label={`Remove ${track.format}${
                              track.language
                                ? ` (${languageName(track.language)})`
                                : ""
                            }`}
                          />
                        </td>
                        <td
                          className={`px-4 py-2 ${ticked ? "line-through" : ""}`}
                        >
                          {track.format}
                        </td>
                        <td className="px-4 py-2 opacity-70">
                          <span className="flex items-center gap-1.5">
                            {track.language
                              ? languageName(track.language)
                              : "—"}
                            {keptText(track) &&
                              chip("KEPT", keptTextWhy(track))}
                          </span>
                        </td>
                        <td className="px-4 py-2 opacity-70">
                          {track.title || "—"}
                        </td>
                        {/* Their own column rather than folded into the name:
                            forced and SDH are what the two preference switches
                            act on, so they are worth reading straight down. */}
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
                          {track.cues?.toLocaleString() ?? "—"}
                        </td>
                        {sizeCell(track)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {stripMounted && (
          <ConfirmModal
            open={confirming}
            title={
              warned > 0
                ? `Remove ${count(warned, "track")} you said you keep?`
                : `Remove ${going}?`
            }
            // The dialog turns red on the one case worth stopping at. Every
            // removal here is reversible while the original is beside the film,
            // so the tone is about the selection being a mistake rather than
            // about the operation being dangerous.
            tone={warned > 0 ? "danger" : "neutral"}
            confirmLabel={warned > 0 ? "Remove them anyway" : "Remove"}
            onConfirm={runStrip}
            onCancel={() => setConfirming(false)}
          >
            {/* Named before the list rather than inside it: this is the one
                thing in the dialog that might change your mind, and a bullet
                among four bullets is not a warning. */}
            {warned > 0 && (
              <p className="mb-3 rounded-control border border-red-500/40 bg-red-500/[0.08] px-3 py-2 text-red-700 dark:text-red-300">
                {[...preferredChosen, ...keptTextChosen]
                  .map((track) =>
                    track.language
                      ? languageName(track.language)
                      : "an untagged track",
                  )
                  .join(", ")}{" "}
                {warned === 1 ? "is" : "are"} among what you keep
                {preferredChosen.some(isOriginal) &&
                  ` — and ${
                    warned === 1 ? "it is" : "one of them is"
                  } the language this film was made in`}
                . Settings is where those lists are set; this removes{" "}
                {warned === 1 ? "it" : "them"} from this film only.
              </p>
            )}

            <ul className="list-disc space-y-1.5 pl-5">
              {chosen.length > 0 && (
                <li>
                  Audio going:{" "}
                  {chosen
                    .map(
                      (track) =>
                        `${track.label}${
                          track.language
                            ? ` (${languageName(track.language)})`
                            : ""
                        }`,
                    )
                    .join(", ")}
                  .
                </li>
              )}
              {chosenText.length > 0 && (
                <li>
                  Subtitles going:{" "}
                  {chosenText
                    .map(
                      (track) =>
                        `${
                          track.language
                            ? languageName(track.language)
                            : "untagged"
                        }${track.forced ? " forced" : ""}${
                          track.sdh ? " SDH" : ""
                        } ${track.format}`,
                    )
                    .join(", ")}
                  .
                </li>
              )}
              <li>
                The original is renamed to{" "}
                <code className="font-mono text-xs">
                  {fileName}
                  {AUDIO_BACKUP_SUFFIX}
                </code>{" "}
                and kept beside it, so this needs room for both until you delete
                it.
              </li>
              <li>
                Nothing is re-encoded. Video, chapters and the tracks you keep
                are copied exactly as they are.
              </li>
              <li>
                It rewrites the whole file. Cancelling at any point leaves the
                original untouched.
              </li>
            </ul>
          </ConfirmModal>
        )}

        {restoreMounted && (
          <ConfirmModal
            open={confirmingRestore}
            title="Put every track back?"
            confirmLabel={working ? "Restoring…" : "Restore original"}
            busy={working}
            onConfirm={runRestore}
            onCancel={() => setConfirmingRestore(false)}
          >
            The stripped file is deleted and{" "}
            <code className="font-mono text-xs">
              {fileName}
              {AUDIO_BACKUP_SUFFIX}
            </code>{" "}
            takes its place under the original name. You can always remove them
            again.
          </ConfirmModal>
        )}

        {deleteMounted && backupBytes !== undefined && (
          <ConfirmModal
            open={confirmingDelete}
            title="Delete the original, with every track?"
            confirmLabel={working ? "Deleting…" : `Delete ${size(backupBytes)}`}
            tone="danger"
            busy={working}
            onConfirm={runDeleteBackup}
            onCancel={() => setConfirmingDelete(false)}
          >
            Frees {size(backupBytes)} and leaves the stripped file as the only
            copy. Getting the removed tracks back after this means ripping the
            disc again.
          </ConfirmModal>
        )}
      </div>
    </Panel>
  );
}
