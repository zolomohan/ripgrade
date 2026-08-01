"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { titleKey } from "@/lib/derive";
import type { LibraryItem } from "@/lib/library";
import { artUrl, compareId, movieId } from "@/lib/routes";

/**
 * Duplicate detection needs to compare films against each other, which a
 * per-item predicate cannot do — so the set is computed once and handed in.
 */
type FilterContext = { duplicatePaths: Set<string> };

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
const FACETS: { key: string; label: string; options: Option[] }[] = [
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
        test: (m) => m.issues.length > 0 && !m.acknowledged,
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
        test: (m) => !m.poster || !m.fanart,
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
  of: (m: LibraryItem) => string;
  /** Fixed order for the buckets; anything unlisted sorts alphabetically after. */
  order?: string[];
}[] = [
  {
    key: "verdict",
    label: "Verdict",
    of: (m) => {
      if (m.status === "Must Upgrade") return "Must upgrade";
      if (m.status === "Upgrade Recommended" || m.status === "Good")
        return "Upgrade recommended";
      // Without disc data we cannot claim a film is the best available, so it
      // is held apart rather than quietly counted as fine.
      if (!m.disc?.discScore) return "Not compared to a disc";
      return "Best available";
    },
    order: [
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

// Tailwind needs literal class names, so each status carries its own palette.
/**
 * Three states, three colours. The five statuses collapse to the only question
 * that matters in a list: is there anything to do about this film?
 */
const STATUS_THEME: Record<string, { stroke: string; text: string }> = {
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
 * The ring is the score and its colour is the verdict — a film can be red at 66
 * and green at 66, and the arc shows how far round it has actually got.
 */
function ScoreCircle({ movie }: { movie: LibraryItem }) {
  const theme = STATUS_THEME[movie.status];
  const radius = 18;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className="relative grid h-11 w-11 shrink-0 place-items-center"
      title={`${movie.status} · ${movie.scores.overall} of 100`}
    >
      <svg viewBox="0 0 44 44" className="absolute h-11 w-11 -rotate-90">
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
          strokeDashoffset={circumference * (1 - movie.scores.overall / 100)}
          className={theme.stroke}
        />
      </svg>
      <span
        aria-hidden
        className={`relative font-display text-sm font-semibold tabular-nums ${theme.text}`}
      >
        {movie.scores.overall}
      </span>
      <span className="sr-only">
        {movie.status}, score {movie.scores.overall} of 100
      </span>
    </div>
  );
}

/**
 * MediaInfo's `format` is too blunt for a chip — DTS-HD Master Audio reports as
 * plain "DTS", which reads as the lossy codec. Shorten the commercial name.
 */
function audioLabel(track: { label: string; format: string }) {
  const short: [RegExp, string][] = [
    [/DTS-HD Master/i, "DTS-HD MA"],
    [/DTS-HD High/i, "DTS-HD HRA"],
    [/TrueHD/i, "TrueHD"],
    [/Digital Plus/i, "DD+"],
    [/Dolby Digital/i, "DD"],
    [/\bPCM\b/i, "PCM"],
    [/FLAC/i, "FLAC"],
  ];
  return (
    short.find(([pattern]) => pattern.test(track.label))?.[1] ?? track.format
  );
}

function size(bytes: number) {
  return bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(2)} TB`
    : `${(bytes / 1e9).toFixed(1)} GB`;
}

function Stat({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string | number;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`rounded-card border border-line bg-surface px-4 py-3 text-left transition-colors ${
        onClick ? "hover:bg-surface-strong" : ""
      }`}
    >
      <p className="text-[11px] tracking-widest uppercase opacity-45">
        {label}
      </p>
      {/* One size across all six: the two-tier version read as inconsistent
          rather than as hierarchy. */}
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
        {value}
      </p>
    </Tag>
  );
}

/**
 * Spec tags. Every chip shares one outline shape and differs only in hue, so a
 * row reads as a set rather than as scattered blobs. Colour is reserved for
 * problems — with most of the library carrying DV and Atmos, tinting those too
 * turned every row into a rainbow and buried the thing worth noticing.
 */
function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn" | "danger";
}) {
  const tones = {
    neutral: "text-foreground/55 ring-line",
    warn: "bg-amber-500/[0.08] text-amber-700 ring-amber-500/30 dark:text-amber-300",
    danger: "bg-red-500/[0.08] text-red-700 ring-red-500/30 dark:text-red-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-chip px-1.5 text-[11px] leading-[18px] font-medium whitespace-nowrap ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function HelpTip({ text }: { text: string }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  // A click-pinned tooltip has to be dismissable without going back to it.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  const open = hovered || pinned;

  return (
    <span ref={wrap} className="relative inline-flex">
      <button
        type="button"
        aria-label={text}
        aria-expanded={open}
        onClick={() => setPinned((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="grid h-5 w-5 place-items-center rounded-full border border-line text-[10px] font-medium opacity-40 transition-opacity hover:opacity-100"
      >
        ?
      </button>

      {open && (
        <span
          role="tooltip"
          className="absolute top-full right-0 z-30 mt-1.5 w-60 rounded-control border border-line bg-background p-2.5 text-[11px] leading-relaxed shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

function Row({ movie }: { movie: LibraryItem }) {
  const object = movie.audio.find((a) => a.atmos || a.dtsx);
  const lossless = movie.audio.find((a) => a.lossless);
  const critical = movie.issues.some((i) => i.severity === "critical");

  return (
    <Link
      href={`/movie/${movieId(movie.path)}`}
      className="row-enter group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-strong"
    >
      {movie.poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artUrl(movie.poster)}
          alt=""
          loading="lazy"
          className="h-[72px] w-12 shrink-0 rounded-chip object-cover ring-1 ring-line"
        />
      ) : (
        <div className="h-[72px] w-12 shrink-0 rounded-chip bg-surface-strong" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={movie.title}>
          {movie.title}
          {movie.year && (
            <span className="ml-1.5 font-normal opacity-40">{movie.year}</span>
          )}
          {movie.edition && (
            <span className="ml-2 text-xs opacity-50">{movie.edition}</span>
          )}
        </p>

        <p className="mt-0.5 truncate text-xs opacity-50">
          {[
            movie.resolution,
            movie.videoCodec,
            movie.bitDepth ? `${movie.bitDepth}-bit` : null,
            movie.releaseType,
            size(movie.sizeBytes),
          ]
            .filter(Boolean)
            .join("  · ")}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {movie.hdr !== "SDR" && (
            <Chip>
              {movie.hdr === "Dolby Vision"
                ? `DV P${movie.dvProfile ?? "?"}`
                : movie.hdr}
            </Chip>
          )}
          {object && <Chip>{object.atmos ? "Atmos" : "DTS:X"}</Chip>}
          {lossless && <Chip>{audioLabel(lossless)}</Chip>}
          {!lossless && movie.audio[0] && (
            <>
              <Chip>{audioLabel(movie.audio[0])}</Chip>
              <Chip>lossy</Chip>
            </>
          )}
          {movie.tmdb && movie.tmdb.confidence !== "high" && (
            <Chip tone="warn">match?</Chip>
          )}
          {movie.issues.length > 0 && !movie.acknowledged && (
            <Chip tone={critical ? "danger" : "warn"}>
              {movie.issues.length}{" "}
              {movie.issues.length === 1 ? "issue" : "issues"}
            </Chip>
          )}
        </div>
      </div>

      <ScoreCircle movie={movie} />
    </Link>
  );
}

export function LibraryView({ movies }: { movies: LibraryItem[] }) {
  // The URL is the single source of truth, so filters survive navigating into a
  // film and back. `history.replaceState` syncs `useSearchParams` without a
  // server round-trip, which matters when the search box updates per keystroke.
  const searchParams = useSearchParams();

  // Kept as the raw string for memo dependencies: a Map is a fresh object every
  // render, so it would defeat memoization and trip the exhaustive-deps rule.
  const rawFilters = searchParams.get("f") ?? "";
  const selection = parseSelection(rawFilters);
  const query = searchParams.get("q") ?? "";
  const sort = searchParams.get("sort") ?? SORTS[0].key;
  const group = searchParams.get("g") ?? GROUPS[0].key;

  function update(next: {
    f?: string[];
    q?: string;
    sort?: string;
    g?: string;
  }) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.f !== undefined) {
      if (next.f.length) params.set("f", next.f.join(","));
      else params.delete("f");
    }
    if (next.q !== undefined) {
      if (next.q) params.set("q", next.q);
      else params.delete("q");
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

  const setActive = (keys: string[]) => update({ f: keys });

  /** off → include → exclude → off */
  function cycle(key: string) {
    const next: Selection = new Map(selection);
    const mode = next.get(key);
    if (mode === undefined) next.set(key, "include");
    else if (mode === "include") next.set(key, "exclude");
    else next.delete(key);
    update({ f: serialiseSelection(next) });
  }
  const setQuery = (q: string) => update({ q });
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

    const sets = [...groups.entries()]
      .filter(([, g]) => g.length > 1)
      .map(([key, g]) => ({
        key,
        copies: [...g].sort((a, b) => b.scores.overall - a.scores.overall),
      }));

    const paths = new Set(sets.flatMap((s) => s.copies.map((c) => c.path)));
    // Everything past the best copy is what you would reclaim by deleting.
    const recoverable = sets.reduce(
      (sum, s) => sum + s.copies.slice(1).reduce((n, c) => n + c.sizeBytes, 0),
      0,
    );

    return { sets, paths, recoverable };
  })();

  const openIssues = movies.filter(
    (m) => m.issues.length > 0 && !m.acknowledged,
  ).length;

  const missingArtwork = movies.filter((m) => !m.poster || !m.fanart).length;

  const shown = (() => {
    const q = query.trim().toLowerCase();
    const compare = (SORTS.find((s) => s.key === sort) ?? SORTS[0]).compare;
    const ctx: FilterContext = { duplicatePaths: duplicates.paths };
    const active = parseSelection(rawFilters);

    return movies
      .filter((m) => matches(m, active, ctx))
      .filter(
        (m) =>
          !q ||
          m.title.toLowerCase().includes(q) ||
          m.fileName.toLowerCase().includes(q),
      )
      .sort(compare);
  })();

  const grouping = GROUPS.find((g) => g.key === group) ?? GROUPS[0];

  // Buckets follow the group's declared order; anything unlisted trails it
  // alphabetically, so a new collection never silently jumps to the top.
  const buckets: [string, LibraryItem[]][] = (() => {
    if (grouping.key === "none") return [];

    const map = new Map<string, LibraryItem[]>();
    for (const movie of shown) {
      const name = grouping.of(movie);
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

  const stats = {
    total: movies.length,
    size: movies.reduce((sum, m) => sum + m.sizeBytes, 0),
    remux: movies.filter((m) => m.releaseType === "REMUX").length,
    dv: movies.filter((m) => m.hdr === "Dolby Vision").length,
    atmos: movies.filter((m) => m.audio.some((a) => a.atmos)).length,
  };

  // Only counts films that were actually matched — unmatched ones have nothing
  // to review until a matching run has been done at all.
  const needsReview = movies.filter(
    (m) => m.tmdb && m.tmdb.confidence !== "high",
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Movies" value={stats.total} />
        <Stat label="Storage" value={size(stats.size)} />
        <Stat
          label="REMUX"
          value={stats.remux}
          onClick={() => setActive(["remux"])}
        />
        <Stat
          label="Dolby Vision"
          value={stats.dv}
          onClick={() => setActive(["dv"])}
        />
        <Stat
          label="Atmos"
          value={stats.atmos}
          onClick={() => setActive(["atmos"])}
        />
        <Stat
          label="Open issues"
          value={openIssues}
          onClick={() => setActive(["issues"])}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative flex flex-col gap-2 rounded-card border border-line bg-surface p-3 pr-9">
          <div className="absolute top-2 right-2 flex items-center gap-2">
            {(selection.size > 0 || query) && (
              <button
                type="button"
                onClick={() => update({ f: [], q: "" })}
                className="text-[11px] underline underline-offset-4 opacity-50 hover:opacity-100"
              >
                Reset
              </button>
            )}
            <HelpTip text="Click once to include, twice to exclude. Options in a row are OR-ed; rows are AND-ed." />
          </div>
          {FACETS.map((facet) => (
            <div
              key={facet.key}
              className="grid grid-cols-[7rem_1fr] items-start gap-3"
            >
              <span className="pt-1 text-[11px] tracking-widest uppercase opacity-40">
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
      </div>

      {(openIssues > 0 ||
        duplicates.sets.length > 0 ||
        missingArtwork > 0 ||
        needsReview > 0) && (
        <section className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
          <h2 className="text-[11px] font-medium tracking-widest uppercase opacity-45">
            Needs attention
          </h2>

          {duplicates.sets.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span className="font-medium">
                {duplicates.sets.length}{" "}
                {duplicates.sets.length === 1
                  ? "duplicate group"
                  : "duplicate groups"}
              </span>
              <span className="opacity-60">
                — {size(duplicates.recoverable)} recoverable
              </span>
              {duplicates.sets.map((set) => (
                <Link
                  key={set.key}
                  href={`/compare/${compareId(set.key)}`}
                  className="rounded-chip px-1.5 text-[11px] leading-[18px] font-medium ring-1 ring-inset ring-line-strong hover:bg-surface-strong"
                >
                  Compare {set.copies[0].title}
                </Link>
              ))}
            </div>
          )}

          {openIssues > 0 && (
            <button
              type="button"
              onClick={() => setActive(["issues"])}
              className="flex flex-wrap items-baseline gap-2 text-left text-sm"
            >
              <span className="font-medium">
                {openIssues} {openIssues === 1 ? "film has" : "films have"} open
                issues
              </span>
              <span className="opacity-60">
                — accept one as-is to clear it from here
              </span>
            </button>
          )}

          {missingArtwork > 0 && (
            <button
              type="button"
              onClick={() => setActive(["noart"])}
              className="flex flex-wrap items-baseline gap-2 text-left text-sm"
            >
              <span className="font-medium">
                {missingArtwork}{" "}
                {missingArtwork === 1 ? "film is" : "films are"} missing artwork
              </span>
              <span className="opacity-60">
                — open one and pick a poster or backdrop from TMDb
              </span>
            </button>
          )}

          {needsReview > 0 && (
            <button
              type="button"
              onClick={() => setActive(["review"])}
              className="flex flex-wrap items-baseline gap-2 text-left text-sm"
            >
              <span className="font-medium">
                {needsReview}{" "}
                {needsReview === 1 ? "match needs" : "matches need"} review
              </span>
              <span className="opacity-60">
                — confirm it, or pick the right film
              </span>
            </button>
          )}
        </section>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 opacity-35"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or filename…"
            className="w-full rounded-control border border-line bg-transparent py-2.5 pr-9 pl-9 text-sm outline-none focus:border-line-strong"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-3 -translate-y-1/2 text-sm opacity-40 hover:opacity-80"
            >
              ✕
            </button>
          )}
        </div>

        {/* appearance-none drops the native arrow, which sits hard against
              the border; pr-9 reserves room for the chevron below. */}
        <div className="relative shrink-0">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="w-full cursor-pointer appearance-none rounded-control border border-line bg-transparent py-2.5 pr-9 pl-3 text-sm outline-none focus:border-line-strong sm:w-auto"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 opacity-40"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>

        <div className="relative shrink-0">
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            aria-label="Group by"
            className="w-full cursor-pointer appearance-none rounded-control border border-line bg-transparent py-2.5 pr-9 pl-3 text-sm outline-none focus:border-line-strong sm:w-auto"
          >
            {GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.key === "none"
                  ? g.label
                  : `Group by ${g.label.toLowerCase()}`}
              </option>
            ))}
          </select>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 opacity-40"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>

      <div className="flex items-baseline justify-between">
        <p className="text-xs opacity-45">
          {shown.length === movies.length
            ? `${movies.length} films`
            : `${shown.length} of ${movies.length} films`}
        </p>
        {shown.length > 0 && (
          <p className="text-xs opacity-45">
            {size(shown.reduce((sum, m) => sum + m.sizeBytes, 0))}
          </p>
        )}
      </div>

      {shown.length === 0 && (
        <div className="rounded-card border border-line bg-surface px-4 py-12 text-center">
          <p className="text-sm opacity-50">Nothing matches those filters.</p>
          <button
            type="button"
            onClick={() => update({ f: [], q: "" })}
            className="mt-2 text-sm underline underline-offset-4 opacity-60 hover:opacity-100"
          >
            Clear filters
          </button>
        </div>
      )}

      {shown.length > 0 && grouping.key === "none" && (
        <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {shown.map((movie) => (
            <Row key={movie.path} movie={movie} />
          ))}
        </div>
      )}

      {shown.length > 0 &&
        grouping.key !== "none" &&
        buckets.map(([name, films]) => (
          <section key={name} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-[11px] font-medium tracking-widest uppercase opacity-45">
                {name}
              </h2>
              <p className="text-[11px] opacity-40">
                {films.length} ·{" "}
                {size(films.reduce((n, m) => n + m.sizeBytes, 0))}
              </p>
            </div>
            <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {films.map((movie) => (
                <Row key={movie.path} movie={movie} />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
