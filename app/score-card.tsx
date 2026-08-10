import type { CSSProperties } from "react";

/** One size for both rings — the two scores are peers, not headline and aside. */
const RING_BOX = "h-28 w-28";

export function ScoreRing({
  score,
  ring,
  caption,
  ceiling,
}: {
  score: number;
  ring: string;
  caption: string;
  /** The best disc, drawn as a ghost arc behind the score. */
  ceiling?: number;
}) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const short = ceiling !== undefined && score < ceiling;
  const arc = (value: number) => circumference * (1 - value / 100);

  return (
    <div
      className={`relative grid ${RING_BOX} shrink-0 place-items-center`}
      title={short ? `${score} of a possible ${ceiling}` : undefined}
    >
      <svg viewBox="0 0 120 120" className={`${RING_BOX} -rotate-90`}>
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          className="stroke-line"
        />
        {/* How far the best disc reaches — the same mark the meters carry,
            drawn here as an arc rather than a tick. */}
        {ceiling !== undefined && ceiling < 100 && (
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={arc(ceiling)}
            className="stroke-foreground/20"
          />
        )}
        {/* The arc is drawn from empty to the score rather than appearing at
            it: `--ring` is the whole circumference, which is what an empty ring
            offsets by, and the stylesheet animates from there down to the
            offset set here. */}
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={arc(score)}
          style={{ "--ring": circumference } as CSSProperties}
          className={`score-arc ${
            ceiling === undefined
              ? ring
              : short
                ? "stroke-amber-500/80"
                : "stroke-emerald-500/80"
          }`}
        />
      </svg>
      <div className="absolute text-center">
        {/* The figure counts up with the arc. It is drawn by a CSS counter, so
            the thing being animated is a number rather than a string — which
            means it is generated content, and no use to a screen reader. The
            real score sits beside it, read rather than watched. */}
        <span
          aria-hidden
          style={{ "--count": score } as CSSProperties}
          className="score-count inline-block min-w-[2ch] font-score text-3xl font-semibold tabular-nums"
        />
        <span className="sr-only">{score}</span>
        <span className="block text-[8px] tracking-widest uppercase opacity-50">
          {caption}
        </span>
      </div>
    </div>
  );
}

/**
 * A meter with the disc marked on it.
 *
 * The ceiling used to be a single number in a footnote, which said nothing
 * about where the shortfall actually was. Marking each dimension shows it
 * directly: a bar short of its mark is the thing you could buy your way out of,
 * and a bar past its mark is where your copy beats the disc.
 */
/** Below this share of the disc, a picture or sound shortfall is not a nuance. */
const SEVERE_SHORTFALL = 0.8;

export function SubScore({
  label,
  value,
  ceiling,
  escalates,
}: {
  label: string;
  value: number;
  ceiling?: number;
  /** Video and audio go red when far short; release only ever goes amber. */
  escalates?: boolean;
}) {
  const short = ceiling !== undefined && value < ceiling;
  const severe =
    escalates && ceiling !== undefined && value / ceiling < SEVERE_SHORTFALL;

  return (
    <div className="flex items-center gap-4">
      <span className="w-16 shrink-0 text-[11px] tracking-widest uppercase opacity-45">
        {label}
      </span>

      <span className="relative h-1.5 flex-1 rounded-full bg-surface-strong">
        <span
          className={`score-bar absolute inset-y-0 left-0 rounded-full ${
            ceiling === undefined
              ? "bg-foreground/55"
              : severe
                ? "bg-red-500/75"
                : short
                  ? "bg-amber-500/70"
                  : "bg-emerald-500/70"
          }`}
          style={{ width: `${value}%` }}
        />
        {ceiling !== undefined && (
          // Centred on its value rather than starting at it, which also keeps
          // the mark on the track at 100 instead of hanging off the end.
          <span
            aria-hidden
            title={`Best available: ${ceiling}`}
            className="absolute -top-[5px] h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
            style={{ left: `${ceiling}%` }}
          />
        )}
      </span>

      <span className="w-14 shrink-0 text-right font-score text-sm font-semibold tabular-nums">
        {value}
        {short && (
          <span className="font-sans text-xs font-normal opacity-40">
            /{ceiling}
          </span>
        )}
      </span>
    </div>
  );
}
