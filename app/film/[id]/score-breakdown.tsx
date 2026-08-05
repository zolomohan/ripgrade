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
 *
 * Each criterion is a meter rather than a bare fraction: 20/25 has to be
 * computed to be read, a bar four-fifths full is read at a glance — and a
 * short bar is amber because a short bar is precisely what "upgrade
 * recommended" means everywhere else in the app. The bars are static: this
 * lives in a <details>, where a mount animation would have played while shut.
 */

const RULE =
  "h-px shrink-0 bg-gradient-to-r from-transparent via-line-strong to-transparent";

function LineRow({ line }: { line: ScoreLine }) {
  const full = line.points === line.max;

  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="min-w-0 truncate text-sm">
          <span className="opacity-50">{line.label}</span>
          <span aria-hidden className="mx-2 opacity-30">
            ·
          </span>
          {line.detail}
        </span>
        <span
          className={`shrink-0 font-mono text-xs tabular-nums ${
            full ? "" : "opacity-50"
          }`}
        >
          {line.points}
          <span className="opacity-40">/{line.max}</span>
        </span>
      </div>

      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-strong">
        <div
          className={`h-full rounded-full ${
            full ? "bg-foreground/45" : "bg-amber-500/70"
          }`}
          style={{ width: `${(line.points / line.max) * 100}%` }}
        />
      </div>
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

  /* The ways back to those points, gathered from the lines that carry one.
     They used to sit as a subtitle under each row, which made every shortfall
     twice the height of a full mark and scattered the same message down the
     section — collected here, the total says how much and the list says how. */
  const notes = lines
    .map((line) => line.note)
    .filter((note): note is string => Boolean(note));

  return (
    <section className="flex flex-col">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-medium">
          {title}
          <span className="ml-2 text-xs font-normal opacity-50">
            {Math.round(weight * 100)}% of overall
          </span>
        </h3>
        <span className="font-score text-lg font-semibold tabular-nums">
          {score}
        </span>
      </div>

      <div className="mt-2">
        {lines.map((line) => (
          <LineRow key={line.label} line={line} />
        ))}
      </div>

      {/* On its own quiet surface, so the section ends with a verdict rather
          than trailing off — how many points are missing, and the way to each
          of them. */}
      {lost > 0 && (
        <div className="mt-3 rounded-card bg-surface px-4 py-3 text-xs">
          <p className="flex items-baseline justify-between gap-4">
            <span className="tracking-wide uppercase opacity-45">
              Left on the table
            </span>
            <span className="font-mono tabular-nums opacity-60">−{lost}</span>
          </p>
          {notes.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 opacity-70">
              {notes.map((note) => (
                <li key={note} className="flex gap-2">
                  <span className="opacity-40">—</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** One step of the final arithmetic: what happened in words, the working in
    mono underneath, the result on the right. */
function Step({
  label,
  working,
  value,
}: {
  label: string;
  working?: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {working && (
          <span className="mt-0.5 block font-mono text-xs opacity-45">
            {working}
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-sm tabular-nums">{value}</span>
    </div>
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
        blended. A full bar is a criterion at its maximum; an amber one is
        where the points went.
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

        {/* The same arithmetic that was one line of formula soup, told a step
            at a time: what each number is in words, how it was made in mono
            underneath, and the figure it produced on the right. */}
        <div className="mt-2 flex flex-col divide-y divide-line">
          <Step
            label="The three, blended"
            working={`${scores.video} × ${WEIGHTS.video} + ${scores.audio} × ${WEIGHTS.audio} + ${scores.release} × ${WEIGHTS.release}`}
            value={breakdown.weighted}
          />
          <Step
            label="Video ceiling"
            working={`picture quality ${scores.video} + ${VIDEO_CEILING_BONUS}`}
            value={breakdown.ceiling}
          />
          <Step
            label={
              breakdown.cappedByVideo
                ? "Capped at the ceiling — sound cannot outscore the picture"
                : "Lower of the two — the ceiling did not bind"
            }
            value={breakdown.absolute}
          />

          {breakdown.relative && breakdown.discScore ? (
            <>
              <Step
                label="The best disc, on the same rubric"
                value={breakdown.discScore}
              />
              <div className="flex items-center justify-between gap-4 pt-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    This copy, as a share of that disc
                  </span>
                  <span className="mt-0.5 block font-mono text-xs opacity-45">
                    {breakdown.absolute} ÷ {breakdown.discScore}
                  </span>
                </span>
                <span className="shrink-0 font-score text-xl font-semibold tabular-nums">
                  {scores.overall}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-4 pt-3">
              <span className="block text-sm font-medium">
                No disc data — scored on the rubric alone
              </span>
              <span className="shrink-0 font-score text-xl font-semibold tabular-nums">
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
