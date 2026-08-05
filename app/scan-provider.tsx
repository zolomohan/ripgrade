"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";

import { beginScan } from "./actions";
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
  start: () => void;
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

const RESULT_VISIBLE_MS = 8000;
type Result = ScanResult;

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const { jobs, apply, subscribe } = useJobs();
  const state = jobs.scan;
  const [result, setResult] = useState<Result | null>(null);
  const router = useRouter();

  const busy = BUSY.includes(state.status);

  // Only the edge out of a scan we watched run counts — `subscribe` explains
  // why the status alone cannot say "just completed".
  useEffect(
    () =>
      subscribe((next, prev) => {
        if (!BUSY.includes(prev.scan.status)) return;
        const scan = next.scan;

        if (scan.status === "done") {
          router.refresh();

          // A folder that could not be read is the one outcome worth colouring
          // like a failure even though the scan finished: what it holds was
          // left out of everything below, and silently.
          if (scan.skipped?.length) {
            setResult({
              kind: "error",
              text: `Skipped and left untouched: ${scan.skipped.join(", ")}`,
            });
            return;
          }

          const parts = [
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
          ];
          setResult({ kind: "ok", text: parts.join(" · ") });
        } else if (scan.status === "error") {
          setResult({ kind: "error", text: scan.error ?? "Scan failed" });
        }
      }),
    [subscribe, router],
  );

  useEffect(() => {
    if (result?.kind !== "ok") return;
    const id = setTimeout(() => setResult(null), RESULT_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [result]);

  async function start() {
    setResult(null);
    const next = await beginScan();
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
