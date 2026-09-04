"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef } from "react";

import { toast } from "glaceui";

import { beginScan, scanDrive } from "./actions";
import { useJobs } from "./jobs-provider";
import type { ScanState } from "@/lib/scanner";

/**
 * Owns the scan for the whole app — starting one, and turning its end into a
 * sentence and a repaint.
 *
 * This lives in the root layout rather than in the header button, because a
 * layout survives navigation and a page does not: previously, opening a film
 * mid-scan unmounted the button and took the progress with it.
 *
 * The state itself arrives over the job stream (`JobsProvider`); what is left
 * here is reacting to its edges. `SidebarProcesses` reads the state and draws
 * the pass in progress at the foot of the rail, beside whatever else is
 * running. How it *ended* is not the rail's, and used to be: the rail is for
 * work under way, and a finished scan's summary sat there as a row that was
 * not a job, with its own dismiss button and its own exit animation, waiting
 * to be read by someone whose eyes were on the page rather than the corner it
 * lives in. That sentence goes to the toaster now — see app/toast.tsx, which
 * is exactly the case it describes: something already over, said somewhere
 * other than where you are looking.
 */

const BUSY = ["scanning", "dovi", "matching", "artwork", "discs", "wishlist"];

export type ScanResult = { kind: "ok" | "error"; text: string };

type ScanContext = {
  state: ScanState;
  /**
   * @param driveOnly Read the folders and stop — the library shelf's Scan,
   *   which is that press and nothing else now: the searches that used to
   *   follow it are separate items in the menu it opens. The rail's and
   *   Settings' Scan leave this alone; they are maintenance, and the cheap
   *   sweep that trails them is part of what maintenance means. Awaitable so a
   *   button can stay pressed until the job it started exists to speak for
   *   itself.
   */
  start: (options?: { driveOnly?: boolean }) => Promise<void>;
  busy: boolean;
};

const Ctx = createContext<ScanContext | null>(null);

export function useScan(): ScanContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useScan must be used inside ScanProvider");
  return ctx;
}

/**
 * How long a finished scan has its say for, in place of the toaster's own five
 * seconds.
 *
 * A scan says more than anything else that reaches the toaster — a dozen
 * counts, or a list of folders that could not be read — and a failure gets the
 * longer window because it is the longer sentence.
 */
const RESULT_VISIBLE_MS = { ok: 8000, error: 10000 };

type Result = ScanResult;

/**
 * The two lines the rail used to draw, as the two a toast is made of: what
 * happened as the title, what it came to underneath.
 */
function report(said: Result) {
  const options = {
    description: said.text,
    duration: RESULT_VISIBLE_MS[said.kind],
  };
  if (said.kind === "error") toast.error("Scan failed", options);
  else toast.success("Scan complete", options);
}

/**
 * What a finished scan has to say, or null while it is still saying it.
 *
 * One function for both ways a result arrives — watched live over the stream,
 * or found already finished when the app is opened — because the two saying
 * different things about the same scan is exactly the kind of drift a rail is
 * read to avoid.
 */
function outcome(scan: ScanState): Result | null {
  if (scan.status === "error") {
    return { kind: "error", text: scan.error ?? "No reason given." };
  }

  if (scan.status !== "done") return null;

  // A folder that could not be read is the one outcome worth colouring like a
  // failure even though the scan finished: what it holds was left out of
  // everything below, and silently.
  //
  // Each entry is already a sentence about a drive rather than a path with a
  // reason in brackets — see `unreachableSentence` in lib/scanner.ts, which is
  // where both this and the failure above are worded.
  if (scan.skipped?.length) {
    return {
      kind: "error",
      text: `${scan.skipped.join(" · ")}. Everything on ${
        scan.skipped.length === 1 ? "it" : "them"
      } was left as it was.`,
    };
  }

  return {
    kind: "ok",
    text: [
      `${scan.probed} probed`,
      `${scan.cached} unchanged`,
      ...(scan.removed ? [`${scan.removed} removed`] : []),
      ...(scan.failed ? [`${scan.failed} failed`] : []),
      ...(scan.doviTotal ? [`${scan.doviTotal} DV streams read`] : []),
      ...(scan.matchTotal ? [`${scan.matched} matched`] : []),
      ...(scan.needsReview ? [`${scan.needsReview} need review`] : []),
      ...(scan.artSaved ? [`${scan.artSaved} images downloaded`] : []),
      ...(scan.discTotal ? [`${scan.discTotal} discs looked up`] : []),
      ...(scan.wishTotal
        ? [`${scan.wishFound} of ${scan.wishTotal} wants found`]
        : []),
    ].join(" · "),
  };
}

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const { jobs, apply, subscribe } = useJobs();
  const state = jobs.scan;
  const router = useRouter();

  const busy = BUSY.includes(state.status);

  /**
   * A scan that had already ended before this tab existed still has something
   * to report — but only if it went wrong.
   *
   * The library is scanned when the app starts, so by the time a browser is
   * pointed at it the scan is often over. One that failed left the shelves
   * looking exactly as they did before, which is the problem: an unplugged
   * drive means every film below is a memory of one, and nothing on screen
   * said so. A scan that *worked* needs no announcement — the library it
   * produced is the announcement — so a summary nobody was waiting for is
   * dropped rather than shown to whoever opens the app next.
   *
   * Once per tab, which is what the ref is for: this is about the state the
   * app was opened in, and an effect that ran again would raise the same old
   * failure a second time.
   */
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const said = outcome(state);
    if (said?.kind === "error") report(said);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only the edge out of a scan we watched run counts — `subscribe` explains
  // why the status alone cannot say "just completed".
  useEffect(
    () =>
      subscribe((next, prev) => {
        if (!BUSY.includes(prev.scan.status)) return;
        const scan = next.scan;

        if (scan.status === "done") router.refresh();

        const said = outcome(scan);
        if (said) report(said);
      }),
    [subscribe, router],
  );

  async function start({ driveOnly = false } = {}) {
    const next = driveOnly ? await scanDrive() : await beginScan();
    apply({ scan: next });
    // Refused before it began — no job to watch, so this is the only place it
    // will ever be said.
    if (next.status === "error") {
      report({
        kind: "error",
        text: next.error ?? "The scan could not be started.",
      });
    }
  }

  return <Ctx.Provider value={{ state, start, busy }}>{children}</Ctx.Provider>;
}
