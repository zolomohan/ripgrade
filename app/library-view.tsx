"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { openIssues, titleKey } from "@/lib/derive";
import type { LibraryItem } from "@/lib/library";
import type { UpgradeQueueItem } from "@/lib/upgrade-sweep";
import { ago, size } from "./format";
import { useLingering } from "./modal";
import { ReleaseSearchModal } from "./release-search";
import { rememberListing } from "./return-to";
import { ReleaseDetails, ReleaseMark } from "./release-details";
import { Bar, HelpTip, ICONS, MenuItem, Popover } from "./controls";
import { EmptyState } from "./empty-state";
import { PosterTile, TILE_GRID } from "./poster-tile";
import { ShelfTotal } from "./shelf-total";
import { ScoreBadge, SCORE_PLATE, STATUS_THEME } from "./score-circle";
import { compareId, movieId, posterName } from "@/lib/routes";

/**
 * Duplicate detection needs to compare films against each other, which a
 * per-item predicate cannot do — so the set is computed once and handed in.
 * "Added in the last scan" is the same shape of question: it depends on the
 * newest timestamp in the library, not on any one film.
 *
 * The upgrades are the same shape again and arrive from further away still —
 * the sweep's own table, read on the server. A film cannot tell you whether
 * something better is seeding; only the last pass over the indexers can.
 */
type FilterContext = {
  duplicatePaths: Set<string>;
  recentPaths: Set<string>;
  upgrades: Map<string, UpgradeQueueItem>;
};

type Option = {
  key: string;
  label: string;
  test: (m: LibraryItem, ctx: FilterContext) => boolean;
};

/**
 * Filters are grouped into facets and every chip is tri-state: off, include,
 * exclude. Within a facet the includes are OR-ed; excludes apply globally as
 * AND-NOT.
 *
 * The point of the exclude state is questions the old flat list could not ask.
 * "Everything without Dolby Vision" is not "SDR only" — it also covers HDR10
 * and HDR10+ films. Now it is one click: exclude Dolby Vision.
 */
const FACETS: {
  key: string;
  label: string;
  options: Option[];
  /** Facets that only mean something for some libraries are hidden otherwise. */
  when?: (ctx: FilterContext) => boolean;
}[] = [
  {
    key: "added",
    label: "Added",
    // Before a second scan every film shares one timestamp, so "the last scan"
    // would select the whole library and answer nothing. Hidden until it does.
    when: (ctx) => ctx.recentPaths.size > 0,
    options: [
      {
        key: "recent",
        label: "Last scan",
        test: (m, ctx) => ctx.recentPaths.has(m.path),
      },
    ],
  },
  {
    key: "resolution",
    label: "Resolution",
    options: [
      { key: "2160p", label: "2160p", test: (m) => m.resolution === "2160p" },
      { key: "1080p", label: "1080p", test: (m) => m.resolution === "1080p" },
      { key: "720p", label: "720p", test: (m) => m.resolution === "720p" },
      { key: "sd", label: "SD", test: (m) => m.resolution === "SD" },
    ],
  },
  {
    key: "hdr",
    label: "Dynamic range",
    options: [
      {
        key: "dv",
        label: "Dolby Vision",
        test: (m) => m.hdr === "Dolby Vision",
      },
      { key: "hdr10p", label: "HDR10+", test: (m) => m.hdr === "HDR10+" },
      { key: "hdr10", label: "HDR10", test: (m) => m.hdr === "HDR10" },
      { key: "sdr", label: "SDR", test: (m) => m.hdr === "SDR" },
      {
        key: "p7",
        label: "DV Profile 7",
        test: (m) => m.dvProfile === 7,
      },
      // Straight off the RPU reading rather than through the brightness
      // classification: MEL and FEL is what the layer *is*, and a film only has
      // one once its stream has been read.
      { key: "mel", label: "MEL", test: (m) => m.dovi?.elType === "MEL" },
      { key: "fel", label: "FEL", test: (m) => m.dovi?.elType === "FEL" },
    ],
  },
  {
    key: "audio",
    label: "Audio",
    options: [
      {
        key: "atmos",
        label: "Atmos",
        test: (m) => m.audio.some((a) => a.atmos),
      },
      { key: "dtsx", label: "DTS:X", test: (m) => m.audio.some((a) => a.dtsx) },
      {
        key: "lossless",
        label: "Lossless",
        test: (m) => m.audio.some((a) => a.lossless),
      },
    ],
  },
  {
    key: "release",
    label: "Release",
    options: [
      { key: "remux", label: "REMUX", test: (m) => m.releaseType === "REMUX" },
      {
        key: "webdl",
        label: "WEB-DL",
        test: (m) => m.releaseType === "WEB-DL",
      },
      {
        key: "encode",
        label: "Encode",
        test: (m) => m.releaseType === "ENCODE",
      },
    ],
  },
  {
    key: "attention",
    label: "Attention",
    options: [
      {
        key: "issues",
        label: "Open issues",
        test: (m) => openIssues(m).length > 0,
      },
      // The shelf of films still waiting on the extended-cut question. Through
      // `openIssues`, so answering one takes it off this shelf — which is what
      // makes the filter a queue you can work down rather than a list of every
      // film that has ever run long.
      {
        key: "longer",
        label: "Longer runtime",
        test: (m) =>
          openIssues(m).some((issue) => issue.code === "runtime-longer"),
      },
      {
        key: "upgrade",
        label: "Needs upgrade",
        test: (m) => m.status.includes("Upgrade"),
      },
      {
        key: "dupes",
        label: "Duplicates",
        test: (m, ctx) => ctx.duplicatePaths.has(m.path),
      },
      {
        key: "noart",
        label: "Missing artwork",
        test: (m) => !m.poster || !m.fanart || !m.logo,
      },
      {
        key: "review",
        label: "Match needs review",
        test: (m) => !m.tmdb || m.tmdb.confidence !== "high",
      },
      { key: "accepted", label: "Accepted as-is", test: (m) => m.acknowledged },
    ],
  },
];

