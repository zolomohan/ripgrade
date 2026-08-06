"use client";

import { CONTROL_H } from "./controls";
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
      // The shelf row's height, so it sits level with the switch and the bar
      // it shares a line with rather than floating inside it.
      className={`flex ${CONTROL_H} shrink-0 items-center gap-2 rounded-full bg-foreground px-4 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-40`}
    >
      {/* The same glass as the search field: this is the other way of looking
          for films, one that reads the drive rather than the shelf. */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
        className="h-3.5 w-3.5"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      {label}
    </button>
  );
}
