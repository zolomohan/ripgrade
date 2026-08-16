"use client";

import { useState } from "react";

import { Bars, Card, Columns, Coverage, Stat } from "@/app/charts";
import { Switch } from "@/app/controls";
import { count, size } from "@/app/format";
import {
  TOP_LIMIT,
  type LibraryStats,
  type ShowStats,
  type Slice,
} from "@/lib/stats";
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

/**
 * The same inks for the same verdict asked of a whole show.
 *
 * Two reds, for the reason there are two ambers and two greens above: the
 * columns are grouped by what you would do about them, not spread across a
 * spectrum, and every column is labelled in words underneath. A gap in a season
 * and a file that must be replaced are both "act on this".
 *
 * The last one is deliberately not a verdict colour. "Not compared" is the
 * absence of a reading rather than a poor one, and giving it a hue would let a
 * library nobody owns discs for read as a library in trouble.
 */
const SHOW_VERDICT: Record<string, string> = {
  "Missing episodes": "bg-[#dc2626]",
  "Must upgrade": "bg-[#dc2626]",
  "Upgrade recommended": "bg-[#bf8700]",
  "Best available": "bg-[#059669]",
  "Not compared to a disc": "bg-foreground/25",
};

/**
 * The two-way switch a card puts in its own heading — By films / By storage,
 * By episode / By show. Three cards wanted one, and the first of them had it
 * inlined in its body, which put a control below the title it belongs to.
 */
