"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  stopConvert,
  stopFullDoviScan,
  stopThumbRebuild,
  stopUpgradeSweep,
} from "@/app/actions";
import { useJobs } from "@/app/jobs-provider";
import {
  ProcessDetails,
  type ProcessDetail,
  type ProcessStat,
} from "@/app/process-details";
import { useScan, type ScanResult } from "@/app/scan-provider";

/**
 * What is happening right now, at the foot of the rail.
 *
 * The three long jobs used to report in three places — the scan in a floating
 * toast, the Dolby Vision pass and the conversion on a page of their own — so
 * seeing whether anything was running meant being on the right screen, or
 * catching a toast before it went. The rail is on every screen and never
 * unmounts, which makes it the one place that can answer the question at any
 * moment. Nothing shows when nothing is running.
 *
 * Progress arrives over the job stream, including a job started from
 * somewhere else — the old idle poll existed only to notice those.
 *
 * There is no history here on purpose. A list of what finished told you what
 * you already watched finish.
 *
 * A name and a bar, and nothing else. Each job also knows what it is on right
 * now — the file, the film — and putting that under the bar meant a line of
 * text rewriting itself several times a second in the corner of every screen.
 * It read as noise, and it answered a question nobody had: the bar already
 * says how far along, and which particular file it is passing through says
 * nothing about that.
 */

const count = (n: number) => n.toLocaleString("en-GB");

