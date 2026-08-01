"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { beginScan, scanStatus } from "./actions";
import type { ScanState } from "@/lib/scanner";

type Toast = { kind: "ok" | "error"; text: string };

const RESULT_VISIBLE_MS = 6000;

function Toast({
  tone,
  children,
  onDismiss,
}: {
  tone: "busy" | "ok" | "error";
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  // The button lives inside a `backdrop-blur` header, and backdrop-filter makes
  // an element a containing block for fixed-position descendants. Rendered in
  // place, the toast would anchor to the header rather than the viewport, so it
  // has to be portalled to the body to escape.
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // document.body is only reachable after mount. Rendering null on the server
    // and on the first client pass keeps hydration consistent, which is exactly
    // why this assignment has to happen in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(document.body);
  }, []);

  const dot = {
    busy: "bg-blue-500 animate-pulse",
    ok: "bg-emerald-500",
    error: "bg-red-500",
  }[tone];

  if (!target) return null;

  return createPortal(
    <div className="fixed right-6 bottom-6 z-50 flex max-w-md min-w-72 items-start gap-3 rounded-xl border border-black/10 bg-background/95 px-4 py-3 shadow-lg backdrop-blur dark:border-white/15">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1 text-sm">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-sm opacity-40 hover:opacity-90"
        >
          ✕
        </button>
      )}
    </div>,
    target,
  );
}

export function ScanButton({ initialState }: { initialState: ScanState }) {
  const [state, setState] = useState(initialState);
  const [result, setResult] = useState<Toast | null>(null);

  useEffect(() => {
    if (state.status !== "scanning") return;

    const id = setInterval(async () => {
      const next = await scanStatus();
      setState(next);

      // The interval only runs while scanning, so reaching a terminal status
      // here is by definition the transition — no previous-value tracking.
      if (next.status === "done") {
        setResult({
          kind: "ok",
          text: `${next.probed} probed · ${next.cached} unchanged · ${next.failed} failed`,
        });
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
  const handled = state.probed + state.cached + state.failed;

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={scanning}
        className="shrink-0 rounded-lg bg-foreground px-3 py-1.5 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {scanning ? "Scanning…" : "Scan library"}
      </button>

      {scanning && (
        <Toast tone="busy">
          <p>
            Scanning — {handled} of {state.discovered} files
          </p>
          {state.discovered > 0 && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-foreground/70 transition-[width] duration-300"
                style={{ width: `${(handled / state.discovered) * 100}%` }}
              />
            </div>
          )}
          {state.current && (
            <p className="mt-1.5 truncate font-mono text-xs opacity-45">
              {state.current.split("/").pop()}
            </p>
          )}
        </Toast>
      )}

      {!scanning && result && (
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
