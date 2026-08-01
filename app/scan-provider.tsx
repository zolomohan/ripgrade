"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";

import { beginScan, scanStatus } from "./actions";
import { Toast } from "./toast";
import type { ScanState } from "@/lib/scanner";

/**
 * Owns the scan state for the whole app.
 *
 * This lives in the root layout rather than in the header button, because a
 * layout survives navigation and a page does not: previously, opening a film
 * mid-scan unmounted the button and took the progress toast with it.
 */

const BUSY = ["scanning", "matching", "discs"];

type ScanContext = { state: ScanState; start: () => void; busy: boolean };

const Ctx = createContext<ScanContext | null>(null);

export function useScan(): ScanContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useScan must be used inside ScanProvider");
  return ctx;
}

const RESULT_VISIBLE_MS = 8000;
type Result = { kind: "ok" | "error"; text: string };

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
        const parts = [
          `${next.probed} probed`,
          `${next.cached} unchanged`,
          ...(next.removed ? [`${next.removed} removed`] : []),
          ...(next.failed ? [`${next.failed} failed`] : []),
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

  const handled = state.probed + state.cached + state.failed;
  const phase =
    state.status === "scanning"
      ? {
          label: `Scanning — ${handled} of ${state.discovered} files`,
          done: handled,
          total: state.discovered,
        }
      : state.status === "matching"
        ? {
            label: `Matching against TMDb — ${state.matchDone} of ${state.matchTotal}`,
            done: state.matchDone,
            total: state.matchTotal,
          }
        : {
            label: `Looking up discs — ${state.discDone} of ${state.discTotal}`,
            done: state.discDone,
            total: state.discTotal,
          };

  return (
    <Ctx.Provider value={{ state, start, busy }}>
      {children}

      {busy && (
        <Toast tone="busy">
          <p>{phase.label}</p>
          {phase.total > 0 && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-strong">
              <div
                className="h-full rounded-full bg-foreground/70 transition-[width] duration-300"
                style={{ width: `${(phase.done / phase.total) * 100}%` }}
              />
            </div>
          )}
          {state.current && (
            <p className="mt-1.5 truncate text-xs opacity-45">
              {state.status === "scanning"
                ? state.current.split("/").pop()
                : state.current}
            </p>
          )}
        </Toast>
      )}

      {!busy && result && (
        <Toast
          tone={result.kind === "ok" ? "ok" : "error"}
          onDismiss={() => setResult(null)}
        >
          <p
            className={
              result.kind === "error" ? "text-red-600 dark:text-red-400" : ""
            }
          >
            {result.kind === "ok" ? "Scan complete" : "Scan failed"}
          </p>
          <p className="mt-0.5 text-xs opacity-60">{result.text}</p>
        </Toast>
      )}
    </Ctx.Provider>
  );
}
