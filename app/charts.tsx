"use client";

import { useEffect, useState } from "react";

import { count, size } from "@/app/format";
import { stagger } from "@/app/stagger";
import type { Slice } from "@/lib/stats";

/**
 * The shapes numbers are drawn in here.
 *
 * Drawn by hand rather than with a charting library, for the same reason the
 * score rings and the disc meters are: everything in this app is a magnitude
 * against a total, the shapes are four rules wide, and a library would bring
 * its own visual language into an app that already has one.
 *
 * The rules being followed, since they are not obvious from the markup:
 * bars cap at 10px and round only at the data end; gridlines are hairline and
 * recessive; every bar is labelled directly rather than leaning on a legend;
 * and colour is only spent where it carries meaning. Everything else is one
 * ink, because a bar's length already says which is bigger and colouring it by
 * value would spend the identity channel saying it twice.
 *
 * These lived inside the stats page until a second page wanted them. Nothing
 * about them was ever about statistics — they are how this app says "how much",
 * and the stats page was simply the first place that had to.
 */

/**
 * One chart, under its name.
 *
 * Ruled apart rather than boxed, like every other list in this app: a page of
 * cards is a page of frames competing with the bars inside them, and the bars
 * are the only thing here worth drawing.
 */
export function Card({
  title,
  hint,
  index = 0,
  action,
  children,
}: {
  title: string;
  hint?: string;
  /** Its place in the page's arrival order. */
  index?: number;
  /** The one thing this section can do, where there is one. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={stagger(index)} className="row-enter flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {/* The hint says what the section is; the action is what you can do
              about it. A section often wants both, and they share the line's
              right end in that order — the sentence before the verb. */}
          <span className="flex shrink-0 items-baseline gap-3">
            {hint && <span className="text-[11px] opacity-35">{hint}</span>}
            {action}
          </span>
        </div>
        <div aria-hidden className="rule-head" />
      </div>
      {children}
    </section>
  );
}

/** The rings' own clock, from globals.css: --score-fill and the mount delay. */
const FILL_MS = 1400;
const DELAY_MS = 217; // calc(var(--morph) * 0.35), the beat the rings wait

/**
 * cubic-bezier(0.25, 0.55, 0.35, 1) — the same curve `--score-ease` runs.
 *
 * Solved here rather than left to CSS because these figures carry commas,
 * decimals and units, which `counter()` cannot draw: the number has to be
 * formatted on every frame, so the frames have to be ours.
 */
function ease(x: number): number {
  const cx = 3 * 0.25;
  const bx = 3 * (0.35 - 0.25) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * 0.55;
  const by = 3 * (1 - 0.55) - cy;
  const ay = 1 - cy - by;

  // Newton–Raphson on the curve's x(t), then y at that t.
  let t = x;
  for (let i = 0; i < 5; i++) {
    const xt = ((ax * t + bx) * t + cx) * t - x;
    const dx = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(xt) < 1e-4 || dx === 0) break;
    t -= xt / dx;
  }
  return ((ay * t + by) * t + cy) * t;
}

