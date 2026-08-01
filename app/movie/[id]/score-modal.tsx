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
    <div className="grid grid-cols-[10rem_1fr_auto] items-baseline gap-4 border-b border-line py-2.5 last:border-0">
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
    <div className="rounded-card border border-line bg-surface p-5">
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
        className="absolute right-3 bottom-3 grid h-6 w-6 place-items-center rounded-full border border-line text-xs font-medium opacity-40 transition-opacity hover:opacity-100"
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
              className="flex w-full max-w-2xl flex-col gap-4 rounded-card border border-line bg-background p-6 shadow-2xl"
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

              <div className="rounded-card border border-line bg-surface p-5">
                <h3 className="font-medium">Final calculation</h3>
                {breakdown.relative && (
                  <p className="mt-1 text-sm opacity-60">
                    Scored against the best disc that exists for this film, not
                    against an abstract ideal — so a flawless copy of a modest
                    release is still a 100.
                  </p>
                )}
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
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="opacity-70">
                      {breakdown.cappedByVideo
                        ? "capped at the ceiling"
                        : "lower of the two"}
                    </span>
                    <span className="tabular-nums">{breakdown.absolute}</span>
                  </div>

                  {breakdown.relative && breakdown.discScore ? (
                    <>
                      <div className="flex items-baseline justify-between gap-4">
                        <span className="opacity-70">
                          the disc on the same rubric
                        </span>
                        <span className="tabular-nums">
                          {breakdown.discScore}
                        </span>
                      </div>
                      <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line pt-2">
                        <span>
                          {breakdown.absolute} ÷ {breakdown.discScore} of the
                          disc
                        </span>
                        <span className="text-base font-semibold tabular-nums">
                          {scores.overall}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line pt-2">
                      <span>no disc data — scored on the rubric alone</span>
                      <span className="text-base font-semibold tabular-nums">
                        {scores.overall}
                      </span>
                    </div>
                  )}
                </div>

                <p className="mt-3 text-xs opacity-50">
                  {scores.overall === 100 && breakdown.relative
                    ? "This copy is as good as the best release available, so there is nothing to upgrade to."
                    : breakdown.cappedByVideo
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
