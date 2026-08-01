import Link from "next/link";
import { notFound } from "next/navigation";

import { artUrl } from "@/lib/routes";
import {
  VIDEO_CEILING_BONUS,
  WEIGHTS,
  type ScoreLine,
  type Status,
} from "@/lib/derive";
import { getMovie, type LibraryItem } from "@/lib/library";

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

function LineRow({ line }: { line: ScoreLine }) {
  const full = line.points === line.max;

  return (
    <div className="grid grid-cols-[10rem_1fr_auto] items-baseline gap-4 border-b border-black/5 py-2.5 last:border-0 dark:border-white/5">
      <span className="text-sm opacity-60">{line.label}</span>
      <span className="text-sm">
        {line.detail}
        {line.note && (
          <span className="mt-0.5 block text-xs opacity-50">{line.note}</span>
        )}
      </span>
      <span
        className={`font-mono text-sm tabular-nums ${full ? "" : "opacity-50"}`}
      >
        {line.points}
        <span className="opacity-40">/{line.max}</span>
      </span>
    </div>
  );
}

function Component({
  title,
  weight,
  score,
  lines,
}: {
  title: string;
  weight: number;
  score: number;
  lines: ScoreLine[];
}) {
  const lost = lines.reduce((sum, l) => sum + (l.max - l.points), 0);

  return (
    <div className="rounded-xl border border-black/15 p-5 dark:border-white/15">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-medium">
          {title}
          <span className="ml-2 text-xs opacity-50">
            {Math.round(weight * 100)}% of overall
          </span>
        </h3>
        <span className="text-lg font-semibold tabular-nums">{score}</span>
      </div>

      <div className="mt-3">
        {lines.map((line) => (
          <LineRow key={line.label} line={line} />
        ))}
      </div>

      {lost > 0 && (
        <p className="mt-3 text-xs opacity-50">
          {lost} {lost === 1 ? "point" : "points"} left on the table.
        </p>
      )}
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
    <dl className="grid grid-cols-[9rem_1fr] gap-x-6 gap-y-2.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="opacity-50">{label}</dt>
          <dd className="font-mono text-xs break-all">{value}</dd>
        </div>
      ))}
    </dl>
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
      <div className="relative h-64 w-full overflow-hidden sm:h-80">
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

        <Link
          href="/"
          className="absolute top-6 left-6 rounded-md bg-background/80 px-3 py-1.5 text-sm backdrop-blur hover:bg-background"
        >
          ← Library
        </Link>
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
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${theme.bg} ${theme.text}`}
              >
                {movie.status}
              </span>
              {movie.priority !== "None" && (
                <span className="rounded-full border border-black/15 px-3 py-1 text-sm opacity-70 dark:border-white/15">
                  {movie.priority} priority
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Scores */}
        <section className="mt-10 flex flex-col items-center gap-8 rounded-2xl border border-black/15 p-6 sm:flex-row dark:border-white/15">
          <ScoreRing score={movie.scores.overall} ring={theme.ring} />
          <div className="grid w-full flex-1 gap-4 sm:grid-cols-3">
            <SubScore label="Video" value={movie.scores.video} />
            <SubScore label="Audio" value={movie.scores.audio} />
            <SubScore label="Release" value={movie.scores.release} />
          </div>
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

        {/* Score explanation */}
        <section className="mt-10 flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold">Why this score</h2>
            <p className="mt-1 text-sm opacity-60">
              Each category is scored out of 100 from the criteria below, then
              blended. The right-hand column shows points awarded against the
              most that criterion can pay.
            </p>
          </div>

          <Component
            title="Video"
            weight={WEIGHTS.video}
            score={movie.scores.video}
            lines={breakdown.video}
          />
          <Component
            title="Audio"
            weight={WEIGHTS.audio}
            score={movie.scores.audio}
            lines={breakdown.audio}
          />
          <Component
            title="Release"
            weight={WEIGHTS.release}
            score={movie.scores.release}
            lines={breakdown.release}
          />

          <div className="rounded-xl border border-black/15 p-5 dark:border-white/15">
            <h3 className="font-medium">Final calculation</h3>
            <div className="mt-3 flex flex-col gap-2 font-mono text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <span className="opacity-70">
                  {movie.scores.video} × {WEIGHTS.video} + {movie.scores.audio}{" "}
                  × {WEIGHTS.audio} + {movie.scores.release} × {WEIGHTS.release}
                </span>
                <span className="tabular-nums">{breakdown.weighted}</span>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="opacity-70">
                  video ceiling ({movie.scores.video} + {VIDEO_CEILING_BONUS})
                </span>
                <span className="tabular-nums">{breakdown.ceiling}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-black/10 pt-2 dark:border-white/10">
                <span>
                  {breakdown.cappedByVideo
                    ? "capped at the ceiling"
                    : "lower of the two"}
                </span>
                <span className="text-base font-semibold tabular-nums">
                  {movie.scores.overall}
                </span>
              </div>
            </div>

            <p className="mt-3 text-xs opacity-50">
              {breakdown.cappedByVideo
                ? `The weighted total reached ${breakdown.weighted}, but strong audio and a clean container cannot lift a file more than ${VIDEO_CEILING_BONUS} points above its picture quality.`
                : "The ceiling did not bind here — the weighted total was already below it."}
            </p>
          </div>

          <p className="text-sm opacity-60">
            The full rubric, including every threshold, is on the{" "}
            <Link href="/how-it-works" className="underline underline-offset-4">
              How it works
            </Link>{" "}
            page.
          </p>
        </section>

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
