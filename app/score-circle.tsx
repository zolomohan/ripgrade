import { STATUS_BANDS } from "@/lib/derive";
import type { LibraryItem } from "@/lib/library";

// Tailwind needs literal class names, so each status carries its own palette.
/**
 * Three states, three colours. The five statuses collapse to the only question
 * that matters in a list: is there anything to do about this film?
 */
export const STATUS_THEME: Record<string, { stroke: string; text: string }> = {
  "Best Available": {
    stroke: "stroke-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  Reference: {
    stroke: "stroke-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  Excellent: {
    stroke: "stroke-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  Good: {
    stroke: "stroke-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  "Upgrade Recommended": {
    stroke: "stroke-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  "Must Upgrade": {
    stroke: "stroke-red-500",
    text: "text-red-600 dark:text-red-400",
  },
};

/**
 * The same colours by score alone, for things that have a score but no status.
 * A show is an average of its episodes and never carries a verdict of its own,
 * but its badge should not read differently from a film's at the same number.
 */
export const scoreTheme = (score: number) =>
  STATUS_THEME[
    STATUS_BANDS.find((band) => score >= band.min)?.status ?? "Must Upgrade"
  ];

/**
 * The queue's rule, which is not the library's.
 *
 * There the dial grades a film you own, so the number decides it and a 92 is
 * green. On the queue it grades a job — a release to go and fetch — and one
 * that would still leave the film short of its best is an open job however
 * high it scores. Green is kept for the ones that close the question, so the
 * finals can be picked out without reading a single number.
 *
 * Shared by both tabs: an upgrade and a want are read the same way when they
 * are both things you might download tonight.
 */
export const queueTheme = (score: number) =>
  score >= 100 ? STATUS_THEME.Reference : STATUS_THEME.Good;

/**
 * A score as a ring: the number in the middle, the arc showing how far round it
 * got, and the colour carrying the verdict — a film can be red at 66 and green
 * at 66 depending on what it is being measured against.
 *
 * Takes a bare number rather than a film, so anything scored on the rubric can
 * be drawn the same way. An indexer result has no status of its own, and a
 * predicted 94 should look exactly like a measured one.
 */
export function ScoreDial({
  score,
  theme = scoreTheme(score),
  title,
  srLabel,
  size = 44,
}: {
  score: number;
  /** Overridden where a status, not the number, decides the colour. */
  theme?: { stroke: string; text: string };
  title?: string;
  srLabel?: string;
  size?: number;
}) {
  // Drawn in the viewBox's own units and scaled by the box, so one geometry
  // serves every size the app asks for.
  const radius = 18;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      title={title ?? `${score} of 100`}
    >
      <svg viewBox="0 0 44 44" className="absolute h-full w-full -rotate-90">
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          strokeWidth="3"
          className="stroke-line"
        />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={
            circumference * (1 - Math.max(0, Math.min(100, score)) / 100)
          }
          className={theme.stroke}
        />
      </svg>
      <span
        aria-hidden
        className={`relative font-score font-semibold tabular-nums ${theme.text}`}
        style={{ fontSize: size * 0.32 }}
      >
        {score}
      </span>
      <span className="sr-only">{srLabel ?? `Score ${score} of 100`}</span>
    </div>
  );
}

/**
 * The same score as a plate, which is what a poster wears.
 *
 * The library has read this way from the beginning: two digits in the top-right
 * corner, in the verdict's colour, on the frosted plate that is the one thing
 * this app allows over artwork — see app/poster-tile.tsx, where the rule is
 * written down. The shows shelf drew the same badge from its own copy of the
 * markup, and the queue drew a forty-pixel ring on a white disc instead, so
 * three shelves of posters reported three different-looking numbers on the same
 * hundred-point scale.
 *
 * This is that badge, once. The colour still comes from the caller, because
 * what a number means is the shelf's own business — the library grades a film,
 * the queue grades a job, and `queueTheme` says why they disagree.
 *
 * Sized for the corner and nothing else. Where a score is the subject rather
 * than a mark on a picture — a film's own page, a release read whole — the ring
 * is still the right drawing, and `ScoreDial` above is still it.
 */
/**
 * The plate itself, for the few figures that stand beside a score rather than
 * being one.
 *
 * The queue's gain is the case: `+11` belongs next to the 94 it is part of, and
 * a chip in the caption font pinned to a pill in the score face reads as two
 * unrelated marks that happen to touch. Same shape, same weight, same numerals —
 * only the colour is its own, because green there means "this much better"
 * rather than "good enough".
 *
 * Exported as the classes rather than as a component: what goes on it is not a
 * score, so `ScoreBadge` cannot draw it without pretending otherwise.
 */
const PLATE_FACE =
  "rounded-full bg-background/85 font-score text-[11px] font-semibold tabular-nums backdrop-blur";

export const SCORE_PLATE = `${PLATE_FACE} px-1.5 py-0.5`;

/**
 * The same plate with room around what it holds, for a figure that is not two
 * digits.
 *
 * A score is always 0 to 100 and the tight plate was cut to fit it. "12.5 GB"
 * is three times as wide with a space and a unit in it, and at the same
 * padding it reads as a label crammed into a badge rather than a figure set on
 * one. Written as a second size rather than a padding tacked on at the point of
 * use, because two padding utilities on one element are settled by the order
 * Tailwind happens to emit them in and not by which was written last.
 */
export const SCORE_PLATE_ROOMY = `${PLATE_FACE} px-2 py-1`;

export function ScoreBadge({
  score,
  theme = scoreTheme(score),
  title,
  srLabel,
}: {
  score: number;
  /** Overridden where a status, or a list's own rule, decides the colour. */
  theme?: { stroke: string; text: string };
  title?: string;
  /**
   * What the number means, where the number alone does not say. Given one, the
   * digits are hidden from a screen reader and this is read instead — the same
   * trade `ScoreDial` makes, so "94" is never announced without its scale.
   */
  srLabel?: string;
}) {
  return (
    <span
      className={`${SCORE_PLATE} ${theme.text}`}
      title={title ?? `${score} of 100`}
    >
      <span aria-hidden={srLabel ? true : undefined}>{score}</span>
      {srLabel && <span className="sr-only">{srLabel}</span>}
    </span>
  );
}

/** The same ring for a film, where the verdict rather than the number colours it. */
export function ScoreCircle({ movie }: { movie: LibraryItem }) {
  return (
    <ScoreDial
      score={movie.scores.overall}
      theme={STATUS_THEME[movie.status]}
      title={`${movie.status} · ${movie.scores.overall} of 100`}
      srLabel={`${movie.status}, score ${movie.scores.overall} of 100`}
    />
  );
}