function Bar({ percent }: { percent: number }) {
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-strong">
      <div
        className="h-full rounded-full bg-foreground/70 motion-safe:transition-[width] motion-safe:duration-300"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

/**
 * The whole row is the button, rather than a link tucked beside the name: the
 * thing you want to press is the job, and it is already the right shape.
 *
 * That also settles where Stop lives. A button inside a button is not markup a
 * browser will accept, and of the two the rail keeps the one the eye is drawn
 * to anyway — stopping is a decision, and decisions can afford the click it
 * costs to open the dialog and take them there.
 */
function Job({
  name,
  percent,
  leaving,
  onOpen,
}: {
  name: string;
  percent?: number;
  /** True once the job has ended and the row is playing itself out. */
  leaving?: boolean;
  onOpen: () => void;
}) {
  return (
    // The wrapper is what animates and what collapses; the padding sits inside
    // it rather than as a gap on the list, so the space a row takes leaves with
    // the row instead of snapping shut after it.
    <div className={`job-row ${leaving ? "is-leaving" : ""}`}>
      <div>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${name} — show progress`}
          className="w-full min-w-0 pb-3 text-left transition-opacity hover:opacity-70"
        >
          <p className="min-w-0 truncate text-[11px] font-medium">{name}</p>
          {percent !== undefined && <Bar percent={percent} />}
        </button>
      </div>
    </div>
  );
}

/** A running job, as both the rail draws it and the dialog explains it. */
type Row = {
  key: string;
  name: string;
  percent?: number;
  detail: ProcessDetail;
  stop?: () => Promise<void>;
};

/**
 * The order the rail lists jobs in, which a row on its way out keeps — sorted
 * back into place rather than left wherever the leaving ones were appended, or
 * a job ending in the middle would drop to the bottom to do it.
 */
const ORDER = ["scan", "dovi", "sweep", "thumbs", "convert"];

/** Matches `--job-out` in globals.css; the two have to agree. */
const EXIT_MS = 200;

/**
 * The rows to draw: what is running now, plus what stopped within the last
 * `--job-out`, marked as leaving.
 *
 * A job ending is state disappearing, and React unmounts the row in the same
 * frame — which leaves nothing on screen to animate out. This is `useClosing`'s
 * problem in list form, and the same answer: keep the row a moment longer than
 * the job it describes.
 *
 * Diffed during render rather than in an effect, for the reason `useClosing`
 * gives — an effect would paint the frame the row is already gone from, and
 * that frame is the exact moment the exit is meant to start.
 */
function useLeaving(rows: Row[]): (Row & { leaving?: boolean })[] {
  const [held, setHeld] = useState<Row[]>([]);
  const [keys, setKeys] = useState(() => rows.map((row) => row.key).join());

  // The last committed rows, so a job that ends is drawn on its way out with
  // the numbers it finished on rather than the ones it was started with.
  const committed = useRef(rows);
  useEffect(() => {
    committed.current = rows;
  });

  const current = rows.map((row) => row.key).join();
  if (current !== keys) {
    const running = (key: string) => rows.some((row) => row.key === key);
    setKeys(current);
    // Filtered on the way in as well as out: a job started again before its
    // exit has finished is running, not leaving, and must not be drawn twice.
    setHeld((leaving) =>
      [...leaving, ...committed.current].filter((row) => !running(row.key)),
    );
  }

  useEffect(() => {
    if (!held.length) return;
    const timer = setTimeout(() => setHeld([]), EXIT_MS);
    return () => clearTimeout(timer);
  }, [held]);

  return [...rows, ...held.map((row) => ({ ...row, leaving: true }))].sort(
    (a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key),
  );
}

/**
 * The last result, held for `--job-out` after it is cleared.
 *
 * `useLeaving`'s problem for a value rather than a list, and the same answer:
 * the line clears itself after ten seconds, and without this React drops it in
 * the same frame — so the one thing it had to do on its way out, it could not.
 *
 * Adjusted during render rather than in an effect, for the reason `useClosing`
 * gives: an effect would paint the frame the line is already gone from, and
 * that frame is the exact moment the exit is meant to start.
 */
function useParting(result: ScanResult | null) {
  const [held, setHeld] = useState(result);

  if (result && result !== held) setHeld(result);

  const leaving = held !== null && result === null;

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setHeld(null), EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return [held, leaving] as const;
}

export function SidebarProcesses() {
  const { state: scan, busy: scanning, result, dismiss } = useScan();
  const { jobs, apply } = useJobs();
  const { dovi, convert, sweep, thumbs } = jobs;
  const [stopping, setStopping] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const router = useRouter();

  const reading = dovi.status === "running";
  const converting = convert.status === "running";
  const sweeping = sweep.status === "running";
  const thumbing = thumbs.status === "running";
  const anyRunning = scanning || reading || converting || sweeping || thumbing;

  // A job that finished changed the library underneath whatever is open.
  useEffect(() => {
    if (!anyRunning) router.refresh();
  }, [anyRunning, router]);

  const handled = scan.probed + scan.cached + scan.failed;

  // Named once here rather than inside each branch: every phase reports the
  // same four counts, and only the headline changes.
  const scanCounts: ProcessStat[] = [
    { label: "Found", value: count(scan.discovered) },
    { label: "Probed", value: count(scan.probed) },
    { label: "Unchanged", value: count(scan.cached) },
    { label: "Failed", value: count(scan.failed), quiet: !scan.failed },
  ];

  const scanPhase =
    scan.status === "scanning"
      ? {
          name: `Scanning · ${count(handled)} of ${count(scan.discovered)}`,
          title: "Scanning the library",
          percent: scan.discovered ? (handled / scan.discovered) * 100 : 0,
          currentLabel: "Reading",
          stats: [
            ...scanCounts,
            ...(scan.removed
              ? [{ label: "Removed", value: count(scan.removed) }]
              : []),
          ],
          note: scan.root ? `Under ${scan.root}` : undefined,
        }
      : scan.status === "dovi"
        ? {
            name: `Dolby Vision · ${scan.doviDone} of ${scan.doviTotal}`,
            title: "Reading Dolby Vision streams",
            percent: scan.doviTotal ? (scan.doviDone / scan.doviTotal) * 100 : 0,
            currentLabel: "Film",
            stats: [
              { label: "Read", value: count(scan.doviDone) },
              { label: "To read", value: count(scan.doviTotal) },
            ],
            note: "A head scan of every DV film the library has not read yet.",
          }
        : scan.status === "matching"
          ? {
              name: `Matching · ${scan.matchDone} of ${scan.matchTotal}`,
              title: "Matching against TMDb",
              percent: scan.matchTotal
                ? (scan.matchDone / scan.matchTotal) * 100
                : 0,
              currentLabel: "Film",
              stats: [
                { label: "Checked", value: count(scan.matchDone) },
                { label: "To check", value: count(scan.matchTotal) },
                { label: "Matched", value: count(scan.matched) },
                {
                  label: "Need review",
                  value: count(scan.needsReview),
                  quiet: !scan.needsReview,
                },
              ],
            }
          : scan.status === "artwork"
            ? {
                name: `Artwork · ${scan.artDone} of ${scan.artTotal}`,
                title: "Downloading artwork",
                percent: scan.artTotal
                  ? (scan.artDone / scan.artTotal) * 100
                  : 0,
                currentLabel: "Film",
                stats: [
                  { label: "Done", value: count(scan.artDone) },
                  { label: "To fill", value: count(scan.artTotal) },
                  { label: "Images saved", value: count(scan.artSaved) },
                ],
                note: "Only the posters, backdrops and logos missing on disk.",
              }
            : scan.status === "discs"
              ? {
                  name: `Discs · ${scan.discDone} of ${scan.discTotal}`,
                  title: "Looking up disc releases",
                  percent: scan.discTotal
                    ? (scan.discDone / scan.discTotal) * 100
                    : 0,
                  currentLabel: "Title",
                  stats: [
                    { label: "Looked up", value: count(scan.discDone) },
                    { label: "To look up", value: count(scan.discTotal) },
                  ],
                }
              : {
                  name: `Wishlist · ${scan.wishDone} of ${scan.wishTotal}`,
                  title: "Searching for wanted films",
                  percent: scan.wishTotal
                    ? (scan.wishDone / scan.wishTotal) * 100
                    : 0,
                  currentLabel: "Film",
                  stats: [
                    { label: "Searched", value: count(scan.wishDone) },
                    { label: "To search", value: count(scan.wishTotal) },
                    { label: "Found", value: count(scan.wishFound) },
                  ],
                  note: "Wants the library has not matched a file to yet.",
                };

  const rows: Row[] = [];

  if (scanning) {
    rows.push({
      key: "scan",
      name: scanPhase.name,
      percent: scanPhase.percent,
      detail: {
        title: scanPhase.title,
        percent: scanPhase.percent,
        current: scan.current,
        currentLabel: scanPhase.currentLabel,
        stats: scanPhase.stats,
        startedAt: scan.startedAt,
        note: scanPhase.note,
      },
    });
  }

  if (reading) {
    rows.push({
      key: "dovi",
      name: `Reading DV · ${Math.round(dovi.percent)}%`,
      percent: dovi.percent,
      detail: {
        title: "Reading Dolby Vision",
        percent: dovi.percent,
        current: dovi.path,
        currentLabel: "File",
        stats: [{ label: "Frames read", value: count(dovi.frames) }],
        note: "Every frame, rather than the first three hundred.",
      },
      stop: () => stopFullDoviScan().then((job) => apply({ dovi: job })),
    });
  }

  if (sweeping) {
    // One job, two halves. The rail names whichever is running rather than
    // averaging them into a number that describes neither.
    const wishing = sweep.phase === "wishlist";
    const done = wishing ? sweep.wishDone : sweep.done;
    const total = wishing ? sweep.wishTotal : sweep.total;

    rows.push({
      key: "sweep",
      name: `${wishing ? "Wishlist" : "Upgrades"} · ${count(done)} of ${count(total)}`,
      percent: total ? (done / total) * 100 : 0,
      detail: {
        title: wishing ? "Searching for wanted films" : "Sweeping for upgrades",
        percent: total ? (done / total) * 100 : 0,
        current: sweep.current,
        currentLabel: "Film",
        stats: wishing
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
            ],
        startedAt: sweep.startedAt,
        note: wishing
          ? "Films you want but do not have, asked of the same indexers."
          : "Stopping keeps every check already made; the next run resumes.",
      },
      stop: () => stopUpgradeSweep().then((job) => apply({ sweep: job })),
    });
  }

  if (thumbing) {
    rows.push({
      key: "thumbs",
      name: `Thumbnails · ${count(thumbs.done)} of ${count(thumbs.total)}`,
      percent: thumbs.total ? (thumbs.done / thumbs.total) * 100 : 0,
      detail: {
        title: "Rebuilding thumbnails",
        percent: thumbs.total ? (thumbs.done / thumbs.total) * 100 : 0,
        current: thumbs.current,
        currentLabel: "Folder",
        stats: [
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

  if (converting) {
    rows.push({
      key: "convert",
      // What is being done to the file, not how far in it is: the bar under
      // the line already says that, and "step 2 of 4" says nothing about which
      // four. The dialog is where the steps are named.
      name: "DV P7 → P8",
      percent: convert.percent,
      detail: {
        title: "Converting to Profile 8",
        percent: convert.percent,
        current: convert.label ?? convert.path,
        currentLabel: "Step",
        stats: [
          { label: "Step", value: `${convert.step} of ${convert.steps}` },
          ...(convert.check ? [{ label: "Check", value: convert.check }] : []),
        ],
        note: convert.path,
      },
      stop: () => stopConvert().then((job) => apply({ convert: job })),
    });
  }

  // What the rail draws, which outlives what is running by one animation.
  const drawn = useLeaving(rows);
  const [said, saidLeaving] = useParting(result);

  // A job that ends takes its dialog with it. Forgotten here rather than left
  // set, or the next run of the same job would find the rail still holding a
  // request to open it and pop up unasked. Adjusted during render, the way
  // `useClosing` does it — an effect would paint the stale frame first.
  // Against the live rows, not the drawn ones: the dialog goes with the job,
  // while the row it came from is still on its way out of the rail.
  if (open !== null && !rows.some((row) => row.key === open)) setOpen(null);

  // Held open while a finished job — or the line about one — plays out, or
  // there would be nothing left rendered to play it.
  if (!drawn.length && !said) return null;

  // Null once the job ends, which is what plays the dialog out.
  const shown = rows.find((row) => row.key === open) ?? null;

  return (
    // Bare rather than boxed: it is part of the rail, not a panel visiting it.
    // `px-3` puts the labels on the same vertical line as the links above.
    <div className="flex w-full min-w-0 flex-col px-3 py-1">
      {drawn.map((row) => (
        <Job
          key={row.key}
          name={row.name}
          percent={row.percent}
          leaving={row.leaving}
          onOpen={() => setOpen(row.key)}
        />
      ))}

      <ProcessDetails
        detail={shown?.detail ?? null}
        onClose={() => setOpen(null)}
        busy={stopping}
        onCancel={
          shown?.stop &&
          (() => {
            setStopping(true);
            void shown.stop!().finally(() => {
              setStopping(false);
              setOpen(null);
            });
          })
        }
      />

      {/* The one piece of the old toast worth keeping: what the scan actually
          did. It clears itself, and clicking it clears it now.

          Drawn as a row of the rail rather than as text under one, so it
          arrives and leaves the way the jobs above it do — the line is the
          last thing the scan has to say, and it should not be the one thing
          that blinks out. */}
      {!anyRunning && said && (
        <div className={`job-row ${saidLeaving ? "is-leaving" : ""}`}>
          <div>
            <button
              type="button"
              onClick={dismiss}
              className="min-w-0 text-left"
              title={said.text}
            >
              <p
                className={`text-[11px] font-medium ${
                  said.kind === "error" ? "text-red-600 dark:text-red-400" : ""
                }`}
              >
                {said.kind === "ok" ? "Scan complete" : "Scan failed"}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[10px] opacity-45">
                {said.text}
              </p>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
