import { notFound } from "next/navigation";

import { artUrl } from "@/lib/routes";
import { type Status } from "@/lib/derive";
import { getMovie, type LibraryItem } from "@/lib/library";
import { ArtworkEditor } from "./artwork-editor";
import { BackButton } from "./back-button";
import { MatchReview } from "./match-review";
import { ScoreModal } from "./score-modal";

export const dynamic = "force-dynamic";

// Tailwind needs literal class names, so each status carries its own palette.
const STATUS_THEME: Record<Status, { text: string; bg: string; ring: string }> =
  {
    Reference: {
      text: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10",
      ring: "stroke-emerald-500",
    },
    Excellent: {
      text: "text-teal-600 dark:text-teal-400",
      bg: "bg-teal-500/10",
      ring: "stroke-teal-500",
    },
    Good: {
      text: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-500/10",
      ring: "stroke-amber-500",
    },
    "Upgrade Recommended": {
      text: "text-orange-600 dark:text-orange-400",
      bg: "bg-orange-500/10",
      ring: "stroke-orange-500",
    },
    "Must Upgrade": {
      text: "text-red-600 dark:text-red-400",
      bg: "bg-red-500/10",
      ring: "stroke-red-500",
    },
  };

const SEVERITY_THEME: Record<string, { text: string; border: string }> = {
  critical: {
    text: "text-red-600 dark:text-red-400",
    border: "border-red-500/40",
  },
  warning: {
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/40",
  },
  info: { text: "opacity-60", border: "border-black/15 dark:border-white/15" },
};

function bytes(n: number) {
  return n >= 1e12
    ? `${(n / 1e12).toFixed(2)} TB`
    : `${(n / 1e9).toFixed(1)} GB`;
}

function duration(seconds?: number) {
  if (!seconds) return "unknown";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function ScoreRing({ score, ring }: { score: number; ring: string }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative grid h-36 w-36 shrink-0 place-items-center">
      <svg viewBox="0 0 120 120" className="h-36 w-36 -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          className="stroke-black/10 dark:stroke-white/10"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          className={ring}
        />
      </svg>
      <div className="absolute text-center">
        <span className="text-4xl font-semibold tabular-nums">{score}</span>
        <span className="block text-[10px] uppercase tracking-widest opacity-50">
          overall
        </span>
      </div>
    </div>
  );
}

