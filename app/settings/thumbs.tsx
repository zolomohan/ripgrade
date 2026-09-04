"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { toast } from "glaceui";

import { clearThumbs, rebuildThumbs } from "../actions";
import { useJobs } from "../jobs-provider";
import { Spinner } from "../spinner";
import { PRIMARY, QUIET } from "./parts";
import { size } from "@/app/format";

/**
 * The thumbnail cache: how big it has grown, and the two things worth doing
 * to it. Clearing reclaims the disk — the cache refills itself as shelves
 * are browsed. Rebuilding is the opposite gesture: generate everything now,
 * which is what you want just before the drive leaves the desk.
 *
 * The rebuild runs as a job on the rail, so this page starts it and reports
 * how it ended rather than holding a request open for the whole pass. Leaving
 * Settings mid-rebuild no longer loses sight of it — that is what the rail is
 * for — and the progress here is deliberately only a word: two bars counting
 * the same thing in two places is one too many.
 *
 * How it ended goes to the toaster, which is the third of the three sites
 * app/toast.tsx was written to collect. This one was a grey line under the
 * cache size with no timer on it at all: it appeared when a pass finished and
 * stayed until something else replaced it, so a page opened an hour later
 * still carried the last rebuild's sentence as though it had just happened.
 * And the end it reports arrives from the stream — you may well be on another
 * tab of Settings by then, or on another page entirely, which is exactly the
 * case the toaster exists for.
 */

export function Thumbs({ files, bytes }: { files: number; bytes: number }) {
  const [pending, startTransition] = useTransition();
  const { jobs, apply, subscribe } = useJobs();
  const router = useRouter();

  const rebuilding = jobs.thumbs.status === "running";

  // How it ended, from the stream rather than from the call that started it —
  // the same edge `ScanProvider` watches for, and for the same reason: a
  // snapshot saying "done" on connect is not a rebuild that just finished.
  useEffect(
    () =>
      subscribe((next, prev) => {
        if (prev.thumbs.status !== "running") return;
        const job = next.thumbs;

        if (job.status === "done") {
          const ready = `${job.ready.toLocaleString("en-GB")} thumbnails ready`;
          // A pass that could not read part of the library is not a success
          // wearing a tick, whatever the count says.
          if (job.failed) {
            toast.warning(
              `${ready} · ${job.failed} could not be read — is the drive connected?`,
            );
          } else {
            toast.success(ready);
          }
        } else if (job.status === "cancelled") {
          // What it got through is kept, so this is a pause rather than a
          // failure — saying so is what stops it reading like lost work.
          toast(
            `Stopped after ${job.done.toLocaleString("en-GB")} of ${job.total.toLocaleString("en-GB")}. What was made is kept.`,
          );
        } else if (job.status === "error") {
          toast.error(job.error ?? "The thumbnail rebuild failed.");
        } else {
          return;
        }
        router.refresh();
      }),
    [subscribe, router],
  );

  function clear() {
    startTransition(async () => {
      const removed = await clearThumbs();
      toast.success(
        removed.files
          ? `Cleared ${removed.files.toLocaleString("en-GB")} thumbnails · ${size(removed.bytes)} freed`
          : "The cache was already empty.",
      );
      router.refresh();
    });
  }

  function rebuild() {
    startTransition(async () => {
      // Returns as soon as the pass is under way. Applied so the button reads
      // as pressed now rather than at the stream's next event.
      apply({ thumbs: await rebuildThumbs() });
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm">
          {files
            ? `${files.toLocaleString("en-GB")} thumbnails · ${size(bytes)}`
            : "Nothing cached yet — thumbnails appear as shelves are browsed"}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {files > 0 && (
          <button
            type="button"
            onClick={clear}
            // Deleting the directory a running rebuild is filling would leave
            // it writing thumbs nobody asked for any more.
            disabled={pending || rebuilding}
            className={QUIET}
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={rebuild}
          disabled={pending || rebuilding}
          title="Generate every poster's thumbnails now, so the whole library shows with the drive unplugged"
          className={PRIMARY}
        >
          {rebuilding && <Spinner />}
          {rebuilding ? "Rebuilding…" : "Rebuild now"}
        </button>
      </div>
    </div>
  );
}
