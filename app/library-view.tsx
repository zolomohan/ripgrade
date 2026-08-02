"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { openIssues, titleKey } from "@/lib/derive";
import type { LibraryItem } from "@/lib/library";
import { artUrl, movieId } from "@/lib/routes";

/**
 * Duplicate detection needs to compare films against each other, which a
 * per-item predicate cannot do — so the set is computed once and handed in.
 * "Added in the last scan" is the same shape of question: it depends on the
 * newest timestamp in the library, not on any one film.
 */
type FilterContext = {
  duplicatePaths: Set<string>;
  recentPaths: Set<string>;
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
  const open = openIssues(movie);
  const critical = open.some((i) => i.severity === "critical");

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
          {open.length > 0 && (
            <Chip tone={critical ? "danger" : "warn"}>
              {open.length} {open.length === 1 ? "issue" : "issues"}
            </Chip>
          )}
        </div>
      </div>

      <ScoreCircle movie={movie} />
    </Link>
  );
}

/**
 * The same film as a poster.
 *
 * A row is for reading — codec, bitrate, what is wrong with it. A card is for
 * recognising, so it carries the two things you scan a shelf for: the artwork,
 * and whether this one is a problem. Everything else is a click away.
 */
function Card({ movie }: { movie: LibraryItem }) {
  const theme = STATUS_THEME[movie.status];
  const open = openIssues(movie);

  return (
    <Link
      href={`/movie/${movieId(movie.path)}`}
      className="row-enter group flex flex-col gap-2"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-card bg-surface-strong ring-1 ring-line">
        {movie.poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artUrl(movie.poster)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.04]"
          />
        )}

        <span
          className={`absolute top-2 right-2 rounded-full bg-background/85 px-1.5 py-0.5 font-display text-[11px] font-semibold tabular-nums backdrop-blur ${theme.text}`}
          title={`${movie.status} · ${movie.scores.overall} of 100`}
        >
          {movie.scores.overall}
        </span>

        {open.length > 0 && (
          <span className="absolute bottom-2 left-2 rounded-chip bg-background/85 px-1.5 text-[10px] leading-[18px] font-medium text-amber-700 backdrop-blur dark:text-amber-300">
            {open.length} {open.length === 1 ? "issue" : "issues"}
          </span>
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={movie.title}>
          {movie.title}
        </p>
        <p className="truncate text-[11px] opacity-45">
          {[movie.year, movie.resolution, movie.releaseType]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </Link>
  );
}

/** Whichever shape is selected, for the whole list or for one bucket of it. */
function Films({ films, view }: { films: LibraryItem[]; view: string }) {
  return view === "grid" ? (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {films.map((movie) => (
        <Card key={movie.path} movie={movie} />
      ))}
    </div>
  ) : (
    <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
      {films.map((movie) => (
        <Row key={movie.path} movie={movie} />
      ))}
    </div>
  );
}

/**
 * Posters first. The list is the better shape for reading specs, but the
 * library is mostly browsed, and browsing is what artwork is for.
 *
 * Named rather than taken from VIEWS[0] so the toggle can keep list on the
 * left, where the pair reads in the order people expect.
 */
const DEFAULT_VIEW = "grid";

const ICONS = {
  filter: "M3 5h18l-7 8.2V19l-4 2v-7.8z",
  sort: "M3 6h13M3 12h9M3 18h5",
  group: "M4 5h16M4 10h16M8 15h12M8 19h12",
};

/**
 * A small button that opens a panel under itself.
 *
 * All three controls behave the same way — click to open, click away or press
 * Escape to close — so the row stays a row of buttons rather than a mix of
 * native selects and a panel that pushed the list down the page.
 */
function Popover({
  icon,
  label,
  value,
  badge,
  width = "w-64",
  children,
}: {
  icon: string;
  label: string;
  value?: string;
  badge?: number;
  width?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`flex h-[42px] items-center gap-2 rounded-control border px-3 text-sm transition-colors ${
          open || badge
            ? "border-line-strong bg-surface-strong"
            : "border-line hover:bg-surface"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 opacity-50"
        >
          <path d={icon} />
        </svg>
        {value && <span className="hidden sm:inline">{value}</span>}
        {badge !== undefined && badge > 0 && (
          <span className="rounded-full bg-foreground px-1.5 text-[10px] leading-[16px] font-medium text-background tabular-nums">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`row-enter absolute right-0 top-full z-30 mt-2 ${width} overflow-hidden rounded-card border border-line bg-background shadow-2xl`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** One option in a sort or grouping menu. */
function MenuItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-strong ${
        active ? "font-medium" : ""
      }`}
    >
      {children}
      {active && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5 shrink-0 opacity-60"
        >
          <path d="m4 12.5 5 5 11-11" />
        </svg>
      )}
    </button>
  );
}

