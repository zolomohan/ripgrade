"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { LibraryItem } from "@/lib/library";
import { artUrl, movieId } from "@/lib/routes";

const FILTERS: {
  key: string;
  label: string;
  test: (m: LibraryItem) => boolean;
}[] = [
  { key: "issues", label: "Has issues", test: (m) => m.issues.length > 0 },
  {
    key: "upgrade",
    label: "Needs upgrade",
    test: (m) => m.status.includes("Upgrade"),
  },
  { key: "remux", label: "REMUX", test: (m) => m.releaseType === "REMUX" },
  { key: "encode", label: "Encodes", test: (m) => m.releaseType === "ENCODE" },
  { key: "web", label: "WEB-DL", test: (m) => m.releaseType === "WEB-DL" },
  { key: "dv", label: "Dolby Vision", test: (m) => m.hdr === "Dolby Vision" },
  { key: "hdr", label: "HDR", test: (m) => m.hdr !== "SDR" },
  { key: "sdr", label: "SDR only", test: (m) => m.hdr === "SDR" },
  { key: "atmos", label: "Atmos", test: (m) => m.audio.some((a) => a.atmos) },
  {
    key: "noatmos",
    label: "No Atmos",
    test: (m) => !m.audio.some((a) => a.atmos),
  },
  {
    key: "1080",
    label: "1080p or below",
    test: (m) => m.resolution !== "2160p",
  },
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
const STATUS_THEME: Record<string, { text: string; chip: string }> = {
  Reference: {
    text: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  Excellent: {
    text: "text-teal-600 dark:text-teal-400",
    chip: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  },
  Good: {
    text: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  "Upgrade Recommended": {
    text: "text-orange-600 dark:text-orange-400",
    chip: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  "Must Upgrade": {
    text: "text-red-600 dark:text-red-400",
    chip: "bg-red-500/10 text-red-700 dark:text-red-300",
  },
};

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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-black/10 px-4 py-3 dark:border-white/10">
      <p className="text-[11px] uppercase tracking-widest opacity-45">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
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
    neutral:
      "text-black/55 ring-black/12 dark:text-white/55 dark:ring-white/15",
    warn: "bg-amber-500/[0.08] text-amber-700 ring-amber-500/30 dark:text-amber-300",
    danger: "bg-red-500/[0.08] text-red-700 ring-red-500/30 dark:text-red-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 text-[11px] leading-[18px] font-medium whitespace-nowrap ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function Row({ movie }: { movie: LibraryItem }) {
  const theme = STATUS_THEME[movie.status];
  const object = movie.audio.find((a) => a.atmos || a.dtsx);
  const lossless = movie.audio.find((a) => a.lossless);
  const critical = movie.issues.some((i) => i.severity === "critical");

  return (
    <Link
      href={`/movie/${movieId(movie.path)}`}
      className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
    >
      {movie.poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artUrl(movie.poster)}
          alt=""
          loading="lazy"
          className="h-[72px] w-12 shrink-0 rounded-md object-cover ring-1 ring-black/10 dark:ring-white/10"
        />
      ) : (
        <div className="h-[72px] w-12 shrink-0 rounded-md bg-black/[0.06] dark:bg-white/[0.08]" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
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
            .join("  ·  ")}
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
          {movie.issues.length > 0 && (
            <Chip tone={critical ? "danger" : "warn"}>
              {movie.issues.length}{" "}
              {movie.issues.length === 1 ? "issue" : "issues"}
            </Chip>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span
          className={`rounded-lg px-2.5 py-1 text-lg leading-none font-semibold tabular-nums ${theme.chip}`}
        >
          {movie.scores.overall}
        </span>
        <span className={`text-[11px] font-medium ${theme.text}`}>
          {movie.status}
        </span>
      </div>
    </Link>
  );
}

export function LibraryView({ movies }: { movies: LibraryItem[] }) {
  const [active, setActive] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(SORTS[0].key);

  const shown = useMemo(() => {
    const tests = FILTERS.filter((f) => active.includes(f.key));
    const q = query.trim().toLowerCase();
    const compare = (SORTS.find((s) => s.key === sort) ?? SORTS[0]).compare;

    return movies
      .filter((m) => tests.every((f) => f.test(m)))
      .filter(
        (m) =>
          !q ||
          m.title.toLowerCase().includes(q) ||
          m.fileName.toLowerCase().includes(q),
      )
      .sort(compare);
  }, [movies, active, query, sort]);

  const stats = useMemo(
    () => ({
      total: movies.length,
      size: movies.reduce((sum, m) => sum + m.sizeBytes, 0),
      remux: movies.filter((m) => m.releaseType === "REMUX").length,
      dv: movies.filter((m) => m.hdr === "Dolby Vision").length,
      atmos: movies.filter((m) => m.audio.some((a) => a.atmos)).length,
      issues: movies.filter((m) => m.issues.length > 0).length,
    }),
    [movies],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Movies" value={stats.total} />
        <Stat label="Storage" value={size(stats.size)} />
        <Stat label="REMUX" value={stats.remux} />
        <Stat label="Dolby Vision" value={stats.dv} />
        <Stat label="Atmos" value={stats.atmos} />
        <Stat label="With issues" value={stats.issues} />
      </div>

      <div className="flex flex-col gap-3">
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
              className="w-full rounded-lg border border-black/10 bg-transparent py-2.5 pr-9 pl-9 text-sm outline-none focus:border-black/30 dark:border-white/10 dark:focus:border-white/30"
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
              className="w-full cursor-pointer appearance-none rounded-lg border border-black/10 bg-transparent py-2.5 pr-9 pl-3 text-sm outline-none focus:border-black/30 sm:w-auto dark:border-white/10 dark:focus:border-white/30"
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
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => {
            const on = active.includes(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() =>
                  setActive((prev) =>
                    on ? prev.filter((k) => k !== f.key) : [...prev, f.key],
                  )
                }
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  on
                    ? "border-transparent bg-foreground text-background"
                    : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                }`}
              >
                {f.label}
              </button>
            );
          })}
          {(active.length > 0 || query) && (
            <button
              type="button"
              onClick={() => {
                setActive([]);
                setQuery("");
              }}
              className="ml-1 text-xs underline underline-offset-4 opacity-50 hover:opacity-100"
            >
              Reset
            </button>
          )}
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

      <div className="divide-y divide-black/5 overflow-hidden rounded-xl border border-black/10 dark:divide-white/5 dark:border-white/10">
        {shown.map((movie) => (
          <Row key={movie.path} movie={movie} />
        ))}

        {shown.length === 0 && (
          <p className="px-4 py-12 text-center text-sm opacity-50">
            Nothing matches those filters.
          </p>
        )}
      </div>
    </div>
  );
}
