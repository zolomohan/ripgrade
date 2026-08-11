"use client";

import { useEffect, useRef, useState } from "react";
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
  canStripAudio,
  isPreferred,
  languageKey,
  savingsOf,
  tickRange,
  type AudioPreference,
} from "@/lib/audio-plan";
import { AUDIO_BACKUP_SUFFIX, languageName } from "@/lib/derive";
import type { AudioTrack } from "@/lib/derive";
import { BUTTON } from "@/app/controls";
import { Tick } from "@/app/tick";
import { ConfirmModal } from "./console";

/**
 * What a file's audio tracks are, and the one thing worth doing about them.
 *
 * A disc rip carries every language the disc was pressed with, and on a remux
 * the audio is routinely half the file — a lossless 7.1 track runs to several
 * gigabytes an hour, and there are often five of them for languages nobody
 * here speaks. This is the cheapest space in the library, and unlike every
 * other way of making a film smaller it costs nothing at all in quality: the
 * kept streams are copied byte for byte and the video is never touched.
 *
 * So the table is not only a listing. Each row can be ticked, the total says
 * what ticking it would free before anything runs, and the original is kept
 * beside the film afterwards — the same bargain the Dolby Vision console
 * offers, because it is the same kind of decision: irreversible in principle,
 * made reversible by keeping a copy until you say otherwise.
 */