const OPTIONS = new Map(
  FACETS.flatMap((f) => f.options.map((o) => [o.key, { ...o, facet: f.key }])),
);

/** URL tokens are the option key, prefixed with "-" when excluded. */
type Selection = Map<string, "include" | "exclude">;

function parseSelection(raw: string): Selection {
  const selection: Selection = new Map();
  for (const token of raw.split(",").filter(Boolean)) {
    const excluded = token.startsWith("-");
    const key = excluded ? token.slice(1) : token;
    if (OPTIONS.has(key)) selection.set(key, excluded ? "exclude" : "include");
  }
  return selection;
}

const serialiseSelection = (selection: Selection) =>
  [...selection.entries()].map(([k, v]) => (v === "exclude" ? `-${k}` : k));

function matches(
  movie: LibraryItem,
  selection: Selection,
  ctx: FilterContext,
): boolean {
  const includesByFacet = new Map<string, Option[]>();

  for (const [key, mode] of selection) {
    const option = OPTIONS.get(key)!;
    if (mode === "exclude") {
      if (option.test(movie, ctx)) return false;
    } else {
      const bucket = includesByFacet.get(option.facet) ?? [];
      bucket.push(option);
      includesByFacet.set(option.facet, bucket);
    }
  }

  // Every facet that has any include must be satisfied by at least one of them.
  for (const options of includesByFacet.values()) {
    if (!options.some((o) => o.test(movie, ctx))) return false;
  }
  return true;
}

/**
 * Grouping. The default answers the question the app exists for — what needs
 * doing — rather than sorting by an attribute.
 */
const GROUPS: {
  key: string;
  label: string;
  of: (m: LibraryItem, ctx: FilterContext) => string;
  /** Fixed order for the buckets; anything unlisted sorts alphabetically after. */
  order?: string[];
}[] = [
  {
    key: "verdict",
    label: "Verdict",
    of: (m, ctx) => {
      /*
       * A release actually waiting outranks every opinion under it.
       *
       * The three below are readings of the file on your drive — how far short
       * of its best it falls, and whether there is a disc to say so. This one
       * is not a reading at all: it is the answer, found, sitting on an indexer
       * with a magnet beside it. A film in this bucket has stopped being a
       * recommendation and become a thing to press.
       *
       * Which is why it takes the film out of "Upgrade recommended" rather than
       * standing beside it. Those two sections would have held the same films
       * saying two different things — one that the copy could be better, one
       * that a better one has been found — and the second is the whole of the
       * first plus somewhere to go.
       */
      if (ctx.upgrades.has(m.path)) return "Upgrades found";
      if (m.status === "Must Upgrade") return "Must upgrade";
      if (m.status === "Upgrade Recommended" || m.status === "Good")
        return "Upgrade recommended";
      // Without disc data we cannot claim a film is the best available, so it
      // is held apart rather than quietly counted as fine.
      if (!m.disc?.discScore) return "Not compared to a disc";
      return "Best available";
    },
    order: [
      "Upgrades found",
      "Must upgrade",
      "Upgrade recommended",
      "Best available",
      "Not compared to a disc",
    ],
  },
  {
    key: "collection",
    label: "Collection",
    of: (m) => m.tmdb?.collection ?? "No collection",
  },
  {
    key: "resolution",
    label: "Resolution",
    of: (m) => m.resolution,
    order: ["2160p", "1080p", "720p", "SD", "unknown"],
  },
  {
    key: "release",
    label: "Release type",
    of: (m) => m.releaseType,
    order: ["REMUX", "WEB-DL", "ENCODE", "UNKNOWN"],
  },
  {
    key: "hdr",
    label: "Dynamic range",
    of: (m) => m.hdr,
    order: ["Dolby Vision", "HDR10+", "HDR10", "SDR"],
  },
  { key: "none", label: "No grouping", of: () => "" },
];

