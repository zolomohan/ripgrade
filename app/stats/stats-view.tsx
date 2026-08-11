"use client";

import { useState } from "react";

import { Bars, Card, Columns, Coverage, Stat } from "@/app/charts";
import { Switch } from "@/app/controls";
import { count, size } from "@/app/format";
import type { LibraryStats, ShowStats } from "@/lib/stats";
import type { Status } from "@/lib/derive";

/**
 * The library as numbers.
 *
 * The shapes are in `app/charts.tsx` — they were here first, and stopped being
 * this page's the moment a second page asked "how much". What stays is the one
 * thing that is genuinely about statistics: which colours a verdict is allowed
 * to take, and the order the questions are asked in.
 */

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
          className="-ml-2"
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