function SubScore({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide opacity-60">
          {label}
        </span>
        <span className="text-sm font-medium tabular-nums">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className="h-full rounded-full bg-foreground/70"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Format badges for the title block.
 *
 * These are typographic marks, not the Dolby/DTS logos — those are licensed
 * trademark artwork and are not ours to bundle. The styling follows how the
 * marks appear on packaging: Dolby formats as an inverted wordmark, the rest
 * tinted by family. Swapping in licensed SVGs later means changing only the
 * `label` of the relevant entry.
 */
function FormatBadges({ movie }: { movie: LibraryItem }) {
  const DOLBY = "bg-foreground text-background";
  const OUTLINE =
    "ring-1 ring-inset ring-black/15 dark:ring-white/20 opacity-70";

  const badges: { key: string; label: string; className: string }[] = [];

  if (movie.resolution === "2160p") {
    badges.push({ key: "res", label: "4K ULTRA HD", className: OUTLINE });
  } else if (movie.resolution !== "unknown") {
    badges.push({ key: "res", label: movie.resolution, className: OUTLINE });
  }

  if (movie.hdr === "Dolby Vision") {
    badges.push({ key: "dv", label: "DOLBY VISION", className: DOLBY });
  } else if (movie.hdr === "HDR10+") {
    badges.push({
      key: "hdr",
      label: "HDR10+",
      className:
        "bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-300",
    });
  } else if (movie.hdr === "HDR10") {
    badges.push({
      key: "hdr",
      label: "HDR10",
      className:
        "bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-300",
    });
  }

  const atmos = movie.audio.find((a) => a.atmos);
  const dtsx = movie.audio.find((a) => a.dtsx);
  const lossless = movie.audio.find((a) => a.lossless);

  if (atmos) {
    badges.push({ key: "atmos", label: "DOLBY ATMOS", className: DOLBY });
  }
  if (dtsx) {
    badges.push({
      key: "dtsx",
      label: "DTS:X",
      className:
        "bg-sky-500/15 text-sky-700 ring-1 ring-inset ring-sky-500/30 dark:text-sky-300",
    });
  }
  if (!atmos && !dtsx && lossless) {
    badges.push({
      key: "lossless",
      label: /TrueHD/i.test(lossless.label)
        ? "DOLBY TRUEHD"
        : /DTS-HD Master/i.test(lossless.label)
          ? "DTS-HD MA"
          : lossless.format.toUpperCase(),
      className: OUTLINE,
    });
  }

  if (movie.releaseType === "REMUX") {
    badges.push({ key: "remux", label: "REMUX", className: OUTLINE });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge.key}
          className={`rounded px-2 py-1 text-[10px] font-semibold tracking-[0.12em] ${badge.className}`}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

function Spec({ movie }: { movie: LibraryItem }) {
  const rows: [string, string][] = [
    ["File", movie.fileName],
    ["Size", bytes(movie.sizeBytes)],
    ["Runtime", duration(movie.durationSec)],
    [
      "Video",
      `${movie.width ?? "?"}×${movie.height ?? "?"} · ${movie.videoCodec ?? "?"} · ${
        movie.bitDepth ?? "?"
      }-bit · ${movie.videoBitrateKbps?.toLocaleString() ?? "?"} kbps${
        movie.frameRate ? ` · ${movie.frameRate} fps` : ""
      }`,
    ],
    [
      "Dynamic range",
      movie.hdr === "Dolby Vision"
        ? `Dolby Vision Profile ${movie.dvProfile ?? "?"} · ${
            movie.dvHasHdr10Fallback
              ? "HDR10 fallback present"
              : "no HDR10 fallback"
          }`
        : movie.hdr,
    ],
    [
      "Release",
      `${movie.releaseType}${movie.encoder ? ` · ${movie.encoder}` : ""}`,
    ],
    [
      "Bitrate density",
      movie.bpp ? `${movie.bpp.toFixed(3)} bits/pixel/frame` : "unknown",
    ],
    ...(movie.crf !== undefined
      ? ([["CRF", String(movie.crf)]] as [string, string][])
      : []),
    ...(movie.aspectRatio
      ? ([["Aspect ratio", `${movie.aspectRatio}:1`]] as [string, string][])
      : []),
    ["Subtitles", movie.subtitleLanguages.join(", ") || "none"],
    ...(movie.imdbId ? ([["IMDb", movie.imdbId]] as [string, string][]) : []),
    ["Path", movie.path],
  ];

  return (
    <div className="rounded-xl border border-black/15 p-5 dark:border-white/15">
      <dl className="grid grid-cols-[9rem_1fr] gap-x-6 gap-y-2.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="opacity-50">{label}</dt>
            <dd className="font-mono text-xs break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default async function MoviePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const movie = getMovie(id);
  if (!movie) notFound();

  const theme = STATUS_THEME[movie.status];
  const { breakdown } = movie;

  return (
    <main className="flex flex-col pb-16">
      {/* Hero */}
      <div className="relative h-96 w-full overflow-hidden sm:h-[32rem]">
        {movie.fanart ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artUrl(movie.fanart)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
          </>
        ) : (
          <div className="absolute inset-0 bg-black/5 dark:bg-white/5" />
        )}

        <BackButton />

        {movie.tmdb && (
          <ArtworkEditor moviePath={movie.path} tmdbId={movie.tmdb.id} />
        )}
      </div>

      {/* relative + z-10: the hero above is positioned, so without its own
          stacking position this content would paint underneath it and the
          poster overlapping the backdrop would be clipped. */}
      <div className="relative z-10 mx-auto -mt-28 w-full max-w-5xl px-6 sm:px-8">
        {/* Title block */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
          {movie.poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={artUrl(movie.poster)}
              alt=""
              className="h-60 w-40 shrink-0 rounded-xl object-cover shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
            />
          )}

          <div className="flex flex-col gap-2 pb-1">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {movie.title}
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm opacity-60">
              {movie.year && <span>{movie.year}</span>}
              {movie.edition && <span>· {movie.edition}</span>}
              <span>· {movie.resolution}</span>
              <span>· {movie.hdr}</span>
              <span>· {movie.releaseType}</span>
              <span>· {bytes(movie.sizeBytes)}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <FormatBadges movie={movie} />
            </div>
          </div>
        </div>

        {/* Scores */}
        <section className="relative mt-10 flex flex-col items-center gap-8 rounded-2xl border border-black/15 p-6 sm:flex-row dark:border-white/15">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <ScoreRing score={movie.scores.overall} ring={theme.ring} />
            <span className={`text-sm font-medium ${theme.text}`}>
              {movie.status}
            </span>
            {movie.priority !== "None" && (
              <span className="text-xs opacity-50">
                {movie.priority} priority
              </span>
            )}
          </div>
          <div className="grid w-full flex-1 gap-4 sm:grid-cols-3">
            <SubScore label="Video" value={movie.scores.video} />
            <SubScore label="Audio" value={movie.scores.audio} />
            <SubScore label="Release" value={movie.scores.release} />
          </div>
          <ScoreModal scores={movie.scores} breakdown={breakdown} />
        </section>

        {/* Summary */}
        <ul className="mt-6 flex flex-col gap-1.5 text-sm opacity-80">
          {movie.reasons.map((reason, i) => (
            <li key={i} className="flex gap-2">
              <span className="opacity-30">—</span>
              {reason}
            </li>
          ))}
        </ul>

        {/* Issues */}
        {movie.issues.length > 0 && (
          <section className="mt-8 flex flex-col gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
              Issues
            </h2>
            {movie.issues.map((issue) => {
              const style = SEVERITY_THEME[issue.severity];
              return (
                <div
                  key={issue.code}
                  className={`rounded-xl border px-4 py-3 ${style.border}`}
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-xs font-semibold uppercase ${style.text}`}
                    >
                      {issue.severity}
                    </span>
                    <code className="font-mono text-xs opacity-40">
                      {issue.code}
                    </code>
                  </div>
                  <p className="mt-1 text-sm">{issue.message}</p>
                </div>
              );
            })}
          </section>
        )}

        {/* TMDb identity */}
        {movie.tmdb && (
          <section className="mt-10 flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-sm font-medium tracking-wide uppercase opacity-50">
                Identified as
              </h2>
              <span
                className={`rounded-md px-1.5 text-[11px] leading-[18px] font-medium ring-1 ring-inset ${
                  movie.tmdb.confidence === "high"
                    ? "text-emerald-700 ring-emerald-500/30 dark:text-emerald-300"
                    : "bg-amber-500/[0.08] text-amber-700 ring-amber-500/30 dark:text-amber-300"
                }`}
              >
                {movie.tmdb.confidence} confidence
              </span>
            </div>

            <div className="rounded-xl border border-black/10 p-5 dark:border-white/10">
              <p className="font-medium">
                {movie.tmdb.title}
                {movie.tmdb.year && (
                  <span className="ml-1.5 font-normal opacity-40">
                    {movie.tmdb.year}
                  </span>
                )}
              </p>

              {movie.tmdb.overview && (
                <p className="mt-2 text-sm opacity-70">{movie.tmdb.overview}</p>
              )}

              <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-x-6 gap-y-2 text-sm">
                {movie.tmdb.runtimeMinutes && (
                  <div className="contents">
                    <dt className="opacity-50">Listed runtime</dt>
                    <dd>
                      {movie.tmdb.runtimeMinutes} min
                      {movie.durationSec && (
                        <span className="opacity-50">
                          {" "}
                          · file is {Math.round(movie.durationSec / 60)} min
                        </span>
                      )}
                    </dd>
                  </div>
                )}
                {movie.tmdb.collection && (
                  <div className="contents">
                    <dt className="opacity-50">Collection</dt>
                    <dd>{movie.tmdb.collection}</dd>
                  </div>
                )}
                {movie.tmdb.genres && movie.tmdb.genres.length > 0 && (
                  <div className="contents">
                    <dt className="opacity-50">Genres</dt>
                    <dd>{movie.tmdb.genres.join(", ")}</dd>
                  </div>
                )}
                <div className="contents">
                  <dt className="opacity-50">TMDb</dt>
                  <dd>
                    <a
                      href={`https://www.themoviedb.org/movie/${movie.tmdb.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4 opacity-70 hover:opacity-100"
                    >
                      {movie.tmdb.id}
                    </a>
                  </dd>
                </div>
              </dl>

              {movie.tmdb.confidence !== "high" && (
                <p className="mt-4 text-xs opacity-50">
                  This match was a best guess from the filename, so runtime
                  checks are skipped for it — a wrong match would invent a
                  discrepancy that means nothing.
                </p>
              )}

              <MatchReview
                moviePath={movie.path}
                currentId={movie.tmdb.id}
                needsReview={movie.tmdb.confidence !== "high"}
                defaultQuery={movie.title}
              />
            </div>
          </section>
        )}

        {!movie.tmdb && (
          <section className="mt-10 flex flex-col gap-3">
            <h2 className="text-sm font-medium tracking-wide uppercase opacity-50">
              Not identified
            </h2>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-5">
              <p className="text-sm">
                No TMDb match was found for this file, so there is no canonical
                title, runtime or artwork for it. Search below to link it by
                hand — the link is kept as a manual match and later scans will
                not overwrite it.
              </p>

              <MatchReview
                moviePath={movie.path}
                needsReview={false}
                defaultQuery={
                  movie.edition
                    ? movie.title.replace(movie.edition, "").trim()
                    : movie.title
                }
              />
            </div>
          </section>
        )}

        {/* Technical */}
        <section className="mt-10 flex flex-col gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
            Technical details
          </h2>
          <Spec movie={movie} />
        </section>

        {/* Audio tracks */}
        <section className="mt-8 flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
            Audio tracks ({movie.audio.length})
          </h2>
          <div className="overflow-x-auto rounded-xl border border-black/15 dark:border-white/15">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-black/10 text-xs uppercase tracking-wide opacity-50 dark:border-white/10">
                <tr>
                  <th className="px-4 py-2 font-medium">Format</th>
                  <th className="px-4 py-2 font-medium">Channels</th>
                  <th className="px-4 py-2 font-medium">Language</th>
                  <th className="px-4 py-2 text-right font-medium">Bitrate</th>
                </tr>
              </thead>
              <tbody>
                {movie.audio.map((track, i) => (
                  <tr
                    key={i}
                    className="border-b border-black/5 last:border-0 dark:border-white/5"
                  >
                    <td className="px-4 py-2">{track.label}</td>
                    <td className="px-4 py-2 opacity-70">
                      {track.channels || "—"}
                    </td>
                    <td className="px-4 py-2 opacity-70">
                      {track.language ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums opacity-70">
                      {track.bitrateKbps
                        ? `${track.bitrateKbps.toLocaleString()} kbps`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
