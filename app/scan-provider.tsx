"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";

import { beginScan, scanStatus } from "./actions";
import type { ScanState } from "@/lib/scanner";

/**
 * Owns the scan state for the whole app.
 *
 * This lives in the root layout rather than in the header button, because a
 * layout survives navigation and a page does not: previously, opening a film
 * mid-scan unmounted the button and took the progress with it.
 *
 * It reports nothing itself. `SidebarProcesses` reads this state and draws it
 * at the foot of the rail, beside whatever else is running.
 */

const BUSY = ["scanning", "dovi", "matching", "discs"];

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

export function ScanProvider({
  initialState,
  children,
}: {
  initialState: ScanState;
  children: React.ReactNode;
}) {
  const [state, setState] = useState(initialState);
  const [result, setResult] = useState<Result | null>(null);
  const router = useRouter();

  const busy = BUSY.includes(state.status);

  useEffect(() => {
    if (!busy) return;

    const id = setInterval(async () => {
      const next = await scanStatus();
      setState(next);

      if (next.status === "done") {
        router.refresh();

        // A folder that could not be read is the one outcome worth colouring
        // like a failure even though the scan finished: what it holds was left
        // out of everything below, and silently.
        if (next.skipped?.length) {
          setResult({
            kind: "error",
            text: `Skipped and left untouched: ${next.skipped.join(", ")}`,
          });
          return;
        }

        const parts = [
          `${next.probed} probed`,
          `${next.cached} unchanged`,
          ...(next.removed ? [`${next.removed} removed`] : []),
          ...(next.failed ? [`${next.failed} failed`] : []),
          ...(next.doviTotal ? [`${next.doviTotal} DV streams read`] : []),
          ...(next.matchTotal ? [`${next.matched} matched`] : []),
          ...(next.needsReview ? [`${next.needsReview} need review`] : []),
          ...(next.discTotal ? [`${next.discTotal} discs looked up`] : []),
        ];
        setResult({ kind: "ok", text: parts.join(" · ") });
      } else if (next.status === "error") {
        setResult({ kind: "error", text: next.error ?? "Scan failed" });
      }
    }, 600);

    return () => clearInterval(id);
  }, [busy, router]);

  useEffect(() => {
    if (result?.kind !== "ok") return;
    const id = setTimeout(() => setResult(null), RESULT_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [result]);

  async function start() {
    setResult(null);
    const next = await beginScan();
    setState(next);
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
