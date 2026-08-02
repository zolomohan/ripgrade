"use client";

import { useState } from "react";

import type { LibraryStats, Slice } from "@/lib/stats";
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

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[11px] font-medium tracking-widest uppercase opacity-45">
          {title}
        </h2>
        {hint && <span className="text-[11px] opacity-35">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <p className="text-[11px] tracking-widest uppercase opacity-45">
        {label}
      </p>
      {/* Proportional figures: tabular ones look loose at this size, and
          nothing here has to line up in a column. */}
      <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
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
      {slices.map((slice) => (
        <div
          key={slice.label}
          className="grid grid-cols-[9.5rem_1fr_auto] items-center gap-3"
          title={`${slice.label} — ${count(slice.count)} films, ${size(slice.bytes)}`}
        >
          <span className="truncate text-xs opacity-60">{slice.label}</span>

          <span className="h-2.5 rounded-[2px] bg-foreground/[0.06]">
            <span
              className="block h-full rounded-r-[4px] bg-foreground/70 motion-safe:transition-[width] motion-safe:duration-500"
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
      {bars.map((bar) => (
        <div
          key={bar.label}
          className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
          title={`${bar.label} — ${count(bar.count)} films`}
        >
          <span
            className={`text-xs tabular-nums ${bar.count ? "opacity-70" : "opacity-25"}`}
          >
            {bar.count}
          </span>
          <span
            className={`w-full rounded-t-[4px] motion-safe:transition-[height] motion-safe:duration-500 ${
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
function Coverage({ segments }: { segments: { label: string; count: number }[] }) {
  const total = segments.reduce((n, s) => n + s.count, 0) || 1;
  const inks = ["bg-foreground/70", "bg-foreground/30", "bg-foreground/[0.12]"];
  const present = segments.filter((s) => s.count > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-2.5 gap-0.5">
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

export function StatsView({ stats }: { stats: LibraryStats }) {
  const [byBytes, setByBytes] = useState(false);
  const { totals } = stats;

  const share = (n: number) =>
    totals.films ? `${Math.round((n / totals.films) * 100)}%` : "0%";

  const collections = byBytes
    ? [...stats.collections].sort((a, b) => b.bytes - a.bytes)
    : [...stats.collections].sort((a, b) => b.count - a.count);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Films" value={count(totals.films)} />
        <Stat label="Storage" value={size(totals.bytes)} />
        <Stat label="Runtime" value={`${count(totals.runtimeHours)} h`} />
        <Stat label="REMUX" value={share(totals.remux)} />
        <Stat label="Dolby Vision" value={share(totals.dolbyVision)} />
        <Stat label="Open issues" value={count(totals.openIssues)} />
      </div>

      <Card title="Verdicts" hint="against the best disc that exists">
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
          <p className="border-t border-line pt-3 text-xs opacity-45">
            {count(stats.uncompared.total)}{" "}
            {stats.uncompared.total === 1 ? "film has" : "films have"} no disc to
            compare against, so {stats.uncompared.total === 1 ? "it is" : "they are"}{" "}
            scored on the rubric alone —{" "}
            {stats.uncompared.byStatus
              .map((b) => `${b.count} ${b.status}`)
              .join(", ")}
            .
          </p>
        )}
      </Card>

      <Card title="Disc comparison" hint="what the verdicts rest on">
        <Coverage segments={stats.discCoverage} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Resolution">
          <Bars slices={stats.resolution} />
        </Card>

        <Card title="Dynamic range">
          <Bars slices={stats.hdr} />
        </Card>

        <Card title="Release type">
          <Bars slices={stats.release} />
        </Card>

        <Card title="Dolby Vision profiles" hint="Profile 7 split by layer">
          {stats.dolbyVision.length > 0 ? (
            <Bars slices={stats.dolbyVision} />
          ) : (
            <p className="text-sm opacity-45">
              No Dolby Vision films in the library.
            </p>
          )}
        </Card>
      </div>

      <Card title="By decade">
        {stats.decades.length > 0 ? (
          <Columns bars={stats.decades.map((d) => ({ label: d.label, count: d.count }))} />
        ) : (
          <p className="text-sm opacity-45">No years known yet.</p>
        )}
      </Card>

      <Card title="Biggest collections" hint={`top ${stats.collections.length}`}>
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
                className={`rounded-control px-2.5 py-1 transition-colors ${
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
    </div>
  );
}
