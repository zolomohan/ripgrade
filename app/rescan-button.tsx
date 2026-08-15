"use client";

import { useTransition } from "react";

import { rescanUpgradeQueue } from "@/app/actions";
import { CONTROL_H, ICONS } from "@/app/controls";
import { useJobs } from "@/app/jobs-provider";
import { useScan } from "@/app/scan-provider";
import { Spinner } from "@/app/spinner";

/**
 * Ask again, now.
 *
 * The queue is filled by a sweep that runs itself after every scan, and that
 * sweep skips anything checked within the day — which is what stops opening
 * the app twice costing four hundred searches. It also means every row on this
 * page carries a timestamp the page had no way to act on: "checked 20 h ago",
 * with the release you are waiting for possibly seeded since, and nothing to do
 * but wait out the rest of the day.
 *
 * This is that sweep with the freshness rule off. It wears the outline rather
 * than the fill: what it starts is a pass over everything, costing real time at
 * the indexers, but it is a way of refreshing the page you are already on
 * rather than the thing the page is for. The filled pill is the app's word for
 * the decision a screen is asking you to make, and spending it here would put
 * the loudest button on the page beside a list whose rows are the actual work.
 *
 * Progress belongs to the rail, like every other job here — the phase, the
 * count, the film in hand, and the way to stop it. So a running pass gets no
 * numbers out of this button, only the app's wheel where its icon was and the
 * word for what it is doing. It used to hand its whole width to a bar and go
 * wordless, which was a truthful shape and a lonely one: it was the only
 * loader in the app, so it said "working" in a dialect nothing else spoke.
 *
 * `readDrive` is the library shelf's version of the same press; see below.
 */
export function RescanButton({
  jackettReady,
  label = "Scan",
  readDrive = false,
}: {
  jackettReady: boolean;
  /**
   * What the button says when it is not running. "Scan" reads correctly at the
   * head of the wishlist, where the page itself is the subject; on a card
   * that names the pass, it needs to be the verb for that pass instead.
   */
  label?: string;
  /**
   * Read the library folders first, and only then ask the indexers.
   *
   * The wishlist is a list of films that are, by definition, not on the drive,
   * so reading the drive for it would be a pass over four hundred files to
   * learn nothing about the page. The library shelf is the opposite: it *is*
   * the drive, and both of the things on it go stale — the films when you move
   * a file by hand, the "Upgrades found" section when someone seeds something
   * better. One button for both, in the order they depend on each other, since
   * a release is judged against a score the scan is what settles.
   *
   * Jackett is not required in this mode — the drive half of the press works
   * with nothing configured at all, and the pass simply stops after it.
   */
  readDrive?: boolean;
}) {
  const { jobs, apply } = useJobs();
  const { start: startScan, busy: scanning } = useScan();
  const sweeping = jobs.sweep.status === "running";
  // Only the round trip that starts it; from then on the job speaks for itself.
  const [starting, start] = useTransition();

  // A scan counts against this button only when this button is the one that
  // would have started it. On the wishlist a start-up scan is somebody else's
  // job running, and no reason to refuse a search.
  const reading = readDrive && scanning;
  const busy = reading || sweeping || starting;

  const busyLabel = reading ? "Reading the folders" : "Searching the indexers";

  return (
    <button
      type="button"
      // The search half needs Jackett; the drive half does not. A shelf whose
      // Scan is dead because no indexer is set up cannot be told about the
      // file you have just moved, which is the half that needed no help.
      disabled={busy || (!jackettReady && !readDrive)}
      onClick={() =>
        start(async () => {
          if (readDrive) {
            // The provider owns the scan for the whole app: it applies the
            // job, and it is what turns a refusal — no library folder — into
            // the line the rail shows. The sweep follows the scan on the
            // server, forced, so there is nothing to start here.
            await startScan({ force: true });
            return;
          }

          const job = await rescanUpgradeQueue();
          // The stream is a moment behind the action that caused it, and a
          // button that stayed pressable in between would start a second sweep.
          apply({ sweep: job });
        })
      }
      // Named in both states rather than by its contents: "Searching…" is
      // enough on screen beside a turning wheel, and no use at all read out on
      // its own. aria-busy is what says the wait is work rather than a fault.
      aria-label={busy ? busyLabel : label}
      aria-busy={busy}
      title={
        busy
          ? `${busyLabel} — progress is in the sidebar`
          : readDrive
            ? jackettReady
              ? "Read the library folders for anything new or changed, then search every film and want again"
              : "Read the library folders for anything new or changed. Connect Jackett on the Settings page to search for better copies as well"
            : jackettReady
              ? "Search every film and want again, including the ones checked today"
              : "Connect Jackett on the Settings page first"
      }
      // A fixed width, so what is inside can change completely without the
      // controls beside it moving. Faded while a pass runs, because it really
      // is unpressable then — the state is disabled, and dressing it up as
      // live would be the button lying about what a click would do.
      className={`flex ${CONTROL_H} w-32 shrink-0 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm transition-colors hover:bg-surface-strong disabled:opacity-40`}
    >
      {busy ? (
        <Spinner />
      ) : (
        /* Two marks for two presses, because they are two questions.

           On the wishlist: a signal going out, the app's own mark for the
           indexers, from the scope menu in ⌘F. It was a circular arrow once,
           and a circular arrow is the mark for "again" rather than for what is
           being done again — the wrong half of that button to draw, when where
           it asks is the whole of what makes it different from the rail's Scan.

           On the library shelf: a scanner's frame, corners and a beam, because
           that press is no longer one question. It reads the drive and then
           asks the indexers, and neither half's picture would be honest about
           the other — so the mark is the act rather than either place. See
           `ICONS.scan`. */
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-3.5 w-3.5"
        >
          <path d={readDrive ? ICONS.scan : ICONS.indexers} />
        </svg>
      )}
      {busy ? (reading ? "Scanning…" : "Searching…") : label}
    </button>
  );
}
