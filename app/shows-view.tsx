"use client";

import { useSearchParams } from "next/navigation";

import { openIssues } from "@/lib/derive";
import type { LibraryItem } from "@/lib/library";
import { posterName, showId } from "@/lib/routes";
import {
  SHOW_VERDICT_ORDER,
  episodesOf,
  shared,
  showGaps as missing,
  showVerdict,
} from "@/lib/show-verdict";
import type { Show } from "@/lib/shows";
import { Bar, HelpTip, ICONS, MenuItem, Popover } from "./controls";
import { EmptyState } from "./empty-state";
import { PosterTile, TILE_GRID } from "./poster-tile";
import { ScoreBadge } from "./score-circle";
import { ShelfTotal } from "./shelf-total";
import { size } from "./format";

/**
 * The shelf of shows. A show is a poster and three numbers — how much of it
 * there is, and how good it is on average — with everything per-episode a
 * click away on its own page.
 *
 * Filtered the same way films are and on different things: a show has no single
 * resolution or verdict, so the questions worth asking of one are about what
 * runs through all of its episodes, and about the gaps.
 *
 * "The same way" is meant literally, and for a while it was not. This shelf and
 * the film shelf are two tabs of one switch, and they disagreed about nearly
 * every part of filtering: this one carried a search field the films tab had
 * dropped, echoed its active filters as a row of chips the films tab had
 * deliberately stopped drawing, and put its clear-all at the foot of the panel
 * where the films tab had moved it up beside the heading. One switch, one
 * gesture, two answers — which reads as two shelves borrowed from two apps.
 *
 * The film shelf's answers won, all three. The field went because finding one
 * title by name is ⌘F's job on this page and every other; the chips went
 * because the count on the Filters button and the filled options inside it
 * already say what is narrowing the list; and Reset went up to the heading,
 * where the way out of a set of filters is what you look at when you open the
 * panel rather than what you scroll to. What this shelf gained in exchange is
 * the one control it was missing — a Group menu, so a shelf of shows can be cut
 * the way a shelf of films can.
 */

const issuesOf = (show: Show) =>
  episodesOf(show).reduce((n, e) => n + openIssues(e).length, 0);

/**
 * A property is claimed for a show when every episode has it — "Dolby Vision"
 * on a show where one episode is SDR would be a lie, and the one episode that
 * breaks the run is exactly what you are looking for.
 */
const all = (show: Show, test: (episode: LibraryItem) => boolean) =>
  episodesOf(show).every(test);

