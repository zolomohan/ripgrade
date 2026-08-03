"use client";

import { useState, useTransition } from "react";

import { identifyArtworkSources } from "@/app/actions";

/**
 * Working out where the artwork already on the drive came from.
 *
 * A one-off: anything downloaded from here on records its source as it is
 * saved. This is for everything that was already there, and it only needs
 * running once — the answers are kept.
 */
export function IdentifyArtwork({ pending }: { pending: number }) {
  const [result, setResult] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function run() {
    setResult(null);
    startTransition(async () => {
      const outcome = await identifyArtworkSources();
      setResult(
        outcome.ok
          ? outcome.exact + outcome.approximate === 0
            ? "Nothing new to identify."
            : `${outcome.exact} identified exactly, ${outcome.approximate} matched approximately, ${outcome.unknown} could not be placed.`
          : outcome.error,
      );
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={busy || pending === 0}
          className="rounded-control border border-line px-3 py-1.5 text-sm transition-colors hover:bg-surface-strong disabled:opacity-40"
        >
          {busy ? "Reading the drive…" : "Identify artwork"}
        </button>

        <span className="text-xs opacity-45">
          {pending === 0
            ? "Every image on the drive is accounted for."
            : `${pending} image${pending === 1 ? "" : "s"} with no known source`}
        </span>
      </div>

      {result && <p className="text-sm opacity-70">{result}</p>}
    </div>
  );
}