const SORTS: {
  key: string;
  label: string;
  compare: (a: LibraryItem, b: LibraryItem) => number;
}[] = [
  {
    key: "worst",
    label: "Lowest score first",
    compare: (a, b) => a.scores.overall - b.scores.overall,
  },
  {
    key: "best",
    label: "Highest score first",
    compare: (a, b) => b.scores.overall - a.scores.overall,
  },
  {
    key: "title",
    label: "Title A–Z",
    compare: (a, b) => a.title.localeCompare(b.title),
  },
  {
    key: "largest",
    label: "Largest first",
    compare: (a, b) => b.sizeBytes - a.sizeBytes,
  },
  {
    key: "newest",
    label: "Newest first",
    compare: (a, b) => (b.year ?? 0) - (a.year ?? 0),
  },
];

/**
 * The same film as a poster.
 *
 * A row is for reading — codec, bitrate, what is wrong with it. A card is for
 * recognising, so it carries the two things you scan a shelf for: the artwork,
 * and whether this one is a problem. Everything else is a click away.
 *
 * The tile itself is the app's, in app/poster-tile.tsx. This shelf owned the
 * best copy of it for a long time and every other shelf owned its own — the same
 * frame written out by hand six times, which is how the jobs page and the queue
 * came to need a seventh. What is left here is what is genuinely the library's:
 * the score, in the library's own colours and the library's own verdict, and the
 * count of what is wrong with the file. Both are slots on that tile, because
 * every shelf disagrees about what its reading is and every one of them is
 * right — the queue's is a dial, the audio tab's is a size in green.
 */
function Card({
  movie,
  upgrade,
  onRelease,
  index,
}: {
  movie: LibraryItem;
  /**
   * The better copy the sweep found for this film, where there is one.
   *
   * Present on any card whose film has one, in every grouping — not only in the
   * verdict shelf's own section. Which section a film happens to be under is a
   * question about how you asked to read the shelf; whether a release is
   * waiting for it is a fact about the film, and a button that vanished when
   * you regrouped would be answering the wrong question.
   */
  upgrade?: UpgradeQueueItem;
  onRelease: (item: UpgradeQueueItem) => void;
  index: number;
}) {
  const theme = STATUS_THEME[movie.status];
  const open = openIssues(movie);

  return (
    <PosterTile
      poster={{
        src: movie.poster,
        remote: movie.art.poster,
        version: movie.artAt,
      }}
      // The whole tile is the thing that travels — its frame, the score on it
      // and the issue count with it. Naming the image inside instead left the
      // badge and the ring behind while the picture flew off alone.
      transitionName={posterName(movie.path)}
      title={movie.title}
      year={movie.year}
      facts={[movie.resolution, movie.releaseType]}
      badge={
        /* The library's reading, and beside it what the waiting release would
           add to it — the queue's own pairing, in the queue's own order: the
           gain leads and the score keeps the corner every shelf in the app
           keeps its reading in. See `ReleaseTile` in upgrades-view.tsx. */
        <div className="flex items-center gap-1">
          {upgrade && upgrade.hit.delta > 0 && (
            <span
              className={`${SCORE_PLATE} text-emerald-600 dark:text-emerald-400`}
              title={`A release was found that would score ${upgrade.hit.score} — ${upgrade.hit.delta} more than this copy`}
            >
              +{upgrade.hit.delta}
            </span>
          )}
          <ScoreBadge
            score={movie.scores.overall}
            theme={theme}
            title={`${movie.status} · ${movie.scores.overall} of 100`}
          />
        </div>
      }
      note={
        open.length > 0 ? (
          <span className="rounded-chip bg-background/85 px-1.5 text-[10px] leading-[18px] font-medium text-amber-700 backdrop-blur dark:text-amber-300">
            {open.length} {open.length === 1 ? "issue" : "issues"}
          </span>
        ) : undefined
      }
      /*
       * The queue's whole offer, on the shelf where the film lives, behind one
       * mark.
       *
       * The poster opens the film, which is what a library card is for, so the
       * release cannot have the click. It had two marks for a moment — an arrow
       * that sent the magnet and a magnifier that opened the release — which
       * was two buttons in the corner of a picture for one subject, and the
       * quicker of them was the one you could not take back. Now the arrow
       * opens the dialog and the dialog holds everything: the release's name,
       * size, seeders and indexer, the way to every other release of the film,
       * the indexer's own page, the comparison, and the button that actually
       * fetches. See `ReleaseMark`.
       *
       * Only where there is a release. A shelf of four hundred posters each
       * wearing a mark would be a shelf you have to read before you can look at
       * it; this appears on the handful of films something is waiting for.
       */
      actions={
        upgrade && (
          <ReleaseMark title={movie.title} onOpen={() => onRelease(upgrade)} />
        )
      }
      href={`/film/${movieId(movie.path)}`}
      label={movie.title}
      index={index}
    />
  );
}