function Pills<T extends string | boolean>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { key: T; label: string }[];
}) {
  return (
    <span className="flex gap-1 text-xs">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          onClick={() => onChange(option.key)}
          className={`glow rounded-full px-2.5 py-1 transition-colors ${
            value === option.key
              ? "bg-surface-strong font-medium"
              : "opacity-50 hover:opacity-100"
          }`}
        >
          {option.label}
        </button>
      ))}
    </span>
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
  const [showsByBytes, setShowsByBytes] = useState(false);
  /** Whether the television verdict chart counts episodes or whole shows. */
  const [verdictScope, setVerdictScope] = useState<"episode" | "show">(
    "episode",
  );
  const [tab, setTab] = useState("movies");
  const { totals } = stats;
  const hasShows = shows.totals.shows > 0;

  const share = (n: number) =>
    totals.films ? `${Math.round((n / totals.films) * 100)}%` : "0%";

  const episodeShare = (n: number) =>
    shows.totals.episodes
      ? `${Math.round((n / shows.totals.episodes) * 100)}%`
      : "0%";

  /*
   * Both "biggest" lists arrive holding the top rows by either measure, so the
   * cut to eight happens here — after the reader has said which measure they
   * are ranking by. See `topEither`.
   */
  const rank = (slices: Slice[], bytes: boolean) =>
    [...slices]
      .sort((a, b) => (bytes ? b.bytes - a.bytes : b.count - a.count))
      .slice(0, TOP_LIMIT);

  const collections = rank(stats.collections, byBytes);
  const biggest = rank(shows.biggest, showsByBytes);

  /** How many episodes the verdict chart has anything to say about. */
  const comparedEpisodes = shows.scores.reduce((n, s) => n + s.count, 0);

  /*
   * Films and television, one at a time.
   *
   * They were one page, and the questions do not meet: "is this complete" is
   * not a question about a file, and a decade or a collection is not a question
   * about a show. Two answers stacked read as one long answer, so the switch
   * says which is being asked.
   *
   * The verdict is the one question both sides answer, and for a while only one
   * side was asked it — on the belief that an episode has no disc behind it.
   * It has: the scanner looks up the season set. So both tabs now open on the
   * same chart, drawn the same way, and the shelf they came from groups by the
   * same word.
   */
  const films = (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-12 sm:grid-cols-3 lg:grid-cols-6">
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
        <Stat
          label="Open issues"
          value={totals.openIssues}
          // The other honest reading of the same label, which is what the two
          // tabs used to disagree about. See `issueTotals`.
          title={`across ${count(totals.withIssues)} ${
            totals.withIssues === 1 ? "film" : "films"
          }`}
          index={5}
        />
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

      <Card
        title="Quality comparison"
        hint="where each ceiling came from"
        index={2}
      >
        <Coverage segments={stats.qualityCoverage} />
        {stats.uncomparedReasons.length > 0 && (
          // The bar says how many have no ceiling; this says why, and the two
          // answers have different fixes — one is a disc that was never
          // pressed, the other a film the scan could not name.
          <p className="text-xs opacity-45">
            Of those with none,{" "}
            {stats.uncomparedReasons
              .map((r) => `${count(r.count)} ${r.label.toLowerCase()}`)
              .join(", ")}
            .
          </p>
        )}
      </Card>

      <div className="grid gap-x-10 gap-y-18 lg:grid-cols-2">
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
        hint={`top ${collections.length}`}
        action={
          <Pills
            value={byBytes}
            onChange={setByBytes}
            options={[
              { key: false, label: "By films" },
              { key: true, label: "By storage" },
            ]}
          />
        }
        index={8}
      >
        {collections.length > 0 ? (
          <Bars slices={collections} />
        ) : (
          <p className="text-sm opacity-45">
            No collections yet — they come from TMDb when a film is matched.
          </p>
        )}
      </Card>
    </>
  );

  const television = (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-12 sm:grid-cols-3 lg:grid-cols-6">
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
        <Stat
          label="Atmos"
          value={shows.totals.atmos}
          format={episodeShare}
          index={6}
        />
        <Stat
          label="Lossless"
          value={shows.totals.lossless}
          format={episodeShare}
          index={7}
        />
        {/* The figure this row computed and never printed. Same meaning as the
            films' tile now, and the same second reading on hover. */}
        <Stat
          label="Open issues"
          value={shows.totals.openIssues}
          title={`across ${count(shows.totals.withIssues)} ${
            shows.totals.withIssues === 1 ? "episode" : "episodes"
          }`}
          index={8}
        />
      </div>

      <Card
        title="Verdicts"
        hint={
          verdictScope === "episode"
            ? "per episode, against the best disc set that exists"
            : "per show, the worst thing true of it"
        }
        action={
          <Pills
            value={verdictScope}
            onChange={setVerdictScope}
            options={[
              { key: "episode" as const, label: "By episode" },
              { key: "show" as const, label: "By show" },
            ]}
          />
        }
        index={1}
      >
        {/* Two subjects, one question. By episode is the films' chart exactly —
            same inks, same worst-to-best order, same scale — because an episode
            is a file with a disc behind it like any other. By show is the shelf:
            `/library` groups its shows tab by these five buckets, so this is the
            census of the sections you actually scroll past.

            The episode chart is drawn only when something is on it. Season sets
            are far rarer than film discs, and four empty columns read as a
            finding rather than as an absence. The show chart always has
            something: "Not compared to a disc" is one of its buckets. */}
        {verdictScope === "show" ? (
          <Columns
            unit="shows"
            bars={shows.showVerdicts.map((v) => ({
              label: v.label,
              count: v.count,
              className: SHOW_VERDICT[v.label],
            }))}
          />
        ) : comparedEpisodes > 0 ? (
          <Columns
            unit="episodes"
            bars={shows.scores.map((s) => ({
              label: s.status,
              count: s.count,
              className: VERDICT[s.status],
            }))}
          />
        ) : (
          <p className="text-sm opacity-45">
            No season has a disc release behind it yet, so there is nothing to
            rank episodes against. A scan looks them up on Blu-ray.com.
          </p>
        )}

        {verdictScope === "episode" && shows.uncompared.total > 0 && (
          // As on the films tab: these are judged on the absolute rubric, which
          // is a different scale, so they are stated rather than drawn beside.
          <p className="text-xs opacity-45">
            {count(shows.uncompared.total)}{" "}
            {shows.uncompared.total === 1 ? "episode has" : "episodes have"} no
            season set to compare against, so{" "}
            {shows.uncompared.total === 1 ? "it is" : "they are"} scored on the
            rubric alone —{" "}
            {shows.uncompared.byStatus
              .map((b) => `${b.count} ${b.status}`)
              .join(", ")}
            .
          </p>
        )}
      </Card>

      <div className="grid gap-x-10 gap-y-18 lg:grid-cols-2">
        <Card title="Season sets" hint="where each ceiling came from" index={2}>
          <Coverage segments={shows.discCoverage} />
          {shows.discReasons.length > 0 && (
            // The films' card draws the same line under the same bar: the bar
            // says how many seasons have no ceiling, and this says why, because
            // a set that was never pressed and a show the scan could not name
            // are two problems with two different fixes.
            <p className="text-xs opacity-45">
              Of those with none,{" "}
              {shows.discReasons
                .map((r) => `${count(r.count)} ${r.label.toLowerCase()}`)
                .join(", ")}
              .
            </p>
          )}
        </Card>

        <Card title="Identified" hint="per show, on TMDb" index={3}>
          <Coverage segments={shows.matchCoverage} />
          {/* Worth more here than on a film. An unmatched film is a film with
              no poster; an unmatched show has no season lengths behind it, so
              it contributes nothing to the Missing figure above and every
              completeness answer on this page quietly excludes it. */}
          <p className="text-xs opacity-45">
            A show nobody has identified has no season lengths, so nothing above
            counts it as short of anything.
          </p>
        </Card>
      </div>

      <div className="grid gap-x-10 gap-y-18 lg:grid-cols-2">
        <Card
          title="Completeness"
          hint="counted only where TMDb knows the season length"
          index={4}
        >
          <Columns
            unit="shows"
            bars={shows.completeness.map((c) => ({
              label: c.label,
              count: c.count,
              className:
                c.label === "Complete"
                  ? "bg-emerald-500/70"
                  : "bg-amber-500/70",
            }))}
          />
        </Card>

        <Card
          title="Consistency"
          hint="shows whose episodes disagree"
          index={5}
        >
          {/* The one question that is television's alone: a film cannot change
              resolution halfway through. A run that does is a real piece of
              work — one season ripped from somewhere else — and the shelf
              already has a "Mixed" bucket waiting for it. */}
          {shows.mixed.some((m) => m.count > 0) ? (
            <Bars
              slices={shows.mixed.map((m) => ({ ...m, bytes: 0 }))}
              showBytes={false}
              unit="shows"
            />
          ) : (
            <p className="text-sm opacity-45">
              Every show is one resolution, one dynamic range and one release
              type the whole way through.
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-x-10 gap-y-18 lg:grid-cols-2">
        <Card title="Resolution" hint="per episode" index={6}>
          <Bars slices={shows.resolution} unit="episodes" />
        </Card>

        <Card title="Dynamic range" hint="per episode" index={7}>
          <Bars slices={shows.hdr} unit="episodes" />
        </Card>

        <Card title="Release type" hint="per episode" index={8}>
          <Bars slices={shows.release} unit="episodes" />
        </Card>

        <Card
          title="Largest shows"
          hint={`top ${biggest.length}`}
          action={
            <Pills
              value={showsByBytes}
              onChange={setShowsByBytes}
              options={[
                { key: false, label: "By episodes" },
                { key: true, label: "By storage" },
              ]}
            />
          }
          index={9}
        >
          <Bars slices={biggest} unit="episodes" />
        </Card>
      </div>

      <Card title="By decade" hint="when the series first aired" index={10}>
        {shows.decades.length > 0 ? (
          <Columns
            unit="shows"
            bars={shows.decades.map((d) => ({
              label: d.label,
              count: d.count,
            }))}
          />
        ) : (
          <p className="text-sm opacity-45">
            No years known yet — they come from TMDb when a show is matched.
          </p>
        )}
      </Card>

      <Card
        title="Episodes held"
        hint="first seen by a scan, not when you acquired it"
        index={11}
      >
        {/* Cumulative rather than what arrived each month, for the reason
            `computeGrowth` gives: the question is how big the library got, and
            a chart of monthly additions is mostly zero with two spikes in it —
            more so for television, which arrives forty at a time. */}
        <Columns
          unit="episodes"
          bars={shows.growth.map((b) => ({
            label: b.label,
            count: b.cumulativeCount,
          }))}
        />
      </Card>
    </>
  );

  return (
    // The switch stands 2rem above what it switches, as every page's head
    // does. Its sections keep their own, much larger, rhythm below.
    <div className="flex flex-col gap-8">
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
          swapped in a finished one would be the only still thing on the page.

          Sections stand further apart than anything inside one. A chart is a
          heading, a hairline and a stack of bars, and at the old spacing the
          distance between two sections was near enough the distance between a
          section's own parts that the page read as one long list of bars with
          words in it. Paired cards keep the tighter gap across the column
          split: they are side by side because they answer the same question,
          and the eye should cross that gap sooner than it drops to the next.

          Past the app's usual 14, deliberately. This page is nothing but
          sections — a dozen of them on the shows tab, each one a heading over a
          shape — where the pages that set that rhythm are mostly one list under
          one heading. The same gap that separates two sections there has a
          dozen chances to be misread here. */}
      <div key={tab} className="flex flex-col gap-18">
        {tab === "tv" && hasShows ? television : films}
      </div>
    </div>
  );
}
