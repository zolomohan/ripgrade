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
