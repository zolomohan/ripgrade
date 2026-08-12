"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { discardCleanup } from "@/app/actions";
import { EmptyState } from "@/app/empty-state";
import { useClosing } from "@/app/modal";
import { stagger } from "@/app/stagger";
import { BUTTON, CONTROL_H } from "@/app/controls";
import { ConfirmModal } from "@/app/confirm";
import type { CleanupFile, CleanupKind } from "@/lib/queue-tasks";
import { movieId } from "@/lib/routes";
import { Grouped, pickGroup, type GroupOption } from "@/app/grouping";
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
  return months < 24 ? `${months} months ago` : `${Math.round(months / 12)} years ago`;
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
  { key: "newest", label: "Newest first", compare: (a, b) => b.modifiedAt - a.modifiedAt },
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
export function CleanupStats({ files }: { files: CleanupFile[] }) {
  const [asking, setAsking] = useState(false);
  const shown = useClosing(asking);
  const { busy, error, run } = useDiscard();

  const leftovers = files.filter((file) => file.kind === "leftover");
  // A remembered file is on a drive that is not plugged in: it is real, it is
  // counted in the total, and it cannot be deleted from here.
  const sweepable = leftovers.filter((file) => !file.offline);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  const sweptBytes = sweepable.reduce((sum, file) => sum + file.bytes, 0);

  if (files.length === 0) return null;

  return (
    <>
      <Stats
        action={
          // Only the wreckage goes in one click from here. An original is an
          // undo somebody is still holding, and the header's button is the one
          // that asks about those.
          sweepable.length > 1 ? (
            <button
              type="button"
              onClick={() => setAsking(true)}
              disabled={busy}
              className={BUTTON.danger}
            >
              Delete {sweepable.length} leftovers
            </button>
          ) : undefined
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

export function CleanupList({
  files: unsorted,
  sort,
  group,
}: {
  files: CleanupFile[];
  sort?: string;
  group?: string;
}) {
  const files = [...unsorted].sort(pickSort(CLEANUP_SORTS, sort).compare);
  const grouping = pickGroup(CLEANUP_GROUPS, group);

  /** The row being asked about. The bulk answers are asked elsewhere now. */
  const [asking, setAsking] = useState<CleanupFile | null>(null);
  const shown = useClosing(asking !== null);
  const { busy, error, run } = useDiscard();

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
        {(rows, offset) => (
      <ul className="ruled flex flex-col">
        {rows.map((file, index) => (
          <li
            key={file.path}
            style={stagger(offset + index)}
            className="row-enter -mx-4 flex items-center gap-5 rounded-card px-4 py-3.5 transition-colors hover:bg-surface"
          >
            {/* The rows here are files, but a file is recognised by the film it
                was set aside from — and the same poster on the same left edge
                is what says which. Absent on the rows whose film has been
                renamed or removed, where the block stands in and keeps the
                edge straight.

                Unnamed, alone among the lists that draw this: one film can
                hold two rows here — the Profile 7 original and the audio one,
                both beside the same film — and a transition name is a promise
                that only one thing on the page is wearing it. */}
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
                  // No film to open: either it was renamed after the rewrite or
                  // it is gone. The file is still real, and still deletable.
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
                <span
                  className={`rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap ring-1 ring-inset ${
                    file.kind === "leftover"
                      ? "text-red-700 ring-red-500/30 dark:text-red-300"
                      : "opacity-70 ring-line-strong"
                  }`}
                >
                  {KIND_LABEL[file.kind]}
                </span>
                {/* Where the row came from, when it did not come from a
                    folder that opened. The size is still worth counting — the
                    file is on the drive taking up room — but nothing has seen
                    it today, so nothing may be promised about deleting it. */}
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

            <button
              type="button"
              onClick={() => setAsking(file)}
              disabled={busy || file.offline}
              title={
                file.offline
                  ? "The drive this file lives on is not connected"
                  : undefined
              }
              // Always there, where it used to arrive on hover. Hiding an
              // action until the pointer finds it is right for one that is
              // incidental to the row — this is the row's whole point. Every
              // line in this list is a file whose only remaining question is
              // whether to delete it, and a page of them with no visible way
              // to do that reads as a list you cannot act on at all. It also
              // put the count at the top ("Delete 6 leftovers") in front of
              // six rows that appeared to offer nothing.
              className={BUTTON.danger}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
        )}
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