/** Same two-tier form the library list and the title block use. */
const size = (bytes: number) =>
  bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(2)} TB`
    : `${(bytes / 1e9).toFixed(1)} GB`;

export function AudioTracks({
  moviePath,
  fileName,
  summary,
  tracks,
  sizeBytes,
  backupBytes,
  present = true,
  preference,
  originalLanguage,
}: {
  moviePath: string;
  fileName: string;
  /** Written by the page, so the shut row and the spec grid cannot disagree. */
  summary: string;
  tracks: AudioTrack[];
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
  /** What TMDb says this film was made in, where it has been matched. */
  originalLanguage?: string;
}) {
  const { jobs, apply, subscribe } = useJobs();
  const { strip: job } = jobs;
  const router = useRouter();

  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
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

  // Worked out before anything runs, and worded by which of its three answers
  // came back: an exact total, an approximation, or a floor.
  const {
    bytes: freed,
    estimated: anyEstimated,
    incomplete: anyUnsized,
  } = savingsOf(tracks, selected);

  const matroska = canStripAudio(fileName);
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

  /** True of a track kept only because it is the film's own language. */
  const isOriginal = (track: AudioTrack) =>
    Boolean(
      preference.original &&
      originalLanguage &&
      track.language &&
      languageKey(track.language) === languageKey(originalLanguage),
    );

  /** The preferred tracks about to be removed — the reason for the warning. */
  const preferredChosen = chosen.filter(preferred);

  /**
   * The last row ticked by hand, which is what a shift-click measures from.
   *
   * A ref rather than state: nothing on the page is drawn from it, and moving
   * it should never be a reason to re-render the table.
   */
  const anchor = useRef<number | null>(null);

  /** Ticking a row, or — with shift held — the run up to the last one ticked. */
  function tick(ordinal: number, range: boolean) {
    const from = anchor.current;
    anchor.current = ordinal;
    setSelected((current) =>
      tickRange(current, ordinal, from, range, tracks.length),
    );
  }

  async function runStrip() {
    setError(null);
    setConfirming(false);

    const ordinals = [...selected].sort((a, b) => a - b);
    const result = await beginStripAudio(
      moviePath,
      ordinals,
      tracks.length,
      // The Matroska numbers as this page has them, for the server to check
      // against what mkvmerge reports before it rewrites anything. Sent by
      // ordinal so the two lists line up on the far side.
      tracks.map((track) => track.number),
      freed || undefined,
    );
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

  /**
   * The one line at the top. Whatever is happening to the file outranks
   * anything about the selection — mid-removal, and afterwards while the
   * original is still recoverable, the state of the file *is* the answer.
   */
  const banner: { headline: string; body?: React.ReactNode } = running
    ? {
        headline: `Removing ${job.removed ?? selected.size} audio track${
          (job.removed ?? selected.size) === 1 ? "" : "s"
        }…`,
        body: "Cancelling never touches the original.",
      }
    : hasBackup
      ? {
          headline: "Audio tracks removed",
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
        : tracks.length < 2
          ? {
              headline:
                tracks.length === 1
                  ? "One audio track"
                  : "No audio tracks at all",
              body:
                tracks.length === 1
                  ? "Nothing to remove without leaving the film silent."
                  : undefined,
            }
          : selected.size === 0
            ? {
                headline: `${tracks.length} audio tracks, ${size(
                  tracks.reduce((sum, t) => sum + (t.sizeBytes ?? 0), 0),
                )} of this file`,
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
                    {selected.size} of {tracks.length} track
                    {tracks.length === 1 ? "" : "s"} removed, leaving{" "}
                    {size(Math.max(0, sizeBytes - freed))} of {size(sizeBytes)}.
                  </>
                ),
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
    matroska &&
    tracks.length > 1 && (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={!selectable || selected.size === 0 || wouldSilence}
        title={
          offline ??
          (wouldSilence
            ? "That would leave the film with no audio at all."
            : "Remuxes the file without them. The original is kept beside it.")
        }
        className={BUTTON.primary}
      >
        {selected.size > 0
          ? `Remove ${selected.size} track${selected.size === 1 ? "" : "s"}`
          : "Remove tracks"}
      </button>
    )
  );

  return (
    <Panel title="Audio tracks" summary={summary}>
      <div className="flex flex-col gap-6">
        {/* One console, in bands parted by the same hairline the Dolby Vision
            card parts its own by: what the selection would cost, and — under
            the rule — the button that acts on it.

            The buttons sat on the same line as the reading until they were
            asked to stand apart, and the hairline is the whole of what that
            takes: `.card-band + .card-band` draws it, so a band that is only
            ever added or dropped brings its own rule with it. Skipped entirely
            when there is nothing to press, which is a real state here — a file
            that is not Matroska, or has a single track, is a card that reads
            and offers nothing — and an empty band under a rule would announce
            a decision that was never on the table. */}
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
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
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
            <thead className="text-xs uppercase tracking-wide opacity-50">
              <tr>
                {/* Unlabelled: a header over a column of checkboxes has to be
                    a word like "Remove", and that word then sits over every
                    row as an instruction rather than a description. */}
                <th className="w-8 px-4 py-2" />
                <th className="px-4 py-2 font-medium">Format</th>
                <th className="px-4 py-2 font-medium">Channels</th>
                <th className="px-4 py-2 font-medium">Language</th>
                <th className="px-4 py-2 font-medium">Track</th>
                <th className="px-4 py-2 text-right font-medium">Bitrate</th>
                <th className="px-4 py-2 text-right font-medium">Size</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((track, ordinal) => {
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
                        {preferred(track) && (
                          <span
                            title={
                              isOriginal(track)
                                ? "The language this film was made in, which you keep"
                                : "One of the languages you keep — set in Settings"
                            }
                            className="rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap opacity-60 ring-1 ring-line-strong ring-inset"
                          >
                            {isOriginal(track) ? "ORIGINAL" : "KEPT"}
                          </span>
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

        {stripMounted && (
          <ConfirmModal
            open={confirming}
            title={
              preferredChosen.length > 0
                ? `Remove ${preferredChosen.length} track${
                    preferredChosen.length === 1 ? "" : "s"
                  } in a language you keep?`
                : `Remove ${selected.size} audio track${
                    selected.size === 1 ? "" : "s"
                  }?`
            }
            // The dialog turns red on the one case worth stopping at. Every
            // removal here is reversible while the original is beside the film,
            // so the tone is about the selection being a mistake rather than
            // about the operation being dangerous.
            tone={preferredChosen.length > 0 ? "danger" : "neutral"}
            confirmLabel={
              preferredChosen.length > 0 ? "Remove them anyway" : "Remove"
            }
            onConfirm={runStrip}
            onCancel={() => setConfirming(false)}
          >
            {/* Named before the list rather than inside it: this is the one
                thing in the dialog that might change your mind, and a bullet
                among four bullets is not a warning. */}
            {preferredChosen.length > 0 && (
              <p className="mb-3 rounded-control border border-red-500/40 bg-red-500/[0.08] px-3 py-2 text-red-700 dark:text-red-300">
                {preferredChosen
                  .map((track) =>
                    track.language ? languageName(track.language) : track.label,
                  )
                  .join(", ")}{" "}
                {preferredChosen.length === 1 ? "is" : "are"} among the
                languages you keep
                {preferredChosen.some(isOriginal) &&
                  ` — and ${
                    preferredChosen.length === 1 ? "it is" : "one of them is"
                  } the language this film was made in`}
                . Settings is where that list is set; this removes{" "}
                {preferredChosen.length === 1 ? "it" : "them"} from this film
                only.
              </p>
            )}

            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                Going:{" "}
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
                Nothing is re-encoded. Video, subtitles, chapters and the tracks
                you keep are copied exactly as they are.
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
            title="Put every audio track back?"
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
