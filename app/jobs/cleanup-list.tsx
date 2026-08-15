"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { discardCleanup } from "@/app/actions";
import { EmptyState } from "@/app/empty-state";
import type { Layout } from "@/app/listing";
import { useClosing } from "@/app/modal";
import { PosterTile, TILE_GRID_RULED, TILE_NOTE } from "@/app/poster-tile";
import { rememberListing } from "@/app/return-to";
import { SCORE_PLATE_ROOMY } from "@/app/score-circle";
import { stagger } from "@/app/stagger";
import { Tick, TickColumn } from "@/app/tick";
import { TILE_MARK } from "@/app/tile-button";
import { BUTTON, CONTROL_H } from "@/app/controls";
import { ConfirmModal } from "@/app/confirm";
import type { CleanupFile, CleanupKind } from "@/lib/queue-tasks";
import { movieId } from "@/lib/routes";
import { tickRows } from "@/lib/selection";
import {
  Grouped,
  orderedBy,
  pickGroup,
  type GroupOption,
} from "@/app/grouping";
import { Stat } from "@/app/charts";
import { Poster } from "./poster";
import { Stats } from "./stats";
import { byTitle, pickSort, type SortOption } from "@/app/sorts";

/**
 * What is lying beside the films, and the one thing to do about it.
 *
 * The only list here whose rows are the files themselves rather than the films
 * they belong to — which is the point of it. Every rewrite in this app keeps
 * the original beside the film so it can be undone, and that promise is kept
 * by leaving tens of gigabytes on the drive indefinitely. Until now the only
 * way to find one was to open the film it belongs to and read its console, so
 * the ones you would never have gone back to are exactly the ones you never
 * saw.
 *
 * Two kinds, deliberately not equal. An original is an undo that has not
 * expired: deleting it is the one irreversible thing in the app, so it asks,
 * every time, one at a time. A leftover is the wreckage of a job that was
 * killed — nothing points at it and nothing can be recovered from it — so those
 * can go in one action.
 */

/**
 * Down to kilobytes, unlike the other lists.
 *
 * Everywhere else in the app a size is a film and GB is the only unit worth
 * printing. Here a row can be a mux that died in its first second, and a file
 * of a few kilobytes rounded up to "1 MB" is a row overstating what deleting
 * it gets you.
 */
