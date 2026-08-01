"use client";

import { useEffect, useState } from "react";

import { beginScan, scanStatus } from "./actions";
import { Toast } from "./toast";
import type { ScanState } from "@/lib/scanner";

type Result = { kind: "ok" | "error"; text: string };

const RESULT_VISIBLE_MS = 6000;

export function ScanButton({ initialState }: { initialState: ScanState }) {
  const [state, setState] = useState(initialState);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (state.status !== "scanning" && state.status !== "matching") return;

    const id = setInterval(async () => {
      const next = await scanStatus();
      setState(next);

      // The interval only runs while busy, so reaching a terminal status here
      // is by definition the transition — no previous-value tracking.
      if (next.status === "done") {
        const parts = [
          `${next.probed} probed`,
          `${next.cached} unchanged`,
          ...(next.removed ? [`${next.removed} removed`] : []),
          ...(next.failed ? [`${next.failed} failed`] : []),
          ...(next.matchTotal ? [`${next.matched} matched`] : []),
          ...(next.needsReview ? [`${next.needsReview} need review`] : []),
        ];
        setResult({ kind: "ok", text: parts.join(" · ") });
      } else if (next.status === "error") {
        setResult({ kind: "error", text: next.error ?? "Scan failed" });
      }
    }, 500);

    return () => clearInterval(id);
  }, [state.status]);

  // Errors stay until dismissed; a successful summary fades on its own.
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

  const scanning = state.status === "scanning";
  const matching = state.status === "matching";
  const busy = scanning || matching;
  const handled = state.probed + state.cached + state.failed;

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="shrink-0 rounded-lg bg-foreground px-3 py-1.5 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {scanning ? "Scanning…" : matching ? "Matching…" : "Scan library"}
      </button>

      {busy && (
        <Toast tone="busy">
          <p>
            {scanning
              ? `Scanning — ${handled} of ${state.discovered} files`
              : `Matching against TMDb — ${state.matchDone} of ${state.matchTotal}`}
          </p>
          {(scanning ? state.discovered : state.matchTotal) > 0 && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-foreground/70 transition-[width] duration-300"
                style={{
                  width: `${
                    scanning
                      ? (handled / state.discovered) * 100
                      : (state.matchDone / state.matchTotal) * 100
                  }%`,
                }}
              />
            </div>
          )}
          {state.current && (
            <p className="mt-1.5 truncate text-xs opacity-45">
              {scanning ? state.current.split("/").pop() : state.current}
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
    </>
  );
}
