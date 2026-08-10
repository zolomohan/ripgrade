"use client";

import {
  stopConvert,
  stopFullDoviScan,
  stopStripAudio,
  stopThumbRebuild,
  stopUpgradeSweep,
} from "@/app/actions";
import type { ProcessDetail } from "@/app/process-details";
import type { JobsSnapshot } from "@/lib/job-events";

/**
 * The five long jobs, described once.
 *
 * Two places draw them now — the rail at the foot of every screen, and the Jobs
 * page — and a job is the same job wherever it is drawn. Left in the rail, the
 * second copy would have started as a duplicate and ended as a disagreement:
 * the rail's conversion was called "DV P7 → P8" until it was not, and a page
 * holding its own copy of that string would still be saying it.
 *
 * The scan is not here. It belongs to the rail alone: it is the one job that
 * reports its own outcome in a closing line rather than a row, and the Jobs
 * page deliberately leaves it out.
 *
 * `apply` is passed in rather than read from the context here, so this stays a
 * plain function that both a rail and a page can call from wherever they hold
 * their own hooks.
 */

const count = (n: number) => n.toLocaleString("en-GB");

/** The two-tier form the library list and the film page both set sizes in. */
const gigabytes = (bytes: number) =>
  bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(2)} TB`
    : `${(bytes / 1e9).toFixed(1)} GB`;

/** A running job, as both the rail draws it and the dialog explains it. */
export type JobRow = {
  key: string;
  name: string;
  percent?: number;
  /**
   * The film it is working on, where it works on one — the same path the log
   * writes against a finished run.
   *
   * Named separately rather than dug back out of `detail.rows`, because it is
   * not being shown here: it is what the Jobs page looks the film up by, so
   * that a job in progress can carry the poster and title the same job carries
   * once it is history.
   */
  path?: string;
  detail: ProcessDetail;
  stop?: () => Promise<void>;
};

export function jobRows(
  jobs: JobsSnapshot,
  apply: (patch: Partial<JobsSnapshot>) => void,
): JobRow[] {
  const { dovi, convert, strip, sweep, thumbs } = jobs;
  const rows: JobRow[] = [];

  if (dovi.status === "running") {
    rows.push({
      key: "dovi",
      name: `Reading DV · ${Math.round(dovi.percent)}%`,
      percent: dovi.percent,
      path: dovi.path,
      detail: {
        title: "Reading Dolby Vision",
        percent: dovi.percent,
        rows: [
          // One film for the whole pass, so it is the subject rather than the
          // thing in hand this second.
          ...(dovi.path
            ? [{ label: "File", value: dovi.path, mono: true }]
            : []),
          { label: "Frames read", value: count(dovi.frames) },
        ],
        startedAt: dovi.startedAt,
      },
      stop: () => stopFullDoviScan().then((job) => apply({ dovi: job })),
    });
  }

  if (sweep.status === "running") {
    // One job, two halves. The rail names whichever is running rather than
    // averaging them into a number that describes neither.
    const wishing = sweep.phase === "wishlist";
    const done = wishing ? sweep.wishDone : sweep.done;
    const total = wishing ? sweep.wishTotal : sweep.total;

    rows.push({
      key: "sweep",
      // What it is doing, not how far along it is: the bar under this line is
      // already the fraction, and saying it twice makes the name a readout.
      name: wishing ? "Finding Wishlist" : "Finding Upgrades",
      percent: total ? (done / total) * 100 : 0,
      detail: {
        title: wishing ? "Searching for wanted films" : "Sweeping for upgrades",
        percent: total ? (done / total) * 100 : 0,
        rows: [
          ...(sweep.current
            ? [{ label: "Film", value: sweep.current, mono: true }]
            : []),
          ...(wishing
            ? [
                { label: "Searched", value: count(sweep.wishDone) },
                { label: "To search", value: count(sweep.wishTotal) },
                { label: "Found", value: count(sweep.wishFound) },
                { label: "Upgrades found", value: count(sweep.found) },
              ]
            : [
                { label: "Checked", value: count(sweep.done) },
                { label: "To check", value: count(sweep.total) },
                { label: "Found", value: count(sweep.found) },
                {
                  label: "Fresh enough",
                  value: count(sweep.skipped),
                  quiet: !sweep.skipped,
                },
              ]),
        ],
        startedAt: sweep.startedAt,
        note: wishing
          ? "Films you want but do not have, asked of the same indexers."
          : "Stopping keeps every check already made; the next run resumes.",
      },
      stop: () => stopUpgradeSweep().then((job) => apply({ sweep: job })),
    });
  }

  if (thumbs.status === "running") {
    rows.push({
      key: "thumbs",
      name: `Thumbnails · ${count(thumbs.done)} of ${count(thumbs.total)}`,
      percent: thumbs.total ? (thumbs.done / thumbs.total) * 100 : 0,
      detail: {
        title: "Rebuilding thumbnails",
        percent: thumbs.total ? (thumbs.done / thumbs.total) * 100 : 0,
        rows: [
          ...(thumbs.current
            ? [{ label: "Folder", value: thumbs.current, mono: true }]
            : []),
          { label: "Done", value: count(thumbs.done) },
          { label: "To make", value: count(thumbs.total) },
          { label: "Ready", value: count(thumbs.ready) },
          {
            label: "Unreadable",
            value: count(thumbs.failed),
            quiet: !thumbs.failed,
          },
        ],
        startedAt: thumbs.startedAt,
        note: "Three widths per poster. What is made is kept if you stop.",
      },
      stop: () => stopThumbRebuild().then((job) => apply({ thumbs: job })),
    });
  }

  if (convert.status === "running") {
    // Bytes written when they can be counted, and the step it is on when they
    // cannot — `--safe` mode and a temp directory both put the working files
    // somewhere the watcher is not looking, and a conversion with no bar at all
    // reads as one that is not running.
    const percent =
      convert.percent ??
      (convert.steps ? (convert.step / convert.steps) * 100 : 0);

    // The same job slot runs the conversion and the rebuild back out of it, so
    // the direction is the first thing the rail has to get right — the two
    // leave the film in opposite states and neither is the other's progress.
    const rebuild = convert.mode === "rebuild";

    rows.push({
      key: "convert",
      path: convert.path,
      // What is being done to the file, not how far in it is: the bar under
      // the line already says that, and "step 2 of 4" says nothing about which
      // four. The dialog is where the steps are named, and where the profiles
      // either side of the conversion are spelled out.
      name: rebuild ? "Dolby Vision Rebuild" : "Dolby Vision Conversion",
      percent,
      detail: {
        title: rebuild ? "Rebuilding Profile 7" : "Converting to Profile 8.1",
        percent,
        // What it is doing and how far in, in one line beside the figure. It
        // was two facts under two captions, one of them called "Step" sitting
        // directly under another called "Step".
        stage: `${convert.label ?? "Starting"} · step ${convert.step} of ${convert.steps}`,
        rows: convert.path
          ? [{ label: "File", value: convert.path, mono: true }]
          : [],
        command: convert.command,
        startedAt: convert.startedAt,
        output: convert.output,
        note: rebuild
          ? "The converted file is replaced only once the rebuild has been checked. Cancelling leaves it untouched."
          : "The original is kept beside it. Cancelling leaves it untouched.",
      },
      stop: () => stopConvert().then((job) => apply({ convert: job })),
    });
  }

  if (strip.status === "running") {
    rows.push({
      key: "strip",
      path: strip.path,
      // What is being done, in the fewest words that still say which tracks:
      // "Remuxing" alone would not distinguish this from the conversion's own
      // second step, and the rail has room for one line.
      name: "Removing audio",
      percent: strip.percent,
      detail: {
        title: "Removing audio tracks",
        percent: strip.percent,
        stage: strip.label ?? "Starting",
        output: strip.output,
        rows: [
          ...(strip.path
            ? [{ label: "File", value: strip.path, mono: true }]
            : []),
          ...(strip.removed !== undefined
            ? [{ label: "Removing", value: count(strip.removed) }]
            : []),
          ...(strip.kept !== undefined
            ? [{ label: "Keeping", value: count(strip.kept) }]
            : []),
          ...(strip.freedBytes !== undefined
            ? [{ label: "Frees", value: gigabytes(strip.freedBytes) }]
            : []),
        ],
        startedAt: strip.startedAt,
        note: "The original is kept beside it. Cancelling leaves it untouched.",
      },
      stop: () => stopStripAudio().then((job) => apply({ strip: job })),
    });
  }

  return rows;
}
