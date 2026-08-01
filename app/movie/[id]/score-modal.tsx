"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  VIDEO_CEILING_BONUS,
  WEIGHTS,
  type Breakdown,
  type ScoreLine,
} from "@/lib/derive";

function LineRow({ line }: { line: ScoreLine }) {
  const full = line.points === line.max;

  return (
    <div className="grid grid-cols-[10rem_1fr_auto] items-baseline gap-4 border-b border-black/5 py-2.5 last:border-0 dark:border-white/5">
      <span className="text-sm opacity-60">{line.label}</span>
      <span className="text-sm">
        {line.detail}
        {line.note && (
          <span className="mt-0.5 block text-xs opacity-50">{line.note}</span>
        )}
      </span>
      <span
        className={`font-mono text-sm tabular-nums ${full ? "" : "opacity-50"}`}
      >
        {line.points}
        <span className="opacity-40">/{line.max}</span>
      </span>
    </div>
  );
}

function Component({
  title,
  weight,
  score,
  lines,
}: {
  title: string;
  weight: number;
  score: number;
  lines: ScoreLine[];
}) {
  const lost = lines.reduce((sum, l) => sum + (l.max - l.points), 0);

  return (
    <div className="rounded-xl border border-black/10 p-5 dark:border-white/10">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-medium">
          {title}
          <span className="ml-2 text-xs opacity-50">
            {Math.round(weight * 100)}% of overall
          </span>
        </h3>
        <span className="text-lg font-semibold tabular-nums">{score}</span>
      </div>

      <div className="mt-3">
        {lines.map((line) => (
          <LineRow key={line.label} line={line} />
        ))}
      </div>

      {lost > 0 && (
        <p className="mt-3 text-xs opacity-50">
          {lost} {lost === 1 ? "point" : "points"} left on the table.
        </p>
      )}
    </div>
  );
}

export function ScoreModal({
  scores,
  breakdown,
}: {
  scores: { video: number; audio: number; release: number; overall: number };
  breakdown: Breakdown;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Positioned against the score card, which is `relative`. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Why this score"
        title="Why this score"
        className="absolute top-3 right-3 grid h-6 w-6 place-items-center rounded-full border border-black/15 text-xs font-medium opacity-40 transition-opacity hover:opacity-100 dark:border-white/20"
      >
        ?
      </button>

      {open &&
        target &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6"
            onClick={() => setOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-black/10 bg-background p-6 shadow-2xl dark:border-white/15"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Why this score</h2>
                  <p className="mt-1 text-sm opacity-60">
                    Each category is scored out of 100 from the criteria below,
                    then blended. The right-hand column shows points awarded
                    against the most that criterion can pay.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="shrink-0 text-sm opacity-50 hover:opacity-100"
                >
                  Close
                </button>
              </div>

              <Component
                title="Video"
                weight={WEIGHTS.video}
                score={scores.video}
                lines={breakdown.video}
              />
              <Component
                title="Audio"
                weight={WEIGHTS.audio}
                score={scores.audio}
                lines={breakdown.audio}
              />
              <Component
                title="Release"
                weight={WEIGHTS.release}
                score={scores.release}
                lines={breakdown.release}
              />

              <div className="rounded-xl border border-black/10 p-5 dark:border-white/10">
                <h3 className="font-medium">Final calculation</h3>
                <div className="mt-3 flex flex-col gap-2 font-mono text-sm">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="opacity-70">
                      {scores.video} × {WEIGHTS.video} + {scores.audio} ×{" "}
                      {WEIGHTS.audio} + {scores.release} × {WEIGHTS.release}
                    </span>
                    <span className="tabular-nums">{breakdown.weighted}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="opacity-70">
                      video ceiling ({scores.video} + {VIDEO_CEILING_BONUS})
                    </span>
                    <span className="tabular-nums">{breakdown.ceiling}</span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-black/10 pt-2 dark:border-white/10">
                    <span>
                      {breakdown.cappedByVideo
                        ? "capped at the ceiling"
                        : "lower of the two"}
                    </span>
                    <span className="text-base font-semibold tabular-nums">
                      {scores.overall}
                    </span>
                  </div>
                </div>

                <p className="mt-3 text-xs opacity-50">
                  {breakdown.cappedByVideo
                    ? `The weighted total reached ${breakdown.weighted}, but strong audio and a clean container cannot lift a file more than ${VIDEO_CEILING_BONUS} points above its picture quality.`
                    : "The ceiling did not bind here — the weighted total was already below it."}
                </p>
              </div>

              <p className="text-sm opacity-60">
                The full rubric, including every threshold, is on the{" "}
                <Link
                  href="/how-it-works"
                  className="underline underline-offset-4"
                >
                  How it works
                </Link>{" "}
                page.
              </p>
            </div>
          </div>,
          target,
        )}
    </>
  );
}
