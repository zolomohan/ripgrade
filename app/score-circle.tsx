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
 * The ring is the score and its colour is the verdict — a film can be red at 66
 * and green at 66, and the arc shows how far round it has actually got.
 */
export function ScoreCircle({ movie }: { movie: LibraryItem }) {
  const theme = STATUS_THEME[movie.status];
  const radius = 18;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className="relative grid h-11 w-11 shrink-0 place-items-center"
      title={`${movie.status} · ${movie.scores.overall} of 100`}
    >
      <svg viewBox="0 0 44 44" className="absolute h-11 w-11 -rotate-90">
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
          strokeDashoffset={circumference * (1 - movie.scores.overall / 100)}
          className={theme.stroke}
        />
      </svg>
      <span
        aria-hidden
        className={`relative font-display text-sm font-semibold tabular-nums ${theme.text}`}
      >
        {movie.scores.overall}
      </span>
      <span className="sr-only">
        {movie.status}, score {movie.scores.overall} of 100
      </span>
    </div>
  );
}
