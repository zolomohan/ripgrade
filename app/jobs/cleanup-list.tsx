"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { discardCleanup } from "@/app/actions";
import { EmptyState } from "@/app/empty-state";
import { useClosing } from "@/app/modal";
import { stagger } from "@/app/stagger";
import { BUTTON } from "@/app/controls";
import { ConfirmModal } from "@/app/film/[id]/console";
import type { CleanupFile, CleanupKind } from "@/lib/queue-tasks";
import { movieId } from "@/lib/routes";
import { Grouped, pickGroup, type GroupOption } from "@/app/grouping";
import { Stat } from "@/app/charts";
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

export function CleanupList({
  files: unsorted,
  sort,
  group,
}: {
  files: CleanupFile[];
  sort?: string;
  group?: string;
}) {
  const router = useRouter();
  const files = [...unsorted].sort(pickSort(CLEANUP_SORTS, sort).compare);
  const grouping = pickGroup(CLEANUP_GROUPS, group);

  /** The row being asked about, or "leftovers" for the sweep-all button. */
  const [asking, setAsking] = useState<CleanupFile | "leftovers" | null>(null);
  const shown = useClosing(asking !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leftovers = files.filter((file) => file.kind === "leftover");
  // What the sweep-all button is actually allowed to take. A remembered file
  // is on a drive that is not plugged in: it is real, it is counted in the
  // total, and it cannot be deleted from here.
  const sweepable = leftovers.filter((file) => !file.offline);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  const awayBytes = files
    .filter((file) => file.offline)
    .reduce((sum, file) => sum + file.bytes, 0);

  async function run(targets: CleanupFile[]) {
    setError(null);
    setBusy(true);
    const result = await discardCleanup(targets.map((file) => file.path));
    setBusy(false);
    setAsking(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // The action revalidates; this is what repaints the list it came from.
    router.refresh();
  }

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
      <Stats
        action={
          // Only the wreckage goes in one click. An original is an undo somebody
          // is still holding, and there is no bulk answer to that question.
          sweepable.length > 1 ? (
            <button
              type="button"
              onClick={() => setAsking("leftovers")}
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

      {awayBytes > 0 && (
        <p className="text-xs opacity-45">
          {size(awayBytes)} of this was found the last time its folder could be
          read. The drive is not connected now, so those rows are counted but
          cannot be deleted.
        </p>
      )}

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
            asking === "leftovers"
              ? `Delete ${sweepable.length} leftovers?`
              : asking.kind === "leftover"
                ? "Delete this leftover?"
                : "Delete this original?"
          }
          confirmLabel={
            asking === "leftovers"
              ? `Delete ${size(sweepable.reduce((s, f) => s + f.bytes, 0))}`
              : `Delete ${size(asking.bytes)}`
          }
          tone="danger"
          busy={busy}
          onConfirm={() => run(asking === "leftovers" ? sweepable : [asking])}
          onCancel={() => setAsking(null)}
        >
          {asking === "leftovers" ? (
            <>
              Every one of these is the half-built output of a job that was
              cancelled or killed. Nothing points at them, no film depends on
              them, and{" "}
              {size(sweepable.reduce((sum, file) => sum + file.bytes, 0))} comes
              back.
            </>
          ) : (
            <>
              {CONSEQUENCE[asking.kind]}{" "}
              <span className="font-mono">{asking.name}</span>
            </>
          )}
        </ConfirmModal>
      )}
    </section>
  );
}