/** The shelf, for the whole library or for one bucket of it. */
function Films({
  films,
  upgrades,
  onRelease,
}: {
  films: LibraryItem[];
  upgrades: Map<string, UpgradeQueueItem>;
  onRelease: (item: UpgradeQueueItem) => void;
}) {
  return (
    <div className={TILE_GRID}>
      {films.map((movie, i) => (
        <Card
          key={movie.path}
          movie={movie}
          upgrade={upgrades.get(movie.path)}
          onRelease={onRelease}
          index={i}
        />
      ))}
    </div>
  );
}

export function LibraryView({
  movies,
  upgrades,
  jackettReady,
  tabs,
  action,
}: {
  movies: LibraryItem[];
  /** The better copies the sweep found, by the path of the film they beat. */
  upgrades: UpgradeQueueItem[];
  /** Whether the "every release" search has anywhere to ask. */
  jackettReady: boolean;
  /** The shelf switch, at the head of this shelf's own row of controls. */
  tabs: React.ReactNode;
  /**
   * The page's own control, at the end of the row after the three menus.
   *
   * The forced sweep, in practice — see app/library-tabs.tsx. A slot rather
   * than the button itself, for the reason `ListingBar` gives: what the shelf
   * knows is where the row ends, not what the page wants to put there.
   */
  action?: React.ReactNode;
}) {
  const router = useRouter();

  /**
   * Which film's found release is open, and which film's whole field is.
   *
   * The queue's two dialogs, on the queue's own terms: the first is "what did
   * the sweep find", which is one release read whole, and the second is "show
   * me everything", which is a search. Opening the second closes the first — a
   * dialog stacked on a dialog is a dialog you cannot see the edge of.
   */
  const [reading, setReading] = useState<UpgradeQueueItem | null>(null);
  const read = useLingering(reading);
  const [finding, setFinding] = useState<UpgradeQueueItem | null>(null);
  // Not `shown`: that name belongs to the films this shelf is drawing.
  const searching = useLingering(finding);

  // The URL is the single source of truth, so filters survive navigating into a
  // film and back. `history.replaceState` syncs `useSearchParams` without a
  // server round-trip.
  const searchParams = useSearchParams();

  // Kept as the raw string for memo dependencies: a Map is a fresh object every
  // render, so it would defeat memoization and trip the exhaustive-deps rule.
  const rawFilters = searchParams.get("f") ?? "";
  const selection = parseSelection(rawFilters);
  const sort = searchParams.get("sort") ?? SORTS[0].key;
  const group = searchParams.get("g") ?? GROUPS[0].key;

  function update(next: { f?: string[]; sort?: string; g?: string }) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.f !== undefined) {
      if (next.f.length) params.set("f", next.f.join(","));
      else params.delete("f");
    }
    // Defaults are omitted so a plain "/" stays clean.
    if (next.sort !== undefined) {
      if (next.sort !== SORTS[0].key) params.set("sort", next.sort);
      else params.delete("sort");
    }
    if (next.g !== undefined) {
      if (next.g !== GROUPS[0].key) params.set("g", next.g);
      else params.delete("g");
    }

    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  /** off → include → exclude → off */
  function cycle(key: string) {
    const next: Selection = new Map(selection);
    const mode = next.get(key);
    if (mode === undefined) next.set(key, "include");
    else if (mode === "include") next.set(key, "exclude");
    else next.delete(key);
    update({ f: serialiseSelection(next) });
  }
  const setSort = (s: string) => update({ sort: s });
  const setGroup = (g: string) => update({ g });

  // Plain computation rather than useMemo: at this library size the whole
  // group/filter/sort pass is well under a millisecond, and memoising a Map
  // fights the React Compiler for no measurable gain.
  //
  // Same grouping key the server uses, so the list and the duplicates section
  // can never disagree about what counts as a duplicate.
  const duplicates = (() => {
    const groups = new Map<string, LibraryItem[]>();
    for (const movie of movies) {
      const key = titleKey(movie.title, movie.year);
      const bucket = groups.get(key);
      if (bucket) bucket.push(movie);
      else groups.set(key, [movie]);
    }

    // Only the paths: this filter answers "is this one of several copies",
    // and the compare page is where the copies are weighed against each other.
    return new Set(
      [...groups.values()]
        .filter((g) => g.length > 1)
        .flatMap((g) => g.map((m) => m.path)),
    );
  })();

  /**
   * What the last scan brought in. One scan stamps every film it adds with the
   * same `addedAt`, so the newest timestamp identifies that batch exactly —
   * unless it covers everything, which means there has only ever been one scan.
   */
  const recentPaths = (() => {
    if (movies.length === 0) return new Set<string>();
    const newest = Math.max(...movies.map((m) => m.addedAt));
    const batch = movies.filter((m) => m.addedAt === newest);
    return batch.length === movies.length
      ? new Set<string>()
      : new Set(batch.map((m) => m.path));
  })();

  const byPath = new Map(upgrades.map((item) => [item.path, item]));
  const ctx: FilterContext = {
    duplicatePaths: duplicates,
    recentPaths,
    upgrades: byPath,
  };

  // Narrowing this shelf is what the filters are for; finding one film by name
  // is the floating search's job, on this page and every other.
  const shown = (() => {
    const compare = (SORTS.find((s) => s.key === sort) ?? SORTS[0]).compare;
    const active = parseSelection(rawFilters);

    return movies.filter((m) => matches(m, active, ctx)).sort(compare);
  })();

  const grouping = GROUPS.find((g) => g.key === group) ?? GROUPS[0];

  // Buckets follow the group's declared order; anything unlisted trails it
  // alphabetically, so a new collection never silently jumps to the top.
  const buckets: [string, LibraryItem[]][] = (() => {
    if (grouping.key === "none") return [];

    const map = new Map<string, LibraryItem[]>();
    for (const movie of shown) {
      const name = grouping.of(movie, ctx);
      const bucket = map.get(name);
      if (bucket) bucket.push(movie);
      else map.set(name, [movie]);
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

  return (
    <div className="flex flex-col gap-6">
      {/* One line: which shelf on the left, what to do with this one on the
          right. The bar is only as wide as the controls it holds — with the
          field gone there is nothing to stretch, and a bar drawn the width of
          the page with three buttons huddled at one end is mostly frame. */}
      <div className="flex flex-wrap items-center gap-3">
        {tabs}

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Bar>
            <Popover
              icon={ICONS.filter}
              label="Filters"
              badge={selection.size}
              width="w-[min(92vw,34rem)]"
              // The bar's first slot, so the fill follows its rounded end.
              buttonClassName="rounded-l-full"
            >
              {() => (
                <div className="flex flex-col gap-3 p-4">
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
                            onClick={() => update({ f: [] })}
                            title="Clear every filter"
                            className="h-5 rounded-full border border-line px-2 text-[10px] font-medium opacity-40 transition-opacity hover:opacity-100"
                          >
                            Reset
                          </button>
                        )}
                        <HelpTip text="Click once to include, twice to exclude. Options in a row are OR-ed; rows are AND-ed." />
                      </div>
                    </div>

                    <div aria-hidden className="rule-head" />
                  </div>

                  {FACETS.filter((facet) => facet.when?.(ctx) ?? true).map(
                    (facet) => (
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
                    ),
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
                        setSort(option.key);
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
              // Every other state names the cut instead, which is the state you
              // put it in. `ListingControls` has always said it this way and
              // this shelf said "No grouping" — one control, two words for one
              // state, depending on which page you were standing on.
              value={
                grouping.key === "none"
                  ? "Group"
                  : (GROUPS.find((o) => o.key === group) ?? GROUPS[0]).label
              }
              // The bar's last slot, so the fill follows its rounded end.
              buttonClassName="rounded-r-full"
            >
              {(close) => (
                <div className="py-1">
                  {GROUPS.map((option) => (
                    <MenuItem
                      key={option.key}
                      active={option.key === group}
                      onClick={() => {
                        setGroup(option.key);
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

      {/* No row of chips under the bar. What is filtering the list is said by
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
              onClick={() => update({ f: [] })}
              className="text-sm underline underline-offset-4 opacity-60 hover:opacity-100"
            >
              Clear filters
            </button>
          }
        >
          Every film on the shelf has been ruled out by the options set in the
          Filters panel.
        </EmptyState>
      )}

      {/* Ungrouped, there is no header to stand the shelf under — but the
          films should still begin where they begin on every other shelf, so the
          space a header and its rule would have taken is kept anyway. */}
      {shown.length > 0 && grouping.key === "none" && (
        <div className="pt-13">
          <Films films={shown} upgrades={byPath} onRelease={setReading} />
        </div>
      )}

      {shown.length > 0 &&
        grouping.key !== "none" &&
        buckets.map(([name, films]) => (
          <section key={name} className="flex flex-col gap-7 pt-6 first:pt-0">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  {name}
                </h2>
                <p className="text-[11px] opacity-40">
                  {films.length} ·{" "}
                  {size(films.reduce((n, m) => n + m.sizeBytes, 0))}
                </p>
              </div>
              {/* The same rule the collections list draws, under the name
                  rather than between rows: it gives a shelf a floor to stand
                  the films on, and the space that comes with it. */}
              <div aria-hidden className="rule-head" />
            </div>
            <Films films={films} upgrades={byPath} onRelease={setReading} />
          </section>
        ))}

      {/* A total reads as a total at the foot of what it counts; above the
          shelf it was just another line between the controls and the films. */}
      {shown.length > 0 && (
        <ShelfTotal
          left={
            shown.length === movies.length
              ? `${movies.length} films`
              : `${shown.length} of ${movies.length} films`
          }
          right={size(shown.reduce((sum, m) => sum + m.sizeBytes, 0))}
        />
      )}

      {/* What the sweep found, read whole — the same dialog the queue opens,
          with the same three ways onward and the same button that fetches it.
          Nothing about a release is different for being reached from the shelf
          the film sits on. */}
      {read && (
        <ReleaseDetails
          open={reading !== null}
          title={read.title}
          year={read.year}
          poster={read.poster}
          posterRemote={read.posterRemote}
          posterVersion={read.artAt}
          hit={read.hit}
          gain={read.hit.delta}
          currentScore={read.currentScore}
          checkedLabel={`Checked ${ago(read.checkedAt)}`}
          source="upgrade"
          film={{ href: `/film/${movieId(read.path)}` }}
          onward={{
            // "Compare", not "Compare copies": it stands beside Download now,
            // and a two-word button next to a one-word one reads as the longer
            // of two options rather than the lighter of them.
            label: "Compare",
            go: () => {
              // The crumb the queue's own rows leave, for the same reason: the
              // delegated listener in return-to.tsx only sees anchors, and this
              // navigates from a handler.
              rememberListing();
              router.push(`/compare/${compareId(read.compareKey)}`);
            },
          }}
          onMore={() => {
            setReading(null);
            setFinding(read);
          }}
          onClose={() => setReading(null)}
        />
      )}

      {/* And the rest of the field, when one release is not the answer. */}
      {searching && (
        <ReleaseSearchModal
          open={finding !== null}
          subject={{ kind: "movie", path: searching.path }}
          title={searching.title}
          subtitle={searching.year ? String(searching.year) : undefined}
          posterPath={searching.posterRemote}
          source="upgrade"
          configured={jackettReady}
          onClose={() => setFinding(null)}
        />
      )}
    </div>
  );
}
