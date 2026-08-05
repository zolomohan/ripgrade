"use client";

import { useEffect, useState } from "react";

import { Switch } from "@/app/controls";
import { stagger } from "@/app/stagger";
import type { LibraryStats, ShowStats, Slice } from "@/lib/stats";
import type { Status } from "@/lib/derive";

/**
 * The library as numbers.
 *
 * Drawn by hand rather than with a charting library, for the same reason the
 * score rings and the disc meters are: everything here is a magnitude against a
 * total, the shapes are four rules wide, and a library would bring its own
 * visual language into an app that already has one.
 *
 * The rules being followed, since they are not obvious from the markup:
 * bars cap at 10px and round only at the data end; gridlines are hairline and
 * recessive; every bar is labelled directly rather than leaning on a legend;
 * and colour is only spent where it carries meaning — the verdict chart, where
 * the series is good-to-bad. Everything else is one ink, because a bar's length
 * already says which is bigger and colouring it by value would spend the
 * identity channel saying it twice.
 */

const count = (n: number) => n.toLocaleString("en-GB");

const size = (bytes: number) =>
  bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(2)} TB`
    : `${(bytes / 1e9).toFixed(0)} GB`;

/**
 * Verdict colours, validated against both surfaces: worst adjacent pair clears
 * the normal-vision floor and sits in the CVD floor band, which is legal here
 * because every column is also labelled in words underneath.
 */
const VERDICT: Record<Status, string> = {
  "Must Upgrade": "bg-[#dc2626]",
  "Upgrade Recommended": "bg-[#bf8700]",
  Good: "bg-[#bf8700]",
  Excellent: "bg-[#059669]",
  Reference: "bg-[#059669]",
  "Best Available": "bg-[#059669]",
};

/**
 * One chart, under its name.
 *
 * Ruled apart rather than boxed, like every other list in this app: a page of
 * cards is a page of frames competing with the bars inside them, and the bars
 * are the only thing here worth drawing.
 */
function Card({
  title,
  hint,
  index = 0,
  children,
}: {
  title: string;
  hint?: string;
  /** Its place in the page's arrival order. */
  index?: number;
  children: React.ReactNode;
}) {
  return (
    <section style={stagger(index)} className="row-enter flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {hint && <span className="text-[11px] opacity-35">{hint}</span>}
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
function useCountUp(target: number): number {
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
 * The magnitude and its wording arrive separately so the count-up can run
 * through real values: every frame is the formatter's own output, commas,
 * units and all — which the score rings' CSS counter cannot do.
 */
function Stat({
  label,
  value,
  format = count,
  index = 0,
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
  index?: number;
}) {
  const shown = useCountUp(value);

  return (
    <div
      style={stagger(index)}
      className="rule-l row-enter pl-4"
    >
      <p className="text-[11px] tracking-widest uppercase opacity-45">
        {label}
      </p>
      {/* Proportional figures: tabular ones look loose at this size, and
          nothing here has to line up in a column. The animated frames are
          decoration; the real figure is there for anything that reads rather
          than watches. */}
      <p aria-hidden className="mt-1 font-display text-2xl font-semibold">
        {format(Math.round(shown))}
      </p>
      <span className="sr-only">{format(value)}</span>
    </div>
  );
}

/**
 * Horizontal bars, one ink. Scaled to the largest value rather than to the
 * total, so a chart of small shares is still readable.
 */
function Bars({
  slices,
  showBytes = true,
}: {
  slices: Slice[];
  showBytes?: boolean;
}) {
  const max = Math.max(...slices.map((s) => s.count), 1);

  return (
    <div className="flex flex-col gap-2.5">
      {slices.map((slice, i) => (
        <div
          key={slice.label}
          style={stagger(i)}
          className="grid grid-cols-[9.5rem_1fr_auto] items-center gap-3"
          title={`${slice.label} — ${count(slice.count)} films, ${size(slice.bytes)}`}
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

/** Columns, for the two charts whose categories have a natural order. */
function Columns({
  bars,
  height = 132,
}: {
  bars: { label: string; count: number; className?: string }[];
  height?: number;
}) {
  const max = Math.max(...bars.map((b) => b.count), 1);

  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {bars.map((bar, i) => (
        <div
          key={bar.label}
          style={stagger(i)}
          className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
          title={`${bar.label} — ${count(bar.count)} films`}
        >
          <span
            className={`text-xs tabular-nums ${bar.count ? "opacity-70" : "opacity-25"}`}
          >
            {bar.count}
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
 * The 2px gaps are surface showing through — that is what separates touching
 * segments, rather than a stroke drawn around each one.
 */
function Coverage({
  segments,
}: {
  segments: { label: string; count: number }[];
}) {
  const total = segments.reduce((n, s) => n + s.count, 0) || 1;
  const inks = ["bg-foreground/70", "bg-foreground/30", "bg-foreground/[0.12]"];
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

      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        {segments.map((segment, i) => (
          <span key={segment.label} className="flex items-center gap-2 text-xs">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${inks[i]}`}
              aria-hidden
            />
            <span className="opacity-60">{segment.label}</span>
            <span className="tabular-nums">{count(segment.count)}</span>
            <span className="opacity-35 tabular-nums">
              {Math.round((segment.count / total) * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function StatsView({
  stats,
  shows,
}: {
  stats: LibraryStats;
  shows: ShowStats;
}) {
  const [byBytes, setByBytes] = useState(false);
  const [tab, setTab] = useState("movies");
  const { totals } = stats;
  const hasShows = shows.totals.shows > 0;

  const share = (n: number) =>
    totals.films ? `${Math.round((n / totals.films) * 100)}%` : "0%";

  const collections = byBytes
    ? [...stats.collections].sort((a, b) => b.bytes - a.bytes)
    : [...stats.collections].sort((a, b) => b.count - a.count);

  /*
   * Films and television, one at a time.
   *
   * They were one page, and the questions do not meet: an episode has no disc
   * to be measured against, so nothing in the verdict charts can hold one, and
   * "is this complete" is not a question about a file. Two answers stacked read
   * as one long answer, so the switch says which is being asked.
   */
  const films = (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Films" value={totals.films} index={0} />
        <Stat label="Storage" value={totals.bytes} format={size} index={1} />
        <Stat
          label="Runtime"
          value={totals.runtimeHours}
          format={(n) => `${count(n)} h`}
          index={2}
        />
        <Stat label="REMUX" value={totals.remux} format={share} index={3} />
        <Stat
          label="Dolby Vision"
          value={totals.dolbyVision}
          format={share}
          index={4}
        />
        <Stat label="Open issues" value={totals.openIssues} index={5} />
      </div>

      <Card title="Verdicts" hint="against the best disc that exists" index={1}>
        <Columns
          bars={stats.scores.map((s) => ({
            label: s.status,
            count: s.count,
            className: VERDICT[s.status],
          }))}
        />
        {stats.uncompared.total > 0 && (
          // These films are judged on the absolute rubric instead, which is a
          // different scale — so they are stated rather than drawn alongside.
          <p className="text-xs opacity-45">
            {count(stats.uncompared.total)}{" "}
            {stats.uncompared.total === 1 ? "film has" : "films have"} no disc
            to compare against, so{" "}
            {stats.uncompared.total === 1 ? "it is" : "they are"} scored on the
            rubric alone —{" "}
            {stats.uncompared.byStatus
              .map((b) => `${b.count} ${b.status}`)
              .join(", ")}
            .
          </p>
        )}
      </Card>

      <Card title="Disc comparison" hint="what the verdicts rest on" index={2}>
        <Coverage segments={stats.discCoverage} />
      </Card>

      <div className="grid gap-10 lg:grid-cols-2">
        <Card title="Resolution" index={3}>
          <Bars slices={stats.resolution} />
        </Card>

        <Card title="Dynamic range" index={4}>
          <Bars slices={stats.hdr} />
        </Card>

        <Card title="Release type" index={5}>
          <Bars slices={stats.release} />
        </Card>

        <Card
          title="Dolby Vision profiles"
          hint="Profile 7 split by layer"
          index={6}
        >
          {stats.dolbyVision.length > 0 ? (
            <Bars slices={stats.dolbyVision} />
          ) : (
            <p className="text-sm opacity-45">
              No Dolby Vision films in the library.
            </p>
          )}
        </Card>
      </div>

      <Card title="By decade" index={7}>
        {stats.decades.length > 0 ? (
          <Columns
            bars={stats.decades.map((d) => ({
              label: d.label,
              count: d.count,
            }))}
          />
        ) : (
          <p className="text-sm opacity-45">No years known yet.</p>
        )}
      </Card>

      <Card
        title="Biggest collections"
        hint={`top ${stats.collections.length}`}
        index={8}
      >
        <div className="flex flex-col gap-4">
          <div className="flex gap-1 text-xs">
            {[
              { key: false, label: "By films" },
              { key: true, label: "By storage" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setByBytes(option.key)}
                className={`glow rounded-full px-2.5 py-1 transition-colors ${
                  byBytes === option.key
                    ? "bg-surface-strong font-medium"
                    : "opacity-50 hover:opacity-100"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {collections.length > 0 ? (
            <Bars slices={collections} />
          ) : (
            <p className="text-sm opacity-45">
              No collections yet — they come from TMDb when a film is matched.
            </p>
          )}
        </div>
      </Card>
    </>
  );

  const television = (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Shows" value={shows.totals.shows} index={0} />
        <Stat label="Episodes" value={shows.totals.episodes} index={1} />
        <Stat
          label="Storage"
          value={shows.totals.bytes}
          format={size}
          index={2}
        />
        <Stat
          label="Runtime"
          value={shows.totals.runtimeHours}
          format={(n) => `${count(n)} h`}
          index={3}
        />
        <Stat
          label="Average"
          value={shows.totals.averageScore}
          format={String}
          index={4}
        />
        <Stat label="Missing" value={shows.totals.missing} index={5} />
      </div>

      <Card
        title="Completeness"
        hint="counted only where TMDb knows the season length"
        index={1}
      >
        <Columns
          bars={shows.completeness.map((c) => ({
            label: c.label,
            count: c.count,
            className:
              c.label === "Complete" ? "bg-emerald-500/70" : "bg-amber-500/70",
          }))}
        />
      </Card>

      <div className="grid gap-10 lg:grid-cols-2">
        <Card title="Resolution" hint="per episode" index={2}>
          <Bars slices={shows.resolution} />
        </Card>

        <Card title="Dynamic range" hint="per episode" index={3}>
          <Bars slices={shows.hdr} />
        </Card>

        <Card title="Release type" hint="per episode" index={4}>
          <Bars slices={shows.release} />
        </Card>

        <Card title="Largest shows" hint="by episodes held" index={5}>
          <Bars slices={shows.biggest} />
        </Card>
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-10">
      {hasShows && (
        <Switch
          value={tab}
          onChange={setTab}
          options={[
            { key: "movies", label: "Films" },
            { key: "tv", label: "Shows" },
          ]}
        />
      )}

      {/* Keyed, so switching remounts the charts and they draw themselves
          again — the arrival is how a chart is read here, and a tab that
          swapped in a finished one would be the only still thing on the page. */}
      <div key={tab} className="flex flex-col gap-10">
        {tab === "tv" && hasShows ? television : films}
      </div>
    </div>
  );
}