/** A figure counted up from nothing, exactly as a score ring's is. */
export function useCountUp(target: number): number {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    // Without motion the figure simply is its value, as the rings' is.
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let frame: number;
    const start = performance.now() + DELAY_MS;
    const tick = (now: number) => {
      const t = (now - start) / FILL_MS;
      if (reduce || t >= 1) {
        setShown(target);
        return;
      }
      setShown(t <= 0 ? 0 : target * ease(t));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return shown;
}

/**
 * One headline figure.
 *
 * Ruled off rather than boxed: six figures in a row need to be told apart, and
 * a hairline between them does that without drawing six frames. Every figure
 * carries its own rule, the first included — the fade makes a leading one read
 * as the edge of the row rather than as a border round it.
 *
 * Two things vary, and they vary independently.
 *
 * A number counts itself up and a string does not, because the magnitude and
 * its wording have to arrive separately for the count to run through real
 * values: every frame is the formatter's own output, commas, units and all,
 * which the score rings' CSS counter cannot do. A caller that has already
 * decided what the figure says has nothing to count through.
 *
 * And `index` is what makes it arrive at all. A page whose sections come in one
 * after another gives its tiles a place in that order; a band of figures
 * standing above a list is already there when the list is, and animating it
 * would be a second arrival for something that never left.
 */
export function Stat({
  label,
  value,
  format = count,
  gain,
  title,
  index,
}: {
  label: string;
  /** A number counts itself up; a string is already the answer. */
  value: number | string;
  format?: (n: number) => string;
  /** True of the figure a list is ranked by — the one worth the colour. */
  gain?: boolean;
  title?: string;
  /** Its place in the page's arrival order, where the page has one. */
  index?: number;
}) {
  // Called unconditionally and ignored for strings: a hook cannot be skipped,
  // and counting up to nothing costs one state slot.
  const counted = useCountUp(typeof value === "number" ? value : 0);

  return (
    <div
      style={index === undefined ? undefined : stagger(index)}
      className={`rule-l pl-4 ${index === undefined ? "" : "row-enter"}`}
    >
      <p className="text-[11px] tracking-widest uppercase opacity-45">
        {label}
      </p>
      {/* Proportional figures: tabular ones look loose at this size, and
          nothing here has to line up in a column. */}
      {typeof value === "number" ? (
        <>
          {/* The animated frames are decoration; the real figure is there for
              anything that reads rather than watches. */}
          <p
            aria-hidden
            title={title}
            className={`mt-1 font-display text-2xl font-semibold ${
              gain ? "text-emerald-600 dark:text-emerald-400" : ""
            }`}
          >
            {format(Math.round(counted))}
          </p>
          <span className="sr-only">{format(value)}</span>
        </>
      ) : (
        <p
          title={title}
          className={`mt-1 font-display text-2xl font-semibold ${
            gain ? "text-emerald-600 dark:text-emerald-400" : ""
          }`}
        >
          {value}
        </p>
      )}
    </div>
  );
}

/**
 * Horizontal bars, one ink. Scaled to the largest value rather than to the
 * total, so a chart of small shares is still readable.
 */
export function Bars({
  slices,
  showBytes = true,
  unit = "films",
}: {
  slices: Slice[];
  showBytes?: boolean;
  /** What the counts are counting, for the row's own title. */
  unit?: string;
}) {
  const max = Math.max(...slices.map((s) => s.count), 1);

  return (
    <div className="flex flex-col gap-2.5">
      {slices.map((slice, i) => (
        <div
          key={slice.label}
          style={stagger(i)}
          className="grid grid-cols-[9.5rem_1fr_auto] items-center gap-3"
          // The size only where it is drawn: a caller that has decided the
          // bytes are not the point should not have them turn up on hover.
          title={`${slice.label} — ${count(slice.count)} ${unit}${
            showBytes ? `, ${size(slice.bytes)}` : ""
          }`}
        >
          <span className="truncate text-xs opacity-60">{slice.label}</span>

          <span className="h-2.5 rounded-[2px] bg-foreground/[0.06]">
            <span
              className="bar-grow block h-full rounded-r-[4px] bg-foreground/70 motion-safe:transition-[width] motion-safe:duration-500"
              style={{ width: `${(slice.count / max) * 100}%` }}
            />
          </span>

          <span className="w-24 text-right text-xs tabular-nums">
            {count(slice.count)}
            {showBytes && (
              <span className="ml-2 opacity-35">{size(slice.bytes)}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Columns, for the charts whose categories have a natural order. */
export function Columns({
  bars,
  height = 132,
  unit = "films",
  format = count,
}: {
  bars: { label: string; count: number; className?: string }[];
  height?: number;
  /** What the counts are counting, for the column's own title. */
  unit?: string;
  /** How the figure above a column reads, where a raw count is not it. */
  format?: (n: number) => string;
}) {
  const max = Math.max(...bars.map((b) => b.count), 1);

  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {bars.map((bar, i) => (
        <div
          key={bar.label}
          style={stagger(i)}
          className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
          title={`${bar.label} — ${count(bar.count)} ${unit}`}
        >
          <span
            className={`text-xs tabular-nums ${bar.count ? "opacity-70" : "opacity-25"}`}
          >
            {format(bar.count)}
          </span>
          <span
            className={`col-grow w-full rounded-t-[4px] motion-safe:transition-[height] motion-safe:duration-500 ${
              bar.className ?? "bg-foreground/70"
            }`}
            style={{
              // A floor of 2px so an empty bucket still reads as a bucket
              // rather than as a gap in the axis.
              height: Math.max((bar.count / max) * (height - 40), 2),
            }}
          />
          <span className="w-full truncate text-center text-[10px] opacity-45">
            {bar.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Part of a whole, so one bar rather than a pie of three slices. The segments
 * step down a single ink instead of taking three hues: they are not three
 * identities, they are decreasing amounts of what we know about a film.
 *
 * Unless they are. A caller whose categories carry a colour of their own —
 * severities, where red and amber are the app's own vocabulary and already
 * stand for exactly this on the film page — hands its inks in, one per segment
 * in the order they were given. Everything else keeps the single ink, because a
 * hue spent on "identified, no disc" would be a hue that means nothing.
 *
 * The 2px gaps are surface showing through — that is what separates touching
 * segments, rather than a stroke drawn around each one.
 */
export function Coverage({
  segments,
  tones,
  share = true,
}: {
  segments: { label: string; count: number }[];
  /** One background class per segment, where the categories have colours. */
  tones?: string[];
  /**
   * Whether each band prints its share of the whole beside its count.
   *
   * On by default, because that is what a coverage bar is normally for: `/stats`
   * asks how much of the library has been matched, and "1,204" is only an answer
   * next to the percentage that says how much of it that is.
   *
   * Off where the bands are a backlog rather than a census. The dashboard's open
   * issues are three severities of outstanding work, and a share there is the
   * proportion of a number that is itself the thing you want smaller — "62%
   * Info" reads as reassurance about a tally whose whole point is that it should
   * not exist. What matters is how many criticals there are, and the bar already
   * draws the mix.
   */
  share?: boolean;
}) {
  const total = segments.reduce((n, s) => n + s.count, 0) || 1;
  const inks = tones ?? [
    "bg-foreground/70",
    "bg-foreground/30",
    "bg-foreground/[0.12]",
  ];
  const present = segments.filter((s) => s.count > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="bar-grow flex h-2.5 gap-0.5">
        {present.map((segment) => (
          <span
            key={segment.label}
            title={`${segment.label} — ${count(segment.count)}`}
            className={`${inks[segments.indexOf(segment)]} first:rounded-l-[4px] last:rounded-r-[4px] motion-safe:transition-[flex-grow] motion-safe:duration-500`}
            style={{ flexGrow: segment.count }}
          />
        ))}
      </div>

      {/* The bands that are actually in the bar, and only those.

          The legend used to run the whole list and the bar only the non-empty
          part of it, so an empty band was a coloured dot and a label standing
          for a stripe that is not drawn anywhere above it — a key to a chart
          that does not use it. "Critical 0" is also the one line here nobody
          needs: a severity with nothing in it is not a fact about the library,
          it is the absence of one, and a list of outstanding work that spends a
          row saying what is not outstanding is a list you read more slowly.

          Which means an all-zero bar draws nothing at all. That is right: every
          caller decides whether there is anything worth a chart before it asks
          for one — see the dashboard's `filmsAffected > 0`. */}
      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        {present.map((segment) => (
          <span key={segment.label} className="flex items-center gap-2 text-xs">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${inks[segments.indexOf(segment)]}`}
              aria-hidden
            />
            <span className="opacity-60">{segment.label}</span>
            <span className="tabular-nums">{count(segment.count)}</span>
            {share && (
              <span className="opacity-35 tabular-nums">
                {Math.round((segment.count / total) * 100)}%
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
