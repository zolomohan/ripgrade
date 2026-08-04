import Link from "next/link";

import {
  VIDEO_CEILING_BONUS,
  WEIGHTS,
  type Breakdown,
  type ScoreLine,
} from "@/lib/derive";

/**
 * How the number on the ring was arrived at, line by line.
 *
 * It was a dialog behind a "?" in the corner of the score card — a footnote you
 * had to find, which then took the whole screen to answer. As a panel at the
 * foot of the page it is the same reading in the same order as everything else
 * here: shut it is one line, open it is the arithmetic.
 *
 * No state and no dialog, so no "use client": it is the page's own markup now.
 */

const RULE =
  "h-px shrink-0 bg-gradient-to-r from-transparent via-line-strong to-transparent";

function LineRow({ line }: { line: ScoreLine }) {
  const full = line.points === line.max;

  return (
    <div className="grid grid-cols-[10rem_1fr_auto] items-baseline gap-4 py-2">
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
    <section className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-medium">
          {title}
          <span className="ml-2 text-xs opacity-50">
            {Math.round(weight * 100)}% of overall
          </span>
        </h3>
        <span className="font-score text-lg font-semibold tabular-nums">
          {score}
        </span>
      </div>

      <div className="mt-1">
        {lines.map((line) => (
          <LineRow key={line.label} line={line} />
        ))}
      </div>

      {lost > 0 && (
        <p className="text-xs opacity-50">
          {lost} {lost === 1 ? "point" : "points"} left on the table.
        </p>
      )}
    </section>
  );
}

export function ScoreBreakdown({
  scores,
  breakdown,
}: {
  scores: { video: number; audio: number; release: number; overall: number };
  breakdown: Breakdown;
}) {
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm opacity-60">
        Each category is scored out of 100 from the criteria below, then
        blended. The right-hand column shows points awarded against the most
        that criterion can pay.
      </p>

      <Component
        title="Video"
        weight={WEIGHTS.video}
        score={scores.video}
        lines={breakdown.video}
      />
      <div aria-hidden className={RULE} />

      <Component
        title="Audio"
        weight={WEIGHTS.audio}
        score={scores.audio}
        lines={breakdown.audio}
      />
      <div aria-hidden className={RULE} />

      <Component
        title="Release"
        weight={WEIGHTS.release}
        score={scores.release}
        lines={breakdown.release}
      />
      <div aria-hidden className={RULE} />

      <section className="flex flex-col gap-1">
        <h3 className="font-medium">Final calculation</h3>
        {breakdown.relative && (
          <p className="text-sm opacity-60">
            Scored against the best disc that exists for this film, not against
            an abstract ideal — so a flawless copy of a modest release is still
            a 100.
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
                <span className="opacity-70">the disc on the same rubric</span>
                <span className="tabular-nums">{breakdown.discScore}</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-4">
                <span>
                  {breakdown.absolute} ÷ {breakdown.discScore} of the disc
                </span>
                <span className="font-score text-base font-semibold tabular-nums">
                  {scores.overall}
                </span>
              </div>
            </>
          ) : (
            <div className="mt-2 flex items-baseline justify-between gap-4">
              <span>no disc data — scored on the rubric alone</span>
              <span className="font-score text-base font-semibold tabular-nums">
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
      </section>

      <p className="text-sm opacity-60">
        The full rubric, including every threshold, is on the{" "}
        <Link href="/how-it-works" className="underline underline-offset-4">
          How it works
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