const size = (bytes: number) =>
  bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(2)} TB`
    : bytes >= 1e9
      ? `${(bytes / 1e9).toFixed(1)} GB`
      : bytes >= 1e6
        ? `${Math.round(bytes / 1e6)} MB`
        : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

/** How long it has been sitting there — the whole case against keeping it. */
function since(then: number): string {
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months < 24
    ? `${months} months ago`
    : `${Math.round(months / 12)} years ago`;
}

const KIND_LABEL: Record<CleanupKind, string> = {
  "dovi-backup": "Profile 7 original",
  "audio-backup": "Original audio",
  leftover: "Leftover",
};

/** Fixed order for the "what it is" sort: the undos, then the wreckage. */
const KIND_ORDER: CleanupKind[] = ["dovi-backup", "audio-backup", "leftover"];

const nameOf = (file: CleanupFile) => file.film?.title ?? file.name;

export const CLEANUP_SORTS: SortOption<CleanupFile>[] = [
  { key: "size", label: "Largest first", compare: (a, b) => b.bytes - a.bytes },
  {
    // An original you have not gone back to in a year is one you were never
    // going to go back to, which is the only argument this page can make.
    key: "oldest",
    label: "Oldest first",
    compare: (a, b) => a.modifiedAt - b.modifiedAt,
  },
  {
    key: "newest",
    label: "Newest first",
    compare: (a, b) => b.modifiedAt - a.modifiedAt,
  },
  {
    key: "kind",
    label: "What it is",
    compare: (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      b.bytes - a.bytes,
  },
  {
    key: "title",
    label: "Title",
    compare: (a, b) => byTitle(nameOf(a), nameOf(b)),
  },
];

/**
 * The cut this list is really two lists along: an undo somebody may still want
 * and the wreckage of a job that died are the same row and opposite decisions,
 * and grouping is the only thing that puts each with its own kind.
 */
export const CLEANUP_GROUPS: GroupOption<CleanupFile>[] = [
  { key: "none", label: "No grouping", of: () => "" },
  {
    key: "kind",
    label: "What it is",
    of: (file) => KIND_LABEL[file.kind],
    order: KIND_ORDER.map((kind) => KIND_LABEL[kind]),
  },
  { key: "title", label: "Show or film", of: nameOf },
];

/** What deleting one of these actually costs, said plainly in the dialog. */
const CONSEQUENCE: Record<CleanupKind, string> = {
  "dovi-backup":
    "This is the Profile 7 file the conversion set aside. Delete it and the converted film is all there is — the original exists only on the disc it was ripped from, and the conversion cannot be undone.",
  "audio-backup":
    "This is the file that still holds the removed audio tracks. Delete it and those tracks exist only on the disc the film was ripped from, and the removal cannot be undone.",
  leftover:
    "The half-built output of a job that was cancelled or killed. Nothing points at it and nothing can be recovered from it.",
};

/**
 * The one call every delete on this page makes, and the repaint after it.
 *
 * Three places ask now — a row, the leftover sweep, and the button in the
 * page's header — and they sit in three different parts of the tree, so each
 * keeps its own question. What they share is this: the call, whether it is in
 * flight, and what it said if it failed.
 */
function useDiscard() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(targets: CleanupFile[]): Promise<boolean> {
    setError(null);
    setBusy(true);
    const result = await discardCleanup(targets.map((file) => file.path));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    // The action revalidates; this is what repaints the list it came from.
    router.refresh();
    return true;
  }

  return { busy, error, run };
}

/** Everything on the tab that this page is actually allowed to delete. */
const deletableIn = (files: CleanupFile[]) =>
  files.filter((file) => !file.offline);

/**
 * Empty the whole tab, from the page's own header.
 *
 * Up there rather than over the list because it is the page's action and not
 * the list's, and primary because on a tab whose every row is a file waiting to
 * be deleted it is what the tab is for. No red on it: this app puts that in the
 * dialog, and the dialog is where what it costs gets said.
 *
 * Stays on the page when there is nothing it may take, off and saying why,
 * exactly as each row's own Delete does — rows that all refuse with a reason,
 * under a header with no button at all, would read as a page with no bulk
 * action rather than one whose drive is unplugged.
 */
export function CleanAll({ files }: { files: CleanupFile[] }) {
  const [asking, setAsking] = useState(false);
  const shown = useClosing(asking);
  const { busy, error, run } = useDiscard();

  const deletable = deletableIn(files);
  const bytes = deletable.reduce((sum, file) => sum + file.bytes, 0);
  const originals = deletable.filter((file) => file.kind !== "leftover").length;

  if (files.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={busy || deletable.length === 0}
        title={
          deletable.length === 0
            ? "Every row here is on a drive that is not connected"
            : undefined
        }
        // The bar's height rather than the button's own. `BUTTON.primary` sizes
        // itself from its padding, which is right in a row of buttons and wrong
        // on this line: the tabs and the sort-and-cut bar are both a stated
        // `CONTROL_H`, and a third control coming to eight pixels less reads as
        // something that wandered in. The padding stays and simply sits inside
        // the taller box. Same swap the upgrades page makes for its rescan
        // button, which fills this slot on that page.
        className={`${BUTTON.primary} ${CONTROL_H}`}
      >
        Clean all
      </button>

      {shown && (
        <ConfirmModal
          open={asking}
          title={`Delete all ${deletable.length} files?`}
          confirmLabel={`Delete ${size(bytes)}`}
          tone="danger"
          busy={busy}
          onConfirm={async () => {
            if (await run(deletable)) setAsking(false);
          }}
          onCancel={() => setAsking(false)}
        >
          {/* The one dialog here that has to argue against itself: the button
              behind it says two words, and the originals it would take are the
              only irreversible thing in the app. So the count of those leads,
              ahead of the figure anybody pressed it for. */}
          {originals > 0 && (
            <>
              {originals === 1
                ? "One of these is an original"
                : `${originals} of these are originals`}{" "}
              kept beside a film so its rewrite could be undone. Deleting them
              ends that: what they hold exists only on the discs the films were
              ripped from, and no conversion or track removal among them can be
              walked back.{" "}
            </>
          )}
          {size(bytes)} comes back.
          {files.length > deletable.length &&
            " The rows whose drive is not connected are left where they are."}
          {/* A failure holds the dialog open. The button that raised it is up
              in the header, and a message printed down the page beside a list
              that did not change would be nowhere near what was asked. */}
          {error && (
            <span className="mt-3 block font-mono text-sm text-red-600 dark:text-red-400">
              {error}
            </span>
          )}
        </ConfirmModal>
      )}
    </>
  );
}

/** The rows in the order this list draws them — see `audioOrder`, its twin. */
export const cleanupOrder = (
  files: CleanupFile[],
  sort?: string,
  group?: string,
): CleanupFile[] =>
  orderedBy(
    [...files].sort(pickSort(CLEANUP_SORTS, sort).compare),
    pickGroup(CLEANUP_GROUPS, group),
  );

/**
 * Delete every row that has been ticked, beside the figures for them.
 *
 * The one bulk delete on this page that is neither "all of it" nor "one of
 * them", and the only one that can take originals in a single answer. So the
 * dialog leads with how many of those are in the set, ahead of the figure
 * anybody pressed the button for: the leftovers are wreckage and the originals
 * are undos somebody is still holding, and the two arrive here wearing the same
 * row.
 *
 * One call rather than one per file — `discardCleanup` already takes a list,
 * which is what the header's Clean all hands it. Nothing here is a job: a
 * delete is an unlink, and a hundred of them are over before the page repaints.
 */
export function CleanupRun({
  files,
  all,
  onChoose,
  onDone,
}: {
  /** The rows ticked, in the order the list draws them. */
  files: CleanupFile[];
  /** Everything that could be ticked, for the button that ticks the lot. */
  all: CleanupFile[];
  onChoose: (next: ReadonlySet<string>) => void;
  onDone: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const shown = useClosing(asking);
  const { busy, error, run } = useDiscard();

  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const originals = files.filter((file) => file.kind !== "leftover").length;

  return (
    <div className="flex flex-col items-end gap-2">
      {/* All three stand for as long as the mode does, greyed where they would
          do nothing — a control that moves while you are reaching for it is
          worse than one that is plainly unavailable. */}
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onChoose(new Set(all.map((file) => file.path)))}
          disabled={busy || all.length === 0 || files.length === all.length}
          title={
            all.length === 0
              ? "Every row here is on a drive that is not connected"
              : "Tick every row on the list"
          }
          className={BUTTON.secondary}
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => onChoose(new Set())}
          disabled={busy || files.length === 0}
          className={BUTTON.secondary}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => setAsking(true)}
          disabled={busy || files.length === 0}
          className={BUTTON.danger}
        >
          Delete
        </button>
      </div>

      {error && !asking && (
        <p className="max-w-sm text-right text-xs wrap-anywhere text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {shown && (
        <ConfirmModal
          open={asking}
          title={`Delete ${files.length} ${
            files.length === 1 ? "file" : "files"
          }?`}
          confirmLabel={`Delete ${size(bytes)}`}
          tone="danger"
          busy={busy}
          onConfirm={async () => {
            if (await run(files)) {
              setAsking(false);
              onDone();
            }
          }}
          onCancel={() => setAsking(false)}
        >
          {originals > 0 && (
            <>
              {originals === 1
                ? "One of these is an original"
                : `${originals} of these are originals`}{" "}
              kept beside a film so its rewrite could be undone. Deleting them
              ends that: what they hold exists only on the discs the films were
              ripped from, and no conversion or track removal among them can be
              walked back.{" "}
            </>
          )}
          {size(bytes)} comes back.
          {/* A failure holds the dialog open. The button that raised it is up
              in the band of figures, and a message printed down the page
              beside a list that did not change would be nowhere near what was
              asked. */}
          {error && (
            <span className="mt-3 block font-mono text-sm text-red-600 dark:text-red-400">
              {error}
            </span>
          )}
        </ConfirmModal>
      )}
    </div>
  );
}

/**
 * What the cleanup tab adds up to, drawn above the pending list rather than
 * inside it.
 *
 * Split out of the list for where it has to sit: the figures describe the whole
 * tab, and reading them under the heading of one of its sections said they
 * belonged to that section. The leftover sweep travels with them, because that
 * button is a caption on the Leftovers figure more than it is a control of the
 * list — and because the originals are now the header's to offer.
 */
export function CleanupStats({
  files,
  action,
}: {
  files: CleanupFile[];
  /**
   * What to do with them, while a selection is being made — see `CleanupRun`.
   *
   * It replaces the leftover sweep rather than standing beside it: the sweep is
   * one fixed set of rows chosen for you, and a button offering that next to a
   * button acting on what you have just ticked is two answers to one question.
   */
  action?: React.ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const shown = useClosing(asking);
  const { busy, error, run } = useDiscard();

  const leftovers = files.filter((file) => file.kind === "leftover");
  // A remembered file is on a drive that is not plugged in: it is real, it is
  // counted in the total, and it cannot be deleted from here.
  const sweepable = leftovers.filter((file) => !file.offline);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  const sweptBytes = sweepable.reduce((sum, file) => sum + file.bytes, 0);

  // Zero chosen is a reading rather than an absence, the way it is on the other
  // two bands: it is what pressing Delete right now would come to.
  if (files.length === 0 && !action) return null;

  return (
    <>
      <Stats
        action={
          action ??
          // Only the wreckage goes in one click from here. An original is an
          // undo somebody is still holding, and the header's button is the one
          // that asks about those.
          (sweepable.length > 1 ? (
            <button
              type="button"
              onClick={() => setAsking(true)}
              disabled={busy}
              className={BUTTON.danger}
            >
              Delete {sweepable.length} leftovers
            </button>
          ) : undefined)
        }
      >
        <Stat label="To reclaim" gain value={size(total)} />
        <Stat label="Files" value={files.length.toLocaleString("en-GB")} />
        <Stat
          label="Originals"
          value={(files.length - leftovers.length).toLocaleString("en-GB")}
          title="Kept beside a film so its rewrite can be undone"
        />
        {leftovers.length > 0 && (
          <Stat
            label="Leftovers"
            value={leftovers.length.toLocaleString("en-GB")}
            title="Half-built output of jobs that were cancelled or killed"
          />
        )}
      </Stats>

      {shown && (
        <ConfirmModal
          open={asking}
          title={`Delete ${sweepable.length} leftovers?`}
          confirmLabel={`Delete ${size(sweptBytes)}`}
          tone="danger"
          busy={busy}
          onConfirm={async () => {
            if (await run(sweepable)) setAsking(false);
          }}
          onCancel={() => setAsking(false)}
        >
          Every one of these is the half-built output of a job that was
          cancelled or killed. Nothing points at them, no film depends on them,
          and {size(sweptBytes)} comes back.
          {error && (
            <span className="mt-3 block font-mono text-sm text-red-600 dark:text-red-400">
              {error}
            </span>
          )}
        </ConfirmModal>
      )}
    </>
  );
}

/**
 * What a row of this list is, as a chip: the undos in the app's plain outline,
 * the wreckage in red.
 *
 * The one fact here that is not a measurement, and the one this list is really
 * two lists along — so it is the same chip whether it is read in a row or worn
 * on a poster, and only the plate under it differs.
 */
/**
 * The one mark that ends a file.
 *
 * A bin, and deliberately not the cross. The cross over artwork in this app
 * means "take this out of the list I am looking at" — the wishlist's, the
 * collections' — and it is undone by pressing the heart again. Nothing here is
 * undone: the file is gone off the drive, and with it the only copy of what a
 * rewrite replaced. The same shape for both would be the one economy this app
 * cannot make. So this drawing appears nowhere else, and the dialog behind it
 * still spells out what will be gone before anything is.
 *
 * Three strokes and no more. The body tapers to a rounded base — drawn with
 * square corners it reads as a cup at twenty pixels — and the two slats a bin
 * usually carries are left off: inside a body this size they close up into a
 * smudge, which is worse than a bin with nothing in it.
 */
function BinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-5 w-5"
    >
      <path d="M5 7h14" />
      <path d="M9.5 7V4.8h5V7" />
      <path d="M6.9 7l.8 11.5a1.7 1.7 0 0 0 1.7 1.6h5.2a1.7 1.7 0 0 0 1.7-1.6L17.1 7" />
    </svg>
  );
}

function KindChip({ file, art = false }: { file: CleanupFile; art?: boolean }) {
  const leftover = file.kind === "leftover";

  return art ? (
    <span
      className={`${TILE_NOTE} ${
        leftover ? "text-red-700 dark:text-red-300" : ""
      }`}
    >
      {KIND_LABEL[file.kind]}
    </span>
  ) : (
    <span
      className={`rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap ring-1 ring-inset ${
        leftover
          ? "text-red-700 ring-red-500/30 dark:text-red-300"
          : "opacity-70 ring-line-strong"
      }`}
    >
      {KIND_LABEL[file.kind]}
    </span>
  );
}

/**
 * One file as a poster — of the film it was set aside from, which is the only
 * picture a file has.
 *
 * The rows here are files, and this is the list where that matters most: an
 * original whose film has since been renamed is a file with no film at all, and
 * it still has to hold its place in the grid. `PosterTile` draws the empty frame
 * for those, as the row's poster block did before it.
 */
function CleanupTile({
  file,
  index,
  selecting,
  chosen,
  onPick,
  action,
}: {
  file: CleanupFile;
  index: number;
  selecting: boolean;
  chosen: boolean;
  onPick: (range: boolean) => void;
  action: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <PosterTile
      poster={
        file.film && {
          src: file.film.poster,
          remote: file.film.posterRemote,
          version: file.film.artAt,
        }
      }
      // No `transitionName`, alone among the grids that draw a poster here: one
      // film can hold two tiles on this tab — the Profile 7 original and the
      // audio one, both beside the same film — and a transition name is a
      // promise that only one thing on the page is wearing it. Two claiming it
      // abort the transition outright.
      /*
       * The film's name where the library still knows it, and the file's own
       * where it does not. A cleanup list outlives what it describes.
       *
       * Composed the way the other two tabs compose theirs — the episode's
       * number in front of the show, no year, no file name underneath. The
       * name was here twice over on a film the library still holds: once as
       * the caption and once cut at the front in mono below it. Which of two
       * files beside one film this is, is said by the chip on the artwork,
       * which is the fact that actually decides the delete.
       */
      title={
        file.film?.episodeCode
          ? `${file.film.episodeCode} · ${file.film.title}`
          : (file.film?.title ?? file.name)
      }
      /*
       * What it is and how long it has been there, in the caption's own muted
       * line — which is where the other two tabs put what a file *is*.
       *
       * The kind was a chip on the artwork, and it is the first thing you need
       * about one of these rows: an original is an undo somebody may still
       * want, a leftover is wreckage. It reads as prose down here and as a
       * label pinned to a picture up there.
       *
       * "kept since" and "left" went with it. The date is the whole of the
       * argument this tab makes — a year-old original is one you were never
       * going back to — and the words in front of it only restated the kind
       * that now leads the line.
       */
      facts={[
        KIND_LABEL[file.kind],
        since(file.modifiedAt),
        !file.film && "no film in the library",
      ]}
      mark={
        <Tick
          art
          checked={chosen}
          disabled={file.offline}
          refusal={
            file.offline
              ? "The drive this file lives on is not connected"
              : undefined
          }
          hint="Shift-click to tick a run of rows"
          onTick={onPick}
          label={`Delete ${file.name}`}
          pad="p-1"
        />
      }
      // What deleting this one gets you, in the corner every tile keeps for its
      // reading. It is the whole argument for the tab.
      //
      // On the score plate, like the freed figure on the tab next door: the two
      // are the same fact about the same kind of decision — how many gigabytes
      // this press is worth — and they were set in two different faces.
      badge={<span className={SCORE_PLATE_ROOMY}>{size(file.bytes)}</span>}
      /*
       * The delete, on the artwork.
       *
       * It was a word under the caption, and the argument for that was a good
       * one: this is the only irreversible thing in the app, and a cross in the
       * corner of a poster is the gesture that takes a film off a wishlist —
       * one shape for "I have changed my mind" and "the original is gone
       * forever". So it is not that shape. A bin is what it is, drawn nowhere
       * else in the app, and the dialog behind it still says in words exactly
       * what will be gone before anything is.
       *
       * Nothing else is worn over the picture now. The chip saying what the
       * file is has gone to the caption, and the one saying the drive is away
       * with it — the mark refuses with that reason in its own tooltip, and the
       * tick beside it does too, which is where the answer is actually needed.
       */
      actions={action}
      label={file.film?.title ?? file.name}
      index={index}
      selecting={selecting}
      chosen={chosen}
      onOpen={
        selecting
          ? onPick
          : file.film
            ? () => {
                // The crumb the rows leave by way of their title link, left by
                // hand here for the reason every tile in this app leaves it: the
                // delegated listener in return-to.tsx only sees anchors.
                rememberListing();
                router.push(
                  `/${file.film!.kind === "movie" ? "film" : "episode"}/${movieId(
                    file.film!.path,
                  )}`,
                );
              }
            : // Nothing to open: the film was renamed after the rewrite, or it
              // is gone. The file is still real, and the button still deletes it.
              undefined
      }
    />
  );
}

export function CleanupList({
  files: unsorted,
  sort,
  group,
  layout,
  selecting = false,
  chosen,
  onChoose,
}: {
  files: CleanupFile[];
  sort?: string;
  group?: string;
  /** Posters or rows — the fourth thing the listing bar asks. */
  layout: Layout;
  /** Whether the header's Select button is on — see `SelectFilms`. */
  selecting?: boolean;
  /** The rows ticked, by path, and the way to change them. */
  chosen: ReadonlySet<string>;
  onChoose: (next: ReadonlySet<string>) => void;
}) {
  const files = [...unsorted].sort(pickSort(CLEANUP_SORTS, sort).compare);
  const grouping = pickGroup(CLEANUP_GROUPS, group);
  // The rows in the order the page draws them, which is what a shift-held
  // click runs along.
  const order = orderedBy(files, grouping);
  const keys = order.map((file) => file.path);
  /** The last row ticked by hand, which is what a shift-click measures from. */
  const anchor = useRef<number | null>(null);

  /** The row being asked about. The bulk answers are asked elsewhere now. */
  const [asking, setAsking] = useState<CleanupFile | null>(null);
  const shown = useClosing(asking !== null);
  const { busy, error, run } = useDiscard();

  const ticked = (file: CleanupFile) => selecting && chosen.has(file.path);

  function pick(index: number, range: boolean) {
    const from = anchor.current;
    anchor.current = index;

    const next = tickRows(chosen, keys, index, from, range);
    // A run dragged across a row whose drive is away must not take it: the box
    // on that row refuses by hand, and a shift-click is the same decision made
    // faster.
    for (const file of order) if (file.offline) next.delete(file.path);
    onChoose(next);
  }

  /**
   * The one thing every row and every tile here offers.
   *
   * Always there, where it used to arrive on hover. Hiding an action until the
   * pointer finds it is right for one that is incidental — this is the list's
   * whole point. Every line in it is a file whose only remaining question is
   * whether to delete it, and a page of them with no visible way to do that
   * reads as a list you cannot act on at all. It also put the count at the top
   * ("Delete 6 leftovers") in front of six rows that appeared to offer nothing.
   *
   * The word is the row's. On a tile it is a bin over the artwork — see
   * `BinIcon` for why it is a bin and not the cross every other mark on a
   * poster in this app is.
   *
   * A factory rather than a component: it closes over the dialog and the
   * in-flight state, and a component declared inside a render is a component
   * that remounts on every keystroke.
   */
  const deleteButton = (file: CleanupFile, art: boolean) => (
    <button
      type="button"
      onClick={(e) => {
        // The row ticks; this does not.
        e.stopPropagation();
        setAsking(file);
      }}
      disabled={busy || file.offline}
      aria-label={art ? `Delete ${file.name}` : undefined}
      title={
        file.offline
          ? "The drive this file lives on is not connected"
          : art
            ? "Delete this file"
            : undefined
      }
      className={
        art
          ? `${TILE_MARK} hover:text-red-400 disabled:opacity-40`
          : BUTTON.danger
      }
    >
      {art ? <BinIcon /> : "Delete"}
    </button>
  );

  if (files.length === 0) {
    return (
      <EmptyState
        icon={
          <>
            <path d="M4 7h16" />
            <path d="M9 7V5h6v2" />
            <path d="M6 7l1 12h10l1-12" />
          </>
        }
        title="Nothing left lying around"
      >
        No originals from a conversion or a track removal, and nothing half
        written by a job that stopped early. Every rewrite you undo or accept
        takes its own copy off the drive.
      </EmptyState>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      {error && (
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <Grouped
        items={files}
        group={grouping}
        note={(bucket) =>
          `${bucket.length} · ${size(bucket.reduce((n, f) => n + f.bytes, 0))}`
        }
      >
        {(rows, offset) =>
          layout === "grid" ? (
            <div className={TILE_GRID_RULED}>
              {rows.map((file, index) => (
                <CleanupTile
                  key={file.path}
                  file={file}
                  index={offset + index}
                  selecting={selecting}
                  chosen={ticked(file)}
                  onPick={(range) => pick(offset + index, range)}
                  action={deleteButton(file, true)}
                />
              ))}
            </div>
          ) : (
            <ul className="ruled flex flex-col">
              {rows.map((file, index) => (
                <li
                  key={file.path}
                  style={stagger(offset + index)}
                  // In the choosing mode the row is the box, as on the work
                  // lists. The default is prevented rather than only stopped:
                  // the title on this row is a link to the film, and a click
                  // that ticked the row and then navigated away from it would
                  // tick nothing anybody saw.
                  {...(selecting && {
                    role: "button",
                    tabIndex: 0,
                    onClick: (e: React.MouseEvent) => {
                      e.preventDefault();
                      pick(offset + index, e.shiftKey);
                    },
                    onMouseDown: (e: React.MouseEvent) => {
                      if (e.shiftKey) e.preventDefault();
                    },
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        pick(offset + index, e.shiftKey);
                      }
                    },
                  })}
                  // A ticked row is not drawn any differently — the box in its
                  // corner is the whole of the mark. See the work rows, which
                  // tried a fill and an outline before settling on neither.
                  className={`row-enter -mx-4 flex items-center gap-5 rounded-card px-4 py-3.5 transition-colors hover:bg-surface ${
                    selecting ? "cursor-pointer" : ""
                  }`}
                >
                  <TickColumn open={selecting}>
                    <Tick
                      checked={ticked(file)}
                      disabled={file.offline}
                      refusal={
                        file.offline
                          ? "The drive this file lives on is not connected"
                          : undefined
                      }
                      hint="Shift-click to tick a run of rows"
                      onTick={(range) => pick(offset + index, range)}
                      label={`Delete ${file.name}`}
                      pad="p-1"
                    />
                  </TickColumn>

                  {/* The rows here are files, but a file is recognised by the
                      film it was set aside from — and the same poster on the
                      same left edge is what says which. Absent on the rows
                      whose film has been renamed or removed, where the block
                      stands in and keeps the edge straight.

                      Unnamed, alone among the lists that draw this: one film
                      can hold two rows here — the Profile 7 original and the
                      audio one, both beside the same film — and a transition
                      name is a promise that only one thing on the page is
                      wearing it. */}
                  <Poster film={file.film} transition={false} />

                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-baseline gap-2">
                      {file.film ? (
                        <Link
                          href={`/${
                            file.film.kind === "movie" ? "film" : "episode"
                          }/${movieId(file.film.path)}`}
                          className="min-w-0 truncate text-base font-medium hover:underline hover:underline-offset-4"
                        >
                          {file.film.title}
                        </Link>
                      ) : (
                        // No film to open: either it was renamed after the
                        // rewrite or it is gone. The file is still real, and
                        // still deletable.
                        <span className="min-w-0 truncate text-base font-medium opacity-70">
                          {file.name}
                        </span>
                      )}
                      {file.film?.year && (
                        <span className="shrink-0 text-sm opacity-40">
                          {file.film.year}
                        </span>
                      )}
                      {file.film?.episode && (
                        <span className="min-w-0 truncate text-sm opacity-40">
                          {file.film.episode}
                        </span>
                      )}
                    </p>

                    <p className="mt-1.5 truncate font-mono text-xs opacity-55">
                      {file.name}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <KindChip file={file} />
                      {/* Where the row came from, when it did not come from a
                          folder that opened. The size is still worth counting —
                          the file is on the drive taking up room — but nothing
                          has seen it today, so nothing may be promised about
                          deleting it. */}
                      {file.offline && (
                        <span
                          className="rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap opacity-70 ring-1 ring-line-strong ring-inset"
                          title="Found the last time this folder could be read. The drive is not connected now."
                        >
                          Drive away
                        </span>
                      )}
                      <span className="text-xs opacity-40">
                        {file.kind === "leftover"
                          ? `left ${since(file.modifiedAt)}`
                          : `kept since ${since(file.modifiedAt)}`}
                        {!file.film && " · no film in the library"}
                      </span>
                    </div>
                  </div>

                  <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">
                    {size(file.bytes)}
                  </span>

                  {deleteButton(file, false)}
                </li>
              ))}
            </ul>
          )
        }
      </Grouped>

      {shown && asking !== null && (
        <ConfirmModal
          open={asking !== null}
          title={
            asking.kind === "leftover"
              ? "Delete this leftover?"
              : "Delete this original?"
          }
          confirmLabel={`Delete ${size(asking.bytes)}`}
          tone="danger"
          busy={busy}
          onConfirm={async () => {
            if (await run([asking])) setAsking(null);
          }}
          onCancel={() => setAsking(null)}
        >
          {CONSEQUENCE[asking.kind]}{" "}
          <span className="font-mono">{asking.name}</span>
        </ConfirmModal>
      )}
    </section>
  );
}
