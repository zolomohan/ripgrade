"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";

import { beginScan, rescanLibrary } from "./actions";
import { useJobs } from "./jobs-provider";
import type { ScanState } from "@/lib/scanner";

/**
 * Owns the scan for the whole app — starting one, and turning its end into
 * the result banner and a repaint.
 *
 * This lives in the root layout rather than in the header button, because a
 * layout survives navigation and a page does not: previously, opening a film
 * mid-scan unmounted the button and took the progress with it.
 *
 * The state itself arrives over the job stream (`JobsProvider`); what is left
 * here is reacting to its edges. It reports nothing itself. `SidebarProcesses`
 * reads this state and draws it at the foot of the rail, beside whatever else
 * is running.
 */

const BUSY = ["scanning", "dovi", "matching", "artwork", "discs", "wishlist"];

export type ScanResult = { kind: "ok" | "error"; text: string };

type ScanContext = {
  state: ScanState;
  /**
   * @param force Ask the indexers about every film and want once the drive has
   *   been read, however recently they were asked — the library shelf's button,
   *   which is one press for "bring this page up to date". The rail's and
   *   Settings' Scan leave that alone; they are maintenance, and the sweep that
   *   follows them is the cheap one. Awaitable so a button can stay pressed
   *   until the job it started exists to speak for itself.
   */
  start: (options?: { force?: boolean }) => Promise<void>;
  busy: boolean;
  /** What the last scan did, until it is dismissed or times out. */
  result: ScanResult | null;
  dismiss: () => void;
};

const Ctx = createContext<ScanContext | null>(null);

export function useScan(): ScanContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useScan must be used inside ScanProvider");
  return ctx;
}

/**
 * How long a finished scan has its say for.
 *
 * Both clear themselves: the rail reports what is happening, and a line about
 * something that finished is in the way the moment it has been read. A failure
 * gets the longer window because it is the longer sentence — a list of folders
 * that could not be read takes more reading than "412 probed".
 */
const RESULT_VISIBLE_MS = { ok: 8000, error: 10000 };

type Result = ScanResult;

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
    return { kind: "error", text: scan.error ?? "Scan failed" };
  }

  if (scan.status !== "done") return null;

  // A folder that could not be read is the one outcome worth colouring like a
  // failure even though the scan finished: what it holds was left out of
  // everything below, and silently.
  if (scan.skipped?.length) {
    return {
      kind: "error",
      text: `Skipped and left untouched: ${scan.skipped.join(", ")}`,
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
   */
  const [result, setResult] = useState<Result | null>(() => {
    const said = outcome(state);
    return said?.kind === "error" ? said : null;
  });

  const busy = BUSY.includes(state.status);

  // Only the edge out of a scan we watched run counts — `subscribe` explains
  // why the status alone cannot say "just completed".
  useEffect(
    () =>
      subscribe((next, prev) => {
        if (!BUSY.includes(prev.scan.status)) return;
        const scan = next.scan;

        if (scan.status === "done") router.refresh();

        const said = outcome(scan);
        if (said) setResult(said);
      }),
    [subscribe, router],
  );

  useEffect(() => {
    if (!result) return;
    const id = setTimeout(() => setResult(null), RESULT_VISIBLE_MS[result.kind]);
    return () => clearTimeout(id);
  }, [result]);

  async function start({ force = false } = {}) {
    setResult(null);
    const next = force ? await rescanLibrary() : await beginScan();
    apply({ scan: next });
    if (next.status === "error") {
      setResult({ kind: "error", text: next.error ?? "Scan failed" });
    }
  }

  return (
    <Ctx.Provider
      value={{ state, start, busy, result, dismiss: () => setResult(null) }}
    >
      {children}
    </Ctx.Provider>
  );
}