const VIEWS = [
  {
    key: "list",
    label: "List",
    path: "M4 6h16M4 12h16M4 18h16",
  },
  {
    key: "grid",
    label: "Grid",
    path: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  },
];

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
  const view = searchParams.get("v") ?? DEFAULT_VIEW;

  function update(next: {
    f?: string[];
    q?: string;
    sort?: string;
    g?: string;
    v?: string;
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
    if (next.v !== undefined) {
      if (next.v !== DEFAULT_VIEW) params.set("v", next.v);
      else params.delete("v");
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
  /** Drops one filter, for the chips shown while the panel is closed. */
  function clear(key: string) {
    const next: Selection = new Map(selection);
    next.delete(key);
    update({ f: serialiseSelection(next) });
  }

  const setQuery = (q: string) => update({ q });
  const setSort = (s: string) => update({ sort: s });
  const setGroup = (g: string) => update({ g });
  const setView = (v: string) => update({ v });

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

    // Only the paths: what the duplicates are and what deleting them would
    // reclaim is the attention page's job now, not this list's.
    return new Set(
      [...groups.values()].filter((g) => g.length > 1).flatMap((g) =>
        g.map((m) => m.path),
      ),
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

  const ctx: FilterContext = { duplicatePaths: duplicates, recentPaths };

  const shown = (() => {
    const q = query.trim().toLowerCase();
    const compare = (SORTS.find((s) => s.key === sort) ?? SORTS[0]).compare;
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

  return (
    <div className="flex flex-col gap-6">
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

        <Popover
          icon={ICONS.filter}
          label="Filters"
          badge={selection.size}
          width="w-[min(92vw,34rem)]"
        >
          {() => (
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-display text-sm font-semibold">
                  Filters
                </span>
                <HelpTip text="Click once to include, twice to exclude. Options in a row are OR-ed; rows are AND-ed." />
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

              {selection.size > 0 && (
                <button
                  type="button"
                  onClick={() => update({ f: [] })}
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
          value={(GROUPS.find((o) => o.key === group) ?? GROUPS[0]).label}
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

        {/* A segmented pair rather than a third dropdown: two options, and
            the icons say which is which faster than their names would. */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-control border border-line p-0.5">
          {VIEWS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setView(option.key)}
              aria-label={`${option.label} view`}
              aria-pressed={view === option.key}
              title={`${option.label} view`}
              className={`grid h-8 w-8 place-items-center rounded-[6px] transition-colors ${
                view === option.key
                  ? "bg-surface-strong"
                  : "opacity-40 hover:opacity-100"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d={option.path} />
              </svg>
            </button>
          ))}
        </div>

      </div>

      {/* The one thing that must not hide behind a button: what is currently
          filtering the list, and a way to drop each one. */}
      {selection.size > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {[...selection.entries()].map(([key, mode]) => {
            const option = OPTIONS.get(key)!;
            return (
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
                {option.label}
                <span className="opacity-50">✕</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => update({ f: [], q: "" })}
            className="text-[11px] underline underline-offset-4 opacity-50 hover:opacity-100"
          >
            Reset
          </button>
        </div>
      )}

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
        <Films films={shown} view={view} />
      )}

      {shown.length > 0 &&
        grouping.key !== "none" &&
        buckets.map(([name, films]) => (
          <section key={name} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-lg font-semibold tracking-tight">
                {name}
              </h2>
              <p className="text-[11px] opacity-40">
                {films.length} ·{" "}
                {size(films.reduce((n, m) => n + m.sizeBytes, 0))}
              </p>
            </div>
            <Films films={films} view={view} />
          </section>
        ))}
    </div>
  );
}
