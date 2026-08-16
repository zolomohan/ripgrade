"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { discardAudioBackup, restoreAudioOriginal } from "@/app/actions";
import { useJobs } from "@/app/jobs-provider";
import { Panel } from "@/app/panel";
import { useClosing, useLingering } from "@/app/modal";
import { TrackPicker } from "@/app/jobs/track-picker";
import {
  canStripTracks,
  isPreferred,
  isSubtitleKept,
  keptFirst,
  languageKey,
  type AudioPreference,
  type SubtitlePreference,
} from "@/lib/audio-plan";
import { AUDIO_BACKUP_SUFFIX, languageName } from "@/lib/derive";
import type { AudioTrack, SubtitleTrack } from "@/lib/derive";
import type { AudioTask } from "@/lib/queue-tasks";
import { BUTTON } from "@/app/controls";
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
 * The tables here read and nothing more. They used to be the console as well:
 * every row carried a checkbox, the banner totalled what was ticked, and a
 * button at the top ran the removal — which is the same job the jobs page asks
 * in a three-screen dialog, asked a second way, in a second layout, with its
 * own confirmation to keep in step. Two answers to one question is how the two
 * drifted: this one had no review screen and no per-kind grouping, and the
 * dialog had no KEPT chips.
 *
 * So the question is asked in one place now. This is what the file holds, and
 * "Strip tracks" opens the same picker the jobs page opens, on the same task,
 * with the same boxes already ticked — see `audioTaskFor`. What stays here is
 * everything the picker has nothing to say about: which languages you keep,
 * what each track costs, and the original a past removal left beside the film.
 *
 * Audio and subtitles are one listing rather than two, and that is forced
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
  task,
  backupBytes,
  present = true,
  preference,
  subtitlePreference,
  originalLanguage,
}: {
  moviePath: string;
  fileName: string;
  /**
   * The audio row's shut line, written by the page so it and the spec grid
   * cannot disagree. The subtitle row writes its own — see `textSummary` — as
   * nothing above this component knows what is in those tracks.
   */
  summary: string;
  tracks: AudioTrack[];
  subtitles: SubtitleTrack[];
  /**
   * This film as the picker takes it — the same object the jobs page hands the
   * same dialog, so both open on the same proposal. Undefined where there is
   * nothing to open it on: a container whose tracks cannot be rewritten, or a
   * preference with nothing to say about this film's own language.
   */
  task?: AudioTask;
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
  const { jobs, subscribe } = useJobs();
  const { strip: job } = jobs;
  const router = useRouter();

  /** Whether the picker is up. The dialog owns the whole of the decision. */
  const [picking, setPicking] = useState(false);
  // It outlives the flag by its exit animation, and keeps the task it was
  // opened on for as long as it is leaving.
  const held = useLingering(picking ? task : undefined);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Each confirm outlives its flag by the length of its exit animation.
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
          // page only needs repainting: the tables below are about to be a
          // shorter list.
          router.refresh();
        } else if (next.strip.status === "error") {
          setError(next.strip.error ?? "Removing the tracks failed");
        }
      }),
    [subscribe, moviePath, router],
  );

  // -------------------------------------------------------------------------
  // What the file holds, and what has already been done to it
  // -------------------------------------------------------------------------

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
   * Whether this file is one the question can be put to at all.
   *
   * Two different things, deliberately kept apart. This one is about the file:
   * a container whose tracks cannot be rewritten, or a film with one audio
   * track and no subtitles, will never have anything to remove, and the banner
   * above says so in words — there is no button for it because there is no
   * such decision, today or ever.
   *
   * Whether it can be pressed *now* is `stripRefusal` below. That distinction
   * is the whole of it: a drive that is unplugged is a temporary state, and a
   * card that drops its buttons for one reads as a card that never had any.
   *
   * The guards that used to live here — no ticking every audio track, the last
   * box refusing — went with the checkboxes. They are the picker's now, and the
   * server's in `resolvePlan`, which is the one that actually guarantees it.
   */
  const offerStrip =
    matroska &&
    !hasBackup &&
    !running &&
    (tracks.length > 1 || subtitles.length > 0);

  /**
   * Why it cannot be pressed at this moment, where it cannot.
   *
   * The drive first, as everywhere else on this page. After it, the one case
   * where the picker has nothing to open on: `audioTaskFor` builds no task for
   * a film whose own language is unknown while your preferences keep it, since
   * every proposal it would make rests on knowing what "original" means here.
   * The button stays, greyed, saying which — a film that quietly has no button
   * is a film you go looking through Settings for.
   */
  const stripRefusal =
    offline ??
    (task
      ? undefined
      : "This film has no TMDb match, so the original language your settings keep cannot be worked out for it");

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

  /**
   * The one line at the top. Whatever is happening to the file outranks
   * everything else — mid-removal, and afterwards while the original is still
   * recoverable, the state of the file *is* the answer.
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
          : {
              /*
               * What the file holds, and nothing about a selection.
               *
               * This line used to change as boxes were ticked — "Frees 8.4 GB
               * · 3 tracks removed, leaving 34.1 GB of 42.5 GB" — which was
               * the best thing about the old console and is now the first
               * screen of the picker, worked out against the same tracks. A
               * page that answered it too would be a second running total to
               * keep in step with the dialog's.
               */
              headline: [
                count(tracks.length, "audio track"),
                subtitles.length > 0 &&
                  count(subtitles.length, "subtitle track"),
              ]
                .filter(Boolean)
                .join(", "),
              /*
               * The two facts that decide whether anybody presses the button,
               * rather than a description of what the button opens.
               *
               * It read "Strip tracks opens the same three screens the jobs
               * page does — what goes, what stays, and what it frees", which
               * is true, is about this app's own furniture, and answers a
               * question nobody standing here has: they can see the button,
               * and the dialog introduces itself. What they cannot see is
               * whether this is safe — and it is, twice over: the kept streams
               * are copied byte for byte so nothing is re-encoded, and the
               * whole file is kept beside the new one until you delete it.
               */
              body: offerStrip
                ? "Remove the ones you will never play. Nothing is re-encoded, and the original is kept beside the film until you delete it."
                : undefined,
            };

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
    // One button, and it opens a dialog rather than starting anything. Enabled
    // on any file the question can be asked of — what is worth removing from it
    // is the dialog's to answer, and a button that greys out until you have
    // ticked something is a control you cannot find your way into.
    offerStrip && (
      <button
        type="button"
        onClick={() => setPicking(true)}
        disabled={Boolean(stripRefusal)}
        title={
          stripRefusal ??
          "Choose which tracks go. Nothing is written until you say."
        }
        className={BUTTON.primary}
      >
        Strip tracks
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
   * Neither leads with a checkbox any more: what to remove is asked in the
   * picker, and a column of boxes on a table nobody can act on is a control
   * that does nothing.
   */
  const head = (columns: [string, boolean][]) => (
    <thead className="text-xs uppercase tracking-wide opacity-50">
      <tr>
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

  /**
   * What the subtitle row says with the panel shut: how many, and in what.
   *
   * Languages rather than formats, and only as many as fit: a shut row is
   * deciding whether to open, and "PGS · PGS · SRT" is not a reason to. Named
   * in full up to three, counted after that.
   */
  const named = [
    ...new Set(
      subtitles.map((track) =>
        track.language ? languageName(track.language) : "Untagged",
      ),
    ),
  ];
  const textSummary = [
    count(subtitles.length, "track"),
    named.length > 3
      ? `${named.slice(0, 3).join(", ")} +${named.length - 3}`
      : named.join(", "),
  ]
    .filter(Boolean)
    .join(" · ");

  /**
   * The state of the file and what can be done about it, drawn at the head of
   * both panels.
   *
   * Both, rather than once above them, because the two are separate sections
   * now and a section whose only button is in the other one is a section you
   * have to leave to act on. It is the same card either way — the same state,
   * the same dialog behind the same press — which is the point: the removal is
   * one remux over both kinds of track, and where you started it from is not a
   * fact about it.
   *
   * The bands are parted by the same hairline the Dolby Vision card parts its
   * own by. `.card-band + .card-band` draws it, so a band that is only ever
   * added or dropped brings its own rule with it. The button band is skipped
   * entirely when there is nothing to press, which is a real state here — a
   * file that is not Matroska reads and offers nothing — and an empty band
   * under a rule would announce a decision that was never on the table.
   */
  const stateCard = (
    <div className="overflow-hidden rounded-3xl border border-line">
      {/* The state and the button that acts on it, on one line — the shape the
          Dolby Vision card next to this one has always had. They were two bands
          with a hairline between them, which drew a rule across the card to
          part a sentence from the button answering it and left the button
          hanging under a line of its own.

          `flex-1` on the text so the buttons keep the right edge however short
          the sentence is, and wrapping rather than squeezing at a narrow
          window: the backup state carries a filename, and two buttons pushed
          against ninety characters of it is a row that reads as neither. */}
      <div className="card-band flex flex-wrap items-center justify-between gap-3 px-4 py-5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium">{banner.headline}</p>
          {banner.body && <p className="text-sm opacity-60">{banner.body}</p>}
        </div>

        {!running && actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>

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
  );

  return (
    <>
      {/* Two sections rather than one.
       *
       * They were a single panel called "Audio and subtitle tracks" holding two
       * tables under one heading, and the second was something you met on the
       * way past the first — nine subtitle rows are the same amount of page as
       * six audio ones, and only one of the two was ever named in the summary
       * you read with the panel shut. Two rows on the page, each saying how many
       * of its own kind there are, is the answer to which of them is worth
       * opening.
       *
       * What they share is the console at the head of each, because the removal
       * does not split the way the reading does: one remux takes both kinds, and
       * the file refuses a second while the original from the first is still
       * beside it. */}
      <Panel title="Audio tracks" summary={summary}>
        <div className="flex flex-col gap-6">
          {stateCard}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              {/* Language first, as the picker's tables and its review screen
                both read: the decision these describe is made in languages,
                and the codec is what you check once you know which row you are
                looking at. */}
              {head([
                ["Language", false],
                ["Format", false],
                ["Channels", false],
                ["Track", false],
                ["Bitrate", true],
                ["Size", true],
              ])}
              <tbody>
                {order.map((ordinal) => {
                  const track = tracks[ordinal];
                  return (
                    <tr key={ordinal}>
                      <td className="px-4 py-2">
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
                      <td className="px-4 py-2 opacity-70">{track.label}</td>
                      <td className="px-4 py-2 opacity-70">
                        {track.channels || "—"}
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
        </div>
      </Panel>

      {/* The text tracks. The spec grid at the top of the page says which
          languages are in there; this says what they actually are, which is the
          difference between a full English track and a forced one that only
          translates the signs.

          No panel at all for a film that carries none: there is nothing to say
          about it beyond the line the spec grid already carries, and a row you
          can open onto an empty table is worse than no row. */}
      {subtitles.length > 0 && (
        <Panel title="Subtitle tracks" summary={textSummary}>
          <div className="flex flex-col gap-6">
            {stateCard}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                {head([
                  ["Language", false],
                  ["Format", false],
                  ["Track", false],
                  ["Flags", false],
                  ["Cues", true],
                  ["Size", true],
                ])}
                <tbody>
                  {orderText.map((ordinal) => {
                    const track = subtitles[ordinal];
                    return (
                      <tr key={ordinal}>
                        <td className="px-4 py-2">
                          <span className="flex items-center gap-1.5">
                            {track.language
                              ? languageName(track.language)
                              : "—"}
                            {keptText(track) &&
                              chip("KEPT", keptTextWhy(track))}
                          </span>
                        </td>
                        <td className="px-4 py-2 opacity-70">{track.format}</td>
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
        </Panel>
      )}

      {/* The dialogs, outside both panels. A `<details>` that is shut does not
          draw its children, and a modal that only exists while the section it
          was raised from is open is a modal that vanishes the moment anything
          collapses it.

          The picker opens on the same task the jobs page opens it on, keyed to
          the file, so it is the same dialog wherever it is raised — its own
          three screens, its own review, its own confirmation. Nothing here
          wraps it: what it asks and what it promises are its to say.

          `blocked` is the server's one rule, said before the button rather
          than after: a second remux cannot start while another is running. */}
      {held && (
        <TrackPicker
          key={held.path}
          task={held}
          open={picking}
          onClose={() => setPicking(false)}
          blocked={
            job.status === "running" && job.path !== moviePath
              ? "Another file is having its tracks removed"
              : undefined
          }
        />
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
    </>
  );
}
