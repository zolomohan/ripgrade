"use client";

import { useScan } from "./scan-provider";

/**
 * Just the trigger — progress and results are rendered by the provider in the
 * root layout, so they survive navigating away from this page.
 */
export function ScanButton() {
  const { state, start, busy } = useScan();

  const label =
    state.status === "scanning"
      ? "Scanning…"
      : state.status === "dovi"
        ? "Dolby Vision…"
        : state.status === "matching"
          ? "Matching…"
          : state.status === "discs"
            ? "Discs…"
            : "Scan library";

  return (
    <button
      type="button"
      onClick={start}
      disabled={busy}
      className="shrink-0 rounded-control bg-foreground px-3 py-1.5 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      {label}
    </button>
  );
}
