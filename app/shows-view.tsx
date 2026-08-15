"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ViewTransition } from "react";

import { openIssues } from "@/lib/derive";
import { posterName, showId } from "@/lib/routes";
import type { Show } from "@/lib/shows";
import { Art } from "./art";
import { Bar, BarSearch, HelpTip, ICONS, MenuItem, Popover } from "./controls";
import { ScoreBadge } from "./score-circle";
import { useEntrance } from "./return-to";
import { stagger } from "./stagger";

/**
 * The shelf of shows. A show is a poster and three numbers — how much of it
 * there is, and how good it is on average — with everything per-episode a
 * click away on its own page.
 *
 * Filtered the same way films are and on different things: a show has no single
 * resolution or verdict, so the questions worth asking of one are about what
 * runs through all of its episodes, and about the gaps.
 */
const size = (bytes: number) =>
  bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(2)} TB`
    : `${(bytes / 1e9).toFixed(1)} GB`;

/** Every episode of a show, which is what most of the facets ask about. */
const episodesOf = (show: Show) => show.seasons.flatMap((s) => s.episodes);

const missing = (show: Show) =>
  show.seasons.reduce(
    (n, s) => n + (s.total === undefined ? 0 : s.missing.length),
    0,
  );

const issuesOf = (show: Show) =>
  episodesOf(show).reduce((n, e) => n + openIssues(e.item).length, 0);

/**
 * A property is claimed for a show when every episode has it — "Dolby Vision"
 * on a show where one episode is SDR would be a lie, and the one episode that
 * breaks the run is exactly what you are looking for.
 */
const all = (
  show: Show,
  test: (episode: Show["seasons"][number]["episodes"][number]) => boolean,
) => episodesOf(show).every(test);

const any = (
  show: Show,
  test: (episode: Show["seasons"][number]["episodes"][number]) => boolean,
) => episodesOf(show).some(test);

const FACETS: {
  key: string;
  label: string;
  options: { key: string; label: string; test: (show: Show) => boolean }[];
}[] = [
  {
    key: "resolution",
    label: "Resolution",
    options: [
      {
        key: "res-2160p",
        label: "2160p",
        test: (s) => all(s, (e) => e.item.resolution === "2160p"),
      },
      {
        key: "res-1080p",
        label: "1080p",
        test: (s) => all(s, (e) => e.item.resolution === "1080p"),
      },
      {
        key: "res-mixed",
        label: "Mixed",
        test: (s) =>
          new Set(episodesOf(s).map((e) => e.item.resolution)).size > 1,
      },
    ],
  },
  {
    key: "hdr",
    label: "Dynamic range",
    options: [
      {
        key: "dv",
        label: "Dolby Vision",
        test: (s) => any(s, (e) => e.item.hdr === "Dolby Vision"),
      },
      {
        key: "hdr10",
        label: "HDR10",
        test: (s) => any(s, (e) => e.item.hdr === "HDR10"),
      },
      {
        key: "sdr",
        label: "SDR",
        test: (s) => all(s, (e) => e.item.hdr === "SDR"),
      },
    ],
  },
  {
    key: "source",
    label: "Source",
    options: [
      {
        key: "remux",
        label: "REMUX",
        test: (s) => all(s, (e) => e.item.releaseType === "REMUX"),
      },
      {
        key: "web",
        label: "WEB-DL",
        test: (s) => all(s, (e) => e.item.releaseType === "WEB-DL"),
      },
      {
        key: "encode",
        label: "Encode",
        test: (s) => any(s, (e) => e.item.releaseType === "ENCODE"),
      },
    ],
  },
  {
    key: "state",
    label: "State",
    options: [
      {
        key: "incomplete",
        label: "Missing episodes",
        test: (s) => missing(s) > 0,
      },
      { key: "issues", label: "Has issues", test: (s) => issuesOf(s) > 0 },
      {
        key: "unmatched",
        label: "Not identified",
        test: (s) => !s.tmdb || s.tmdb.confidence !== "high",
      },
    ],
  },
];

const OPTIONS = new Map(
  FACETS.flatMap((facet) =>
    facet.options.map((option) => [option.key, option]),
  ),
);

/** off → include → exclude → off, as in the film filters. */
type Selection = Map<string, "include" | "exclude">;

function parseSelection(raw: string): Selection {
  const selection: Selection = new Map();
  for (const token of raw.split(",").filter(Boolean)) {
    const exclude = token.startsWith("-");
    const key = exclude ? token.slice(1) : token;
    if (OPTIONS.has(key)) selection.set(key, exclude ? "exclude" : "include");
  }
  return selection;
}

const serialiseSelection = (selection: Selection) =>
  [...selection.entries()].map(([key, mode]) =>
    mode === "exclude" ? `-${key}` : key,
  );

/** Options within a row are OR-ed; rows are AND-ed. Exclusions always win. */
function matches(show: Show, selection: Selection): boolean {
  for (const [key, mode] of selection) {
    if (mode === "exclude" && OPTIONS.get(key)!.test(show)) return false;
  }

  for (const facet of FACETS) {
    const included = facet.options.filter(
      (option) => selection.get(option.key) === "include",
    );
    if (included.length && !included.some((option) => option.test(show))) {
      return false;
    }
  }

  return true;
}

const SORTS: {
  key: string;
  label: string;
  compare: (a: Show, b: Show) => number;
}[] = [
  // Worst first by default: the shelf is a to-do list before it is a catalogue,
  // and the show most worth doing something about should not need a sort to be
  // seen.
  { key: "worst", label: "Lowest score", compare: (a, b) => a.score - b.score },
  {
    key: "title",
    label: "Title A–Z",
    compare: (a, b) => a.title.localeCompare(b.title),
  },
  { key: "score", label: "Score", compare: (a, b) => b.score - a.score },
  {
    key: "episodes",
    label: "Most episodes",
    compare: (a, b) => b.episodeCount - a.episodeCount,
  },
  {
    key: "size",
    label: "Largest",
    compare: (a, b) => b.sizeBytes - a.sizeBytes,
  },
  {
    key: "gaps",
    label: "Most missing",
    compare: (a, b) => missing(b) - missing(a),
  },
];

export function ShowsView({
  shows,
  tabs,
}: {
  shows: Show[];
  /** The shelf switch, at the head of this shelf's own row of controls. */
  tabs: React.ReactNode;
}) {
  // Its own keys in the URL: the films tab already owns q/f/sort, and one set
  // shared between the two would filter a shelf by controls it never saw.
  const searchParams = useSearchParams();
  const rawFilters = searchParams.get("tf") ?? "";
  const selection = parseSelection(rawFilters);
  const query = searchParams.get("tq") ?? "";
  const sort = searchParams.get("tsort") ?? SORTS[0].key;

  function update(next: { tf?: string[]; tq?: string; tsort?: string }) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.tf !== undefined) {
      if (next.tf.length) params.set("tf", next.tf.join(","));
      else params.delete("tf");
    }
    if (next.tq !== undefined) {
      if (next.tq) params.set("tq", next.tq);
      else params.delete("tq");
    }
    if (next.tsort !== undefined) {
      if (next.tsort !== SORTS[0].key) params.set("tsort", next.tsort);
      else params.delete("tsort");
    }

    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  function cycle(key: string) {
    const next: Selection = new Map(selection);
    const mode = next.get(key);
    if (mode === undefined) next.set(key, "include");
    else if (mode === "include") next.set(key, "exclude");
    else next.delete(key);
    update({ tf: serialiseSelection(next) });
  }

  function clear(key: string) {
    const next: Selection = new Map(selection);
    next.delete(key);
    update({ tf: serialiseSelection(next) });
  }

  const shown = (() => {
    const q = query.trim().toLowerCase();
    const compare = (SORTS.find((s) => s.key === sort) ?? SORTS[0]).compare;

    return shows
      .filter((show) => matches(show, selection))
      .filter((show) => !q || show.title.toLowerCase().includes(q))
      .sort(compare);
  })();

  if (shows.length === 0) {
    // The switch still has to be there — it is the way back to the films, and
    // an empty shelf is exactly when you want it.
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">{tabs}</div>

        <div className="rounded-card border border-line bg-surface px-4 py-12 text-center">
          <p className="text-sm opacity-50">
            No shows found. Episodes are recognised by their filenames —
            S01E02, 1x02, or a Season folder.
          </p>
        </div>
      </div>
    );
  }

  const episodes = shown.reduce((n, s) => n + s.episodeCount, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* One line: which shelf on the left, what to do with this one on the
          right. */}
      <div className="flex flex-wrap items-center gap-3">
        {tabs}

        {/* All the room the switch leaves: this bar carries a field, and a
            field squeezed to its label is a field you cannot read what you
            typed in. */}
        <div className="ml-auto flex min-w-0 flex-1 items-center gap-3">
          <Bar className="min-w-0 flex-1">
            <BarSearch
              value={query}
              onChange={(next) => update({ tq: next })}
              placeholder="Search shows…"
            />

            <Popover
              icon={ICONS.filter}
              label="Filters"
              badge={selection.size}
              width="w-[min(92vw,30rem)]"
            >
              {() => (
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-display text-sm font-semibold">
                      Filters
                    </span>
                    <HelpTip text="Click once to include, twice to exclude. Options in a row are OR-ed; rows are AND-ed. A format is claimed only when every episode has it." />
                  </div>

                  {FACETS.map((facet) => (
                    <div key={facet.key} className="flex flex-col gap-1.5">
                      <span className="text-[11px] tracking-widest uppercase opacity-40">
                        {facet.label}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {facet.options.map((option) => {
                          const mode = selection.get(option.key);
                          return (
                            <button
                              key={option.key}
                              type="button"
                              aria-pressed={mode !== undefined}
                              title={
                                mode === "include"
                                  ? "Click to exclude"
                                  : mode === "exclude"
                                    ? "Click to clear"
                                    : "Click to include"
                              }
                              onClick={() => cycle(option.key)}
                              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                                mode === "include"
                                  ? "border-transparent bg-foreground text-background"
                                  : mode === "exclude"
                                    ? "border-red-500/40 bg-red-500/[0.08] text-red-700 line-through dark:text-red-300"
                                    : "border-line hover:bg-surface-strong"
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {selection.size > 0 && (
                    <button
                      type="button"
                      onClick={() => update({ tf: [] })}
                      className="self-start text-[11px] underline underline-offset-4 opacity-50 hover:opacity-100"
                    >
                      Clear all filters
                    </button>
                  )}
                </div>
              )}
            </Popover>

            <Popover
              icon={ICONS.sort}
              label="Sort"
              value={(SORTS.find((o) => o.key === sort) ?? SORTS[0]).label}
            >
              {(close) => (
                <div className="py-1">
                  {SORTS.map((option) => (
                    <MenuItem
                      key={option.key}
                      active={option.key === sort}
                      onClick={() => {
                        update({ tsort: option.key });
                        close();
                      }}
                    >
                      {option.label}
                    </MenuItem>
                  ))}
                </div>
              )}
            </Popover>
          </Bar>
        </div>
      </div>

      {/* What is filtering the shelf, and a way to drop each one, out where it
          cannot hide behind a button. */}
      {selection.size > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {[...selection.entries()].map(([key, mode]) => (
            <button
              key={key}
              type="button"
              onClick={() => clear(key)}
              title="Remove this filter"
              className={`row-enter flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                mode === "include"
                  ? "border-transparent bg-foreground text-background"
                  : "border-red-500/40 bg-red-500/[0.08] text-red-700 dark:text-red-300"
              }`}
            >
              {mode === "exclude" && <span className="opacity-60">not</span>}
              {OPTIONS.get(key)!.label}
              <span className="opacity-50">✕</span>
            </button>
          ))}

          <button
            type="button"
            onClick={() => update({ tf: [], tq: "" })}
            className="text-[11px] underline underline-offset-4 opacity-50 hover:opacity-100"
          >
            Reset
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-card border border-line bg-surface px-4 py-12 text-center">
          <p className="text-sm opacity-50">Nothing matches those filters.</p>
          <button
            type="button"
            onClick={() => update({ tf: [], tq: "" })}
            className="mt-2 text-sm underline underline-offset-4 opacity-60 hover:opacity-100"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6 pt-13 sm:grid-cols-3 lg:grid-cols-5">
          {shown.map((show, i) => (
            <ShowTile key={show.key} show={show} index={i} />
          ))}
        </div>
      )}

      {/* A total reads as a total at the foot of what it counts; above the
          shelf it was just another line between the controls and the posters. */}
      {shown.length > 0 && (
        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-4 text-xs opacity-45">
          <p>
            {shown.length === shows.length
              ? `${shows.length} ${shows.length === 1 ? "show" : "shows"}`
              : `${shown.length} of ${shows.length} shows`}{" "}
            · {episodes} episodes
          </p>
          <p>{size(shown.reduce((n, s) => n + s.sizeBytes, 0))}</p>
        </div>
      )}
    </div>
  );
}

/** One show on the shelf. Split out so it can hold its own entrance decision. */
function ShowTile({ show, index }: { show: Show; index: number }) {
  const entrance = useEntrance();
  return (
    <Link
      href={`/show/${showId(show.key)}`}
      style={stagger(index)}
      className={`${entrance} group flex flex-col gap-2`}
    >
      <ViewTransition name={posterName(show.key)} share="morph" default="none">
        <div className="glow glow-over tilt relative aspect-[2/3] overflow-hidden rounded-card bg-surface-strong ring-1 ring-line">
          <Art
            src={show.poster}
            remote={show.art.poster}
            version={show.artAt}
            loading="lazy"
            className="h-full w-full object-cover"
          />
          {/* The shelf's badge, from the one place it is drawn — this was its
              own copy of the library's markup, down to the class list. */}
          <span className="absolute top-2 right-2">
            <ScoreBadge
              score={show.score}
              title={`${show.score} of 100 · average of ${show.episodeCount} episodes`}
            />
          </span>

          {/* What is wrong with the show, on the show: a gap in a season
                    and a flawed file are both reasons to open it, and both
                    belong where the eye already is. */}
          <div className="absolute bottom-2 left-2 flex flex-wrap items-center gap-1">
            {/* Only once TMDb has told us how long each season runs —
                      before that the count would be gaps in the numbering,
                      which reads as a stronger claim than it is. */}
            {missing(show) > 0 && (
              <span className="rounded-chip bg-background/85 px-1.5 text-[10px] leading-[18px] font-medium text-amber-700 backdrop-blur dark:text-amber-300">
                {missing(show)} missing
              </span>
            )}
            {issuesOf(show) > 0 && (
              <span className="rounded-chip bg-background/85 px-1.5 text-[10px] leading-[18px] font-medium text-amber-700 backdrop-blur dark:text-amber-300">
                {issuesOf(show)} {issuesOf(show) === 1 ? "issue" : "issues"}
              </span>
            )}
          </div>
        </div>
      </ViewTransition>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={show.title}>
          {show.title}
        </p>
        <p className="truncate text-[11px] opacity-45">
          {show.seasons.length}{" "}
          {show.seasons.length === 1 ? "season" : "seasons"} ·{" "}
          {show.episodeCount} episodes
        </p>
      </div>
    </Link>
  );
}