const any = (show: Show, test: (episode: LibraryItem) => boolean) =>
  episodesOf(show).some(test);

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
        test: (s) => all(s, (e) => e.resolution === "2160p"),
      },
      {
        key: "res-1080p",
        label: "1080p",
        test: (s) => all(s, (e) => e.resolution === "1080p"),
      },
      {
        key: "res-mixed",
        label: "Mixed",
        test: (s) => new Set(episodesOf(s).map((e) => e.resolution)).size > 1,
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
        test: (s) => any(s, (e) => e.hdr === "Dolby Vision"),
      },
      {
        key: "hdr10",
        label: "HDR10",
        test: (s) => any(s, (e) => e.hdr === "HDR10"),
      },
      {
        key: "sdr",
        label: "SDR",
        test: (s) => all(s, (e) => e.hdr === "SDR"),
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
        test: (s) => all(s, (e) => e.releaseType === "REMUX"),
      },
      {
        key: "web",
        label: "WEB-DL",
        test: (s) => all(s, (e) => e.releaseType === "WEB-DL"),
      },
      {
        key: "encode",
        label: "Encode",
        test: (s) => any(s, (e) => e.releaseType === "ENCODE"),
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

/**
 * How the shelf can be cut, mirroring the film shelf's own menu.
 *
 * The first is the default, and it is the same cut the films default to, by the
 * same name: what needs doing rather than an attribute to sort on. It used to
 * be a shelf-local "State" — missing / has issues / complete — which answered a
 * narrower question in vocabulary this app uses nowhere else, so the two tabs
 * of one switch grouped by two different ideas of what is wrong with something.
 * Verdict is the app's word, and it says more: a complete show whose every
 * episode wants upgrading was "Complete" before, which is true and useless.
 *
 * The verdict itself is `lib/show-verdict.ts` rather than a rule of this file:
 * `/stats` counts the same buckets, and a verdict computed in two places is a
 * verdict that will eventually be computed two ways.
 */
const GROUPS: {
  key: string;
  label: string;
  of: (show: Show) => string;
  /** Fixed order for the buckets; anything unlisted sorts alphabetically after. */
  order?: string[];
}[] = [
  {
    key: "verdict",
    label: "Verdict",
    of: showVerdict,
    order: [...SHOW_VERDICT_ORDER],
  },
  {
    key: "resolution",
    label: "Resolution",
    of: (show) => shared(show, (episode) => episode.resolution),
    order: ["2160p", "1080p", "720p", "SD", "Mixed", "Unknown"],
  },
  {
    key: "release",
    label: "Release type",
    of: (show) => shared(show, (episode) => episode.releaseType),
    order: ["REMUX", "WEB-DL", "ENCODE", "UNKNOWN", "Mixed", "Unknown"],
  },
  {
    key: "hdr",
    label: "Dynamic range",
    of: (show) => shared(show, (episode) => episode.hdr),
    order: ["Dolby Vision", "HDR10+", "HDR10", "SDR", "Mixed", "Unknown"],
  },
  { key: "none", label: "No grouping", of: () => "" },
];

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
  action,
}: {
  shows: Show[];
  /** The shelf switch, at the head of this shelf's own row of controls. */
  tabs: React.ReactNode;
  /** The page's own control, at the end of the row — see app/library-tabs.tsx. */
  action?: React.ReactNode;
}) {
  // Its own keys in the URL: the films tab already owns f/sort/g, and one set
  // shared between the two would filter a shelf by controls it never saw.
  const searchParams = useSearchParams();
  const rawFilters = searchParams.get("tf") ?? "";
  const selection = parseSelection(rawFilters);
  const sort = searchParams.get("tsort") ?? SORTS[0].key;
  const group = searchParams.get("tg") ?? GROUPS[0].key;

  function update(next: { tf?: string[]; tsort?: string; tg?: string }) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.tf !== undefined) {
      if (next.tf.length) params.set("tf", next.tf.join(","));
      else params.delete("tf");
    }
    // Defaults are omitted so a plain /library?t=tv stays clean.
    if (next.tsort !== undefined) {
      if (next.tsort !== SORTS[0].key) params.set("tsort", next.tsort);
      else params.delete("tsort");
    }
    if (next.tg !== undefined) {
      if (next.tg !== GROUPS[0].key) params.set("tg", next.tg);
      else params.delete("tg");
    }

    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  /** off → include → exclude → off, as in the film filters. */
  function cycle(key: string) {
    const next: Selection = new Map(selection);
    const mode = next.get(key);
    if (mode === undefined) next.set(key, "include");
    else if (mode === "include") next.set(key, "exclude");
    else next.delete(key);
    update({ tf: serialiseSelection(next) });
  }

  const shown = (() => {
    const compare = (SORTS.find((s) => s.key === sort) ?? SORTS[0]).compare;
    return shows.filter((show) => matches(show, selection)).sort(compare);
  })();

  const grouping = GROUPS.find((g) => g.key === group) ?? GROUPS[0];

  // Buckets follow the group's declared order; anything unlisted trails it
  // alphabetically — the film shelf's rule, because it is the same shelf.
  const buckets: [string, Show[]][] = (() => {
    if (grouping.key === "none") return [];

    const map = new Map<string, Show[]>();
    for (const show of shown) {
      const name = grouping.of(show);
      const bucket = map.get(name);
      if (bucket) bucket.push(show);
      else map.set(name, [show]);
    }

    const order = grouping.order ?? [];
    return [...map.entries()].sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1)
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.localeCompare(b);
    });
  })();

  if (shows.length === 0) {
    // The switch still has to be there — it is the way back to the films, and
    // an empty shelf is exactly when you want it.
    return (
      <div className="flex flex-col gap-6">
        <div className="mb-2 flex flex-wrap items-center gap-3">{tabs}</div>

        <EmptyState
          icon={
            <>
              <rect x="2.5" y="6" width="19" height="13" rx="2" />
              <path d="m8 3 4 3 4-3" />
            </>
          }
          title="No shows found"
        >
          Episodes are recognised by their filenames — S01E02, 1x02, or a Season
          folder.
        </EmptyState>
      </div>
    );
  }

  const episodes = shown.reduce((n, s) => n + s.episodeCount, 0);

  return (
    <div className="flex flex-col gap-6">
      {/* One line: which shelf on the left, what to do with this one on the
          right — and the same three controls in the same bar the films tab
          draws them in. The bar is only as wide as its controls now: with the
          field gone there is nothing to stretch, and a bar drawn the width of
          the page with three buttons huddled at one end is mostly frame. */}
      {/* `mb-2` on top of the column's own gap-6: the shelf's head stands 2rem
          above the shelf, which is what every page's head stands above its
          content. The column stays at 24 because it is also what parts one
          bucket of the shelf from the next, and those are not heads. */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        {tabs}

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Bar>
            <Popover
              icon={ICONS.filter}
              label="Filters"
              badge={selection.size}
              width="w-[min(92vw,30rem)]"
              // The bar's first slot, so the fill follows its rounded end.
              buttonClassName="rounded-l-full"
            >
              {() => (
                /* The film shelf's spacing, for the reason given there: the two
                   tabs open the same panel, and a Shows filter packed tighter
                   than a Films one is a difference nobody chose. */
                <div className="flex flex-col gap-5 p-4">
                  {/* Heading over the same fading hairline every other head in
                      the app stands on, so the panel's title is a title here
                      too and not just the first line of the list. */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-display text-sm font-semibold">
                        Filters
                      </span>

                      {/* Up here with the heading rather than trailing the last
                          row of options: the way out of a set of filters should
                          be where you look when you open the panel, not at the
                          end of a scroll through them. Shaped like the ? beside
                          it so the two read as one pair of panel controls. */}
                      <div className="flex items-center gap-2">
                        {selection.size > 0 && (
                          <button
                            type="button"
                            onClick={() => update({ tf: [] })}
                            title="Clear every filter"
                            className="h-5 rounded-full border border-line px-2 text-[10px] font-medium opacity-40 transition-opacity hover:opacity-100"
                          >
                            Reset
                          </button>
                        )}
                        <HelpTip text="Click once to include, twice to exclude. Options in a row are OR-ed; rows are AND-ed. A format is claimed only when every episode has it." />
                      </div>
                    </div>

                    <div aria-hidden className="rule-head" />
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

            <Popover
              icon={ICONS.group}
              label="Group by"
              // "Group" rather than "No grouping" when the shelf is flat: the
              // button has to say what it is before it says what it is set to.
              // The listing bar's own rule, and the film shelf's.
              value={grouping.key === "none" ? "Group" : grouping.label}
              // The bar's last slot, so the fill follows its rounded end.
              buttonClassName="rounded-r-full"
            >
              {(close) => (
                <div className="py-1">
                  {GROUPS.map((option) => (
                    <MenuItem
                      key={option.key}
                      active={option.key === grouping.key}
                      onClick={() => {
                        update({ tg: option.key });
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

          {action}
        </div>
      </div>

      {/* No row of chips under the bar. What is filtering the shelf is said by
          the count on the Filters button and by the filled options inside it —
          repeating it out here pushed the shelf down a line for something you
          had just chosen and could see the effect of. Reset lives in the panel
          now, where the filters themselves are. */}

      {shown.length === 0 && (
        <EmptyState
          icon={
            <>
              <path d="M3 5h18l-7 8.2V19l-4 2v-7.8z" />
              <path d="m3.5 3.5 17 17" />
            </>
          }
          title="Nothing matches those filters"
          action={
            <button
              type="button"
              onClick={() => update({ tf: [] })}
              className="text-sm underline underline-offset-4 opacity-60 hover:opacity-100"
            >
              Clear filters
            </button>
          }
        >
          Every show on the shelf has been ruled out by the options set in the
          Filters panel.
        </EmptyState>
      )}

      {/* Ungrouped, there is no header to stand the shelf under — but the shows
          should still begin where they begin on every other shelf, so the space
          a header and its rule would have taken is kept anyway. */}
      {shown.length > 0 && grouping.key === "none" && (
        <div className="pt-13">
          <Shelf shows={shown} />
        </div>
      )}

      {shown.length > 0 &&
        grouping.key !== "none" &&
        buckets.map(([name, group]) => (
          <section key={name} className="flex flex-col gap-7 pt-6 first:pt-0">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  {name}
                </h2>
                <p className="text-[11px] opacity-40">
                  {group.length} ·{" "}
                  {size(group.reduce((n, s) => n + s.sizeBytes, 0))}
                </p>
              </div>
              <div aria-hidden className="rule-head" />
            </div>
            <Shelf shows={group} />
          </section>
        ))}

      {shown.length > 0 && (
        <ShelfTotal
          left={
            <>
              {shown.length === shows.length
                ? `${shows.length} ${shows.length === 1 ? "show" : "shows"}`
                : `${shown.length} of ${shows.length} shows`}{" "}
              · {episodes} episodes
            </>
          }
          right={size(shown.reduce((n, s) => n + s.sizeBytes, 0))}
        />
      )}
    </div>
  );
}

/** The shelf, for the whole library or for one bucket of it. */
function Shelf({ shows }: { shows: Show[] }) {
  return (
    <div className={TILE_GRID}>
      {shows.map((show, i) => (
        <ShowTile key={show.key} show={show} index={i} />
      ))}
    </div>
  );
}

/**
 * One show on the shelf — the app's own tile, with the two things a show is
 * read for in its two corners.
 *
 * This was the poster frame, the caption, the entrance and the stagger written
 * out by hand, which is the twenty lines `PosterTile` exists to stop being
 * copied. What is genuinely this shelf's is what goes in the corners: the
 * average score, and the two counts that say why you would open it.
 */
function ShowTile({ show, index }: { show: Show; index: number }) {
  const gaps = missing(show);
  const issues = issuesOf(show);

  return (
    <PosterTile
      poster={{
        src: show.poster,
        remote: show.art.poster,
        version: show.artAt,
      }}
      transitionName={posterName(show.key)}
      title={show.title}
      facts={[
        `${show.seasons.length} ${show.seasons.length === 1 ? "season" : "seasons"}`,
        `${show.episodeCount} episodes`,
      ]}
      badge={
        <ScoreBadge
          score={show.score}
          title={`${show.score} of 100 · average of ${show.episodeCount} episodes`}
        />
      }
      note={
        (gaps > 0 || issues > 0) && (
          /* What is wrong with the show, on the show: a gap in a season and a
             flawed file are both reasons to open it, and both belong where the
             eye already is. The gaps are counted only once TMDb has said how
             long each season runs — before that the figure would be holes in
             the numbering, which reads as a stronger claim than it is. */
          <span className="flex flex-wrap items-center gap-1">
            {gaps > 0 && (
              <span className="rounded-chip bg-background/85 px-1.5 text-[10px] leading-[18px] font-medium text-amber-700 backdrop-blur dark:text-amber-300">
                {gaps} missing
              </span>
            )}
            {issues > 0 && (
              <span className="rounded-chip bg-background/85 px-1.5 text-[10px] leading-[18px] font-medium text-amber-700 backdrop-blur dark:text-amber-300">
                {issues} {issues === 1 ? "issue" : "issues"}
              </span>
            )}
          </span>
        )
      }
      href={`/show/${showId(show.key)}`}
      label={show.title}
      index={index}
    />
  );
}
