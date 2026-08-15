"use client";

import { useTransition } from "react";

import { rescanUpgradeQueue } from "@/app/actions";
import { CONTROL_H } from "@/app/controls";
import { useJobs } from "@/app/jobs-provider";
import { Spinner } from "@/app/spinner";

/**
 * Ask the indexers again, now.
 *
 * The queue is filled by a sweep that runs itself after every scan, and that
 * sweep skips anything checked within the day — which is what stops opening
 * the app twice costing four hundred searches. It also means every row on this
 * page carries a timestamp the page had no way to act on: "checked 20 h ago",
 * with the release you are waiting for possibly seeded since, and nothing to do
 * but wait out the rest of the day.
 *
 * This is that sweep with the freshness rule off. It is the page's only
 * trigger, and it wears the outline rather than the fill: what it starts is a
 * pass over everything, costing real time at the indexers, but it is a way of
 * refreshing the page you are already on rather than the thing the page is for.
 * The filled pill is the app's word for the decision a screen is asking you to
 * make, and spending it here would put the loudest button on the page beside a
 * list whose rows are the actual work.
 *
 * Progress belongs to the rail, like every other job here — the phase, the
 * count, the film in hand, and the way to stop it. So a running sweep gets no
 * numbers out of this button, only the app's wheel where its icon was and the
 * word for what it is doing. It used to hand its whole width to a bar and go
 * wordless, which was a truthful shape and a lonely one: it was the only
 * loader in the app, so it said "working" in a dialect nothing else spoke.
 */
export function RescanButton({
  jackettReady,
  label = "Scan",
}: {
  jackettReady: boolean;
  /**
   * What the button says when it is not running. "Scan" reads correctly at the
   * head of the wishlist, where the page itself is the subject; on a card
   * that names the pass, it needs to be the verb for that pass instead.
   */
  label?: string;
}) {
  const { jobs, apply } = useJobs();
  const sweeping = jobs.sweep.status === "running";
  // Only the round trip that starts it; from then on the job speaks for itself.
  const [starting, start] = useTransition();

  const busy = sweeping || starting;

  return (
    <button
      type="button"
      disabled={busy || !jackettReady}
      onClick={() =>
        start(async () => {
          const job = await rescanUpgradeQueue();
          // The stream is a moment behind the action that caused it, and a
          // button that stayed pressable in between would start a second sweep.
          apply({ sweep: job });
        })
      }
      // Named in both states rather than by its contents: "Searching…" is
      // enough on screen beside a turning wheel, and no use at all read out on
      // its own. aria-busy is what says the wait is work rather than a fault.
      aria-label={busy ? "Searching the indexers" : label}
      aria-busy={busy}
      title={
        busy
          ? "Searching the indexers — progress is in the sidebar"
          : jackettReady
            ? "Search every film and want again, including the ones checked today"
            : "Connect Jackett on the Settings page first"
      }
      // A fixed width, so what is inside can change completely without the
      // controls beside it moving. Faded while a sweep runs, because it really
      // is unpressable then — the state is disabled, and dressing it up as
      // live would be the button lying about what a click would do.
      className={`flex ${CONTROL_H} w-32 shrink-0 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm transition-colors hover:bg-surface-strong disabled:opacity-40`}
    >
      {busy ? (
        <Spinner />
      ) : (
        /* A full turn of the arrow: what was checked is checked again. The
           wheel takes its place while it runs, which is the same gesture
           still turning. */
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
          <path d="M20 11a8 8 0 1 0-.6 4" />
          <path d="M20 5v6h-6" />
        </svg>
      )}
      {busy ? "Searching…" : label}
    </button>
  );
}
