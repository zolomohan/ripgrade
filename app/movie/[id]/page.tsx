import { notFound } from "next/navigation";

import { artUrl } from "@/lib/routes";
import { type Status } from "@/lib/derive";
import { backupBytes } from "@/lib/convert";
import { getDisc } from "@/lib/disc";
import { getMovie, type LibraryItem } from "@/lib/library";
import { ArtworkEditor } from "./artwork-editor";
import { BackButton } from "./back-button";
import { DiscReview } from "./disc-review";
import { DolbyVision } from "./dolby-vision";
import { FileActions } from "./file-actions";
import { RevealInFinder } from "./reveal-in-finder";
import { MatchReview } from "./match-review";
import { ScoreModal } from "./score-modal";

export const dynamic = "force-dynamic";

// Tailwind needs literal class names, so each status carries its own palette.
const STATUS_THEME: Record<Status, { ring: string }> = {
  "Best Available": { ring: "stroke-emerald-500" },
  Reference: { ring: "stroke-emerald-500" },
  Excellent: { ring: "stroke-emerald-500" },
  Good: { ring: "stroke-amber-500" },
  "Upgrade Recommended": { ring: "stroke-amber-500" },
  "Must Upgrade": { ring: "stroke-red-500" },
};

const SEVERITY_THEME: Record<string, { text: string }> = {
  critical: { text: "text-red-600 dark:text-red-400" },
  warning: { text: "text-amber-600 dark:text-amber-400" },
  info: { text: "opacity-60" },
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

/** One size for both rings — the two scores are peers, not headline and aside. */
const RING_BOX = "h-28 w-28";

function ScoreRing({
  score,
  ring,
  caption,
  ceiling,
}: {
  score: number;
  ring: string;
  caption: string;
  /** The best disc, drawn as a ghost arc behind the score. */
  ceiling?: number;
}) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const short = ceiling !== undefined && score < ceiling;
  const arc = (value: number) => circumference * (1 - value / 100);

  return (
    <div
      className={`relative grid ${RING_BOX} shrink-0 place-items-center`}
      title={short ? `${score} of a possible ${ceiling}` : undefined}
    >
      <svg viewBox="0 0 120 120" className={`${RING_BOX} -rotate-90`}>
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          className="stroke-line"
        />
        {/* How far the best disc reaches — the same mark the meters carry,
            drawn here as an arc rather than a tick. */}
        {ceiling !== undefined && ceiling < 100 && (
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={arc(ceiling)}
            className="stroke-foreground/20"
          />
        )}
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={arc(score)}
          className={
            ceiling === undefined
              ? ring
              : short
                ? "stroke-amber-500/80"
                : "stroke-emerald-500/80"
          }
        />
      </svg>
      <div className="absolute text-center">
        <span className="font-display text-3xl font-semibold tabular-nums">
          {score}
        </span>
        <span className="block text-[10px] tracking-widest uppercase opacity-50">
          {caption}
        </span>
      </div>
    </div>
  );
}

/**
 * A meter with the disc marked on it.
 *
 * The ceiling used to be a single number in a footnote, which said nothing
 * about where the shortfall actually was. Marking each dimension shows it
 * directly: a bar short of its mark is the thing you could buy your way out of,
 * and a bar past its mark is where your copy beats the disc.
 */
/** Below this share of the disc, a picture or sound shortfall is not a nuance. */
const SEVERE_SHORTFALL = 0.8;

function SubScore({
  label,
  value,
  ceiling,
  escalates,
}: {
  label: string;
  value: number;
  ceiling?: number;
  /** Video and audio go red when far short; release only ever goes amber. */
  escalates?: boolean;
}) {
  const short = ceiling !== undefined && value < ceiling;
  const severe =
    escalates && ceiling !== undefined && value / ceiling < SEVERE_SHORTFALL;

  return (
    <div className="flex items-center gap-4">
      <span className="w-16 shrink-0 text-[11px] tracking-widest uppercase opacity-45">
        {label}
      </span>

      <span className="relative h-1.5 flex-1 rounded-full bg-surface-strong">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${
            ceiling === undefined
              ? "bg-foreground/55"
              : severe
                ? "bg-red-500/75"
                : short
                  ? "bg-amber-500/70"
                  : "bg-emerald-500/70"
          }`}
          style={{ width: `${value}%` }}
        />
        {ceiling !== undefined && (
          // Centred on its value rather than starting at it, which also keeps
          // the mark on the track at 100 instead of hanging off the end.
          <span
            aria-hidden
            title={`Best disc: ${ceiling}`}
            className="absolute -top-[5px] h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
            style={{ left: `${ceiling}%` }}
          />
        )}
      </span>

      <span className="w-14 shrink-0 text-right font-display text-sm font-semibold tabular-nums">
        {value}
        {short && (
          <span className="font-sans text-xs font-normal opacity-40">
            /{ceiling}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Format badges for the title block.
 *
 * Official marks are used wherever one exists as a public-domain vector on
 * Wikimedia Commons — below the threshold of originality for copyright, so only
 * a trademark restriction applies, which governs commercial use rather than a
 * private tool. Formats with no usable vector (DTS:X) stay typographic.
 */
type Badge = {
  key: string;
  label: string;
  className?: string;
  /** When set, the official mark replaces the text pill. */
  logo?: {
    src: string;
    height: string;
    invert?: boolean;
    /** For mixed-colour marks, where inverting would ruin the brand fills. */
    darkSrc?: string;
  };
};

/** Black wordmarks flip for dark mode; brand-coloured marks must not. */
const MARK = {
  dolbyVision: {
    src: "/formats/dolby-vision.svg",
    height: "h-3",
    invert: true,
  },
  dolbyAtmos: { src: "/formats/dolby-atmos.svg", height: "h-3", invert: true },
  dolbyTrueHd: {
    src: "/formats/dolby-truehd.svg",
    height: "h-4",
    invert: true,
  },
  dolbyDigitalPlus: {
    src: "/formats/dolby-digital-plus.svg",
    height: "h-4",
    invert: true,
  },
  dolbyDigital: {
    src: "/formats/dolby-digital.svg",
    height: "h-4",
    invert: true,
  },
  ultraHd: { src: "/formats/ultra-hd.svg", height: "h-4", invert: true },
  hdr10: { src: "/formats/hdr10.svg", height: "h-5", invert: true },
  hdr10plus: { src: "/formats/hdr10plus.svg", height: "h-5", invert: true },
  // Orange and blue brand marks — inverting these would wreck them.
  // The DTS wordmark itself has no fill of its own, so it defaults to black and
  // disappears on a dark background; a second file sets the inherited fill to
  // white while leaving the orange and grey brand fills alone.
  dtsX: {
    src: "/formats/dts-x.svg",
    darkSrc: "/formats/dts-x-dark.svg",
    height: "h-5",
  },
  dtsHdMa: {
    src: "/formats/dts-hd-ma.svg",
    darkSrc: "/formats/dts-hd-ma-dark.svg",
    height: "h-5",
  },
  uhdBluray: { src: "/formats/uhd-bluray.svg", height: "h-5" },
} as const;

function FormatBadges({ movie }: { movie: LibraryItem }) {
  const OUTLINE = "ring-1 ring-inset ring-line-strong opacity-70";
  const badges: Badge[] = [];

  // The Ultra HD Blu-ray mark is a claim about the source, so it is only used
  // where that is actually true — a 2160p web pull gets the neutral text badge.
  if (movie.resolution === "2160p" && movie.releaseType === "REMUX") {
    badges.push({
      key: "src",
      label: "Ultra HD Blu-ray",
      logo: MARK.uhdBluray,
    });
  } else if (movie.resolution === "2160p") {
    badges.push({ key: "res", label: "Ultra HD", logo: MARK.ultraHd });
  } else if (movie.resolution !== "unknown") {
    badges.push({ key: "res", label: movie.resolution, className: OUTLINE });
  }

  if (movie.hdr === "Dolby Vision") {
    badges.push({ key: "dv", label: "Dolby Vision", logo: MARK.dolbyVision });
  } else if (movie.hdr === "HDR10+") {
    badges.push({ key: "hdr", label: "HDR10+", logo: MARK.hdr10plus });
  } else if (movie.hdr === "HDR10") {
    badges.push({ key: "hdr", label: "HDR10", logo: MARK.hdr10 });
  }

  const atmos = movie.audio.find((a) => a.atmos);
  const dtsx = movie.audio.find((a) => a.dtsx);
  const lossless = movie.audio.find((a) => a.lossless);
  const primary = movie.audio[0];

  if (atmos) {
    badges.push({ key: "atmos", label: "Dolby Atmos", logo: MARK.dolbyAtmos });
  } else if (dtsx) {
    badges.push({ key: "dtsx", label: "DTS:X", logo: MARK.dtsX });
  } else if (lossless && /TrueHD/i.test(lossless.label)) {
    badges.push({ key: "au", label: "Dolby TrueHD", logo: MARK.dolbyTrueHd });
  } else if (lossless && /DTS-HD Master/i.test(lossless.label)) {
    badges.push({
      key: "au",
      label: "DTS-HD Master Audio",
      logo: MARK.dtsHdMa,
    });
  } else if (lossless) {
    badges.push({
      key: "au",
      label: lossless.format.toUpperCase(),
      className: OUTLINE,
    });
  } else if (primary && /Digital Plus/i.test(primary.label)) {
    badges.push({
      key: "au",
      label: "Dolby Digital Plus",
      logo: MARK.dolbyDigitalPlus,
    });
  } else if (primary && /Dolby Digital/i.test(primary.label)) {
    badges.push({ key: "au", label: "Dolby Digital", logo: MARK.dolbyDigital });
  } else if (primary) {
    badges.push({
      key: "au",
      label: primary.format.toUpperCase(),
      className: OUTLINE,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {badges.map((badge) =>
        badge.logo ? (
          badge.logo.darkSrc ? (
            <span key={badge.key} title={badge.label}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={badge.logo.src}
                alt={badge.label}
                className={`${badge.logo.height} w-auto dark:hidden`}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={badge.logo.darkSrc}
                alt=""
                aria-hidden
                className={`hidden ${badge.logo.height} w-auto dark:block`}
              />
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={badge.key}
              src={badge.logo.src}
              alt={badge.label}
              title={badge.label}
              className={`${badge.logo.height} w-auto ${
                badge.logo.invert ? "opacity-90 dark:invert" : ""
              }`}
            />
          )
        ) : (
          <span
            key={badge.key}
            className={`rounded-chip px-2 py-1 text-[10px] font-semibold tracking-[0.12em] ${badge.className}`}
          >
            {badge.label}
          </span>
        ),
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
      // The grid had a Video row and no Audio counterpart; the per-track table
      // further down is the detail, this is the summary.
      "Audio",
      (() => {
        const best =
          movie.audio.find((a) => a.atmos || a.dtsx) ??
          movie.audio.find((a) => a.lossless) ??
          movie.audio[0];
        if (!best) return "none";

        const others = movie.audio.length - 1;
        return (
          [
            best.label,
            best.channels ? `${best.channels}ch` : null,
            best.lossless ? "lossless" : "lossy",
            best.bitrateKbps
              ? `${best.bitrateKbps.toLocaleString()} kbps`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") +
          (others > 0
            ? ` · +${others} more track${others === 1 ? "" : "s"}`
            : "")
        );
      })(),
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
    ...(movie.edition
      ? ([["Edition", movie.edition]] as [string, string][])
      : []),
    ["Subtitles", movie.subtitleLanguages.join(", ") || "none"],
    ...(movie.imdbId ? ([["IMDb", movie.imdbId]] as [string, string][]) : []),
    ["Path", movie.path],
  ];

  return (
    <div className="rounded-card border border-line bg-surface p-5">
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
  // Full specs live in the disc table; the derived payload only carries the gaps.
  const disc = movie.tmdb ? getDisc(movie.tmdb.id) : undefined;

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
          <div className="absolute inset-0 bg-surface-strong" />
        )}

        <BackButton />

        <div className="absolute top-6 right-6 flex items-center gap-2">
          <RevealInFinder moviePath={movie.path} />
          {movie.tmdb && (
            <ArtworkEditor moviePath={movie.path} tmdbId={movie.tmdb.id} />
          )}
        </div>
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
              className="h-60 w-40 shrink-0 rounded-card object-cover shadow-2xl ring-1 ring-line"
            />
          )}

          <div className="flex flex-col gap-2 pb-1">
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {movie.title}
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm opacity-60">
              {/* Dynamic range moved out: the logos directly below say it
                  better. Edition lives in Technical details. */}
              {movie.year && <span>{movie.year}</span>}
              <span>· {movie.resolution}</span>
              <span>· {movie.releaseType}</span>
              <span>· {bytes(movie.sizeBytes)}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <FormatBadges movie={movie} />
            </div>
          </div>
        </div>

        {/* Scores */}
        <section className="relative mt-10 flex flex-col items-center gap-8 rounded-card border border-line bg-surface p-6 sm:flex-row sm:items-stretch">
          <div className="flex shrink-0 flex-col items-center justify-center gap-3">
            <div className="flex items-center gap-5">
              <ScoreRing
                score={movie.scores.overall}
                ring={theme.ring}
                caption={breakdown.relative ? "vs disc" : "overall"}
              />
              {/* The rubric score, kept neutral so the verdict colour stays
                  unique to the comparison. */}
              {breakdown.relative && (
                <ScoreRing
                  score={breakdown.absolute}
                  ring="stroke-foreground/35"
                  caption="absolute"
                  ceiling={breakdown.discScore}
                />
              )}
            </div>
            {/* No status pill: the ring colour says it, exactly as in the
                library list. Kept for screen readers, which cannot see colour. */}
            <span className="sr-only">{movie.status}</span>
          </div>

          {/* A vertical rule on wide screens keeps the ring and the breakdown
              reading as two halves of one card rather than a loose stack. */}
          <div className="hidden w-px shrink-0 bg-line sm:block" />

          <div className="flex w-full flex-1 flex-col justify-center gap-3">
            <SubScore
              label="Video"
              value={movie.scores.video}
              ceiling={movie.disc?.discParts?.video}
              escalates
            />
            <SubScore
              label="Audio"
              value={movie.scores.audio}
              ceiling={movie.disc?.discParts?.audio}
              escalates
            />
            <SubScore
              label="Release"
              value={movie.scores.release}
              ceiling={movie.disc?.discParts?.release}
            />

            {movie.disc?.discParts && (
              <p className="mt-1 border-t border-line pt-3 text-xs opacity-45">
                The mark on each bar is the best disc available. Amber means
                your copy falls short of it.
              </p>
            )}
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

        {/* Issues, and the actions that resolve them */}
        <section className="mt-8 flex flex-col gap-3">
          <h2 className="text-sm font-medium tracking-wide uppercase opacity-50">
            Issues
          </h2>

          <div className="rounded-card border border-line bg-surface p-5">
            {movie.issues.length === 0 ? (
              <p className="text-sm opacity-50">
                Nothing flagged on this file.
              </p>
            ) : (
              // Rows rather than nested cards: the section border already frames
              // them, and a border inside a border reads as clutter.
              <div className="divide-y divide-line">
                {movie.issues.map((issue) => (
                  <div key={issue.code} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-xs font-semibold uppercase ${SEVERITY_THEME[issue.severity].text}`}
                      >
                        {issue.severity}
                      </span>
                      <code className="font-mono text-xs opacity-40">
                        {issue.code}
                      </code>
                    </div>
                    <p className="mt-1 text-sm">{issue.message}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 border-t border-line pt-4">
              <FileActions
                moviePath={movie.path}
                acknowledged={movie.acknowledged}
                note={movie.note}
                hasIssues={movie.issues.length > 0}
              />
            </div>
          </div>
        </section>

        {/* What is actually inside the Dolby Vision stream */}
        {movie.hdr === "Dolby Vision" && (
          <DolbyVision
            moviePath={movie.path}
            fileName={movie.fileName}
            dvProfile={movie.dvProfile}
            durationSec={movie.durationSec}
            frameRate={movie.frameRate}
            scan={movie.dovi}
            hdr10={movie.hdr10}
            backupBytes={backupBytes(movie.path)}
          />
        )}

        {/* TMDb identity */}
        {movie.tmdb && (
          <section className="mt-10 flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-sm font-medium tracking-wide uppercase opacity-50">
                Identified as
              </h2>
              <span
                className={`rounded-chip px-1.5 text-[11px] leading-[18px] font-medium ring-1 ring-inset ${
                  movie.tmdb.confidence === "high"
                    ? "text-emerald-700 ring-emerald-500/30 dark:text-emerald-300"
                    : "bg-amber-500/[0.08] text-amber-700 ring-amber-500/30 dark:text-amber-300"
                }`}
              >
                {movie.tmdb.confidence} confidence
              </span>
            </div>

            <div className="rounded-card border border-line bg-surface p-5">
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
            <div className="rounded-card border border-amber-500/30 bg-amber-500/[0.06] p-5">
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

        {/* Best disc available */}
        {movie.tmdb && (
          <section className="mt-10 flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-sm font-medium tracking-wide uppercase opacity-50">
                Best disc available
              </h2>
              {disc?.best && movie.disc?.bestAvailable && (
                <span className="rounded-chip px-1.5 text-[11px] leading-[18px] font-medium text-emerald-700 ring-1 ring-emerald-500/30 ring-inset dark:text-emerald-300">
                  your copy matches it
                </span>
              )}
            </div>

            <div className="rounded-card border border-line bg-surface p-5">
              {!disc || disc.error || !disc.best ? (
                <p className="text-sm opacity-60">
                  {disc
                    ? `No disc release found on Blu-ray.com${disc.error ? ` — ${disc.error}` : ""}.`
                    : "Not looked up yet — this happens automatically during a scan."}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <p className="font-medium">
                      {disc.best.title}
                      <span className="ml-2 rounded-chip px-1.5 text-[11px] leading-[18px] font-medium ring-1 ring-line-strong ring-inset">
                        {disc.best.format}
                      </span>
                    </p>
                    <a
                      href={disc.best.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm underline underline-offset-4 opacity-60 hover:opacity-100"
                    >
                      View on Blu-ray.com ↗
                    </a>
                  </div>

                  <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-x-6 gap-y-2.5 text-sm">
                    {(
                      [
                        [
                          "Video",
                          [
                            disc.best.videoCodec,
                            disc.best.videoBitrateMbps
                              ? `${disc.best.videoBitrateMbps} Mbps`
                              : null,
                            disc.best.resolution,
                          ]
                            .filter(Boolean)
                            .join(" · "),
                        ],
                        ["Dynamic range", disc.best.hdr.join(", ") || "SDR"],
                        ["Aspect ratio", disc.best.aspectRatio ?? "unknown"],
                        ["Audio", disc.best.audio.join(" · ") || "unknown"],
                        [
                          "Editions",
                          `${disc.releaseCount} on Blu-ray.com${
                            disc.uhdExists
                              ? " · 4K available"
                              : " · no 4K release"
                          }`,
                        ],
                      ] as [string, string][]
                    ).map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="opacity-50">{label}</dt>
                        <dd className="font-mono text-xs break-all">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  {movie.disc && movie.disc.gaps.length > 0 && (
                    <div className="mt-4 border-t border-line pt-4">
                      <p className="text-xs tracking-wide uppercase opacity-45">
                        Where your copy falls short
                      </p>
                      <ul className="mt-2 flex flex-col gap-1 text-sm">
                        {movie.disc.gaps.map((gap) => (
                          <li key={gap} className="flex gap-2">
                            <span className="opacity-30">—</span>
                            {gap}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              <DiscReview
                tmdbId={movie.tmdb.id}
                title={movie.tmdb.title}
                year={movie.tmdb.year}
                currentUrl={disc?.best?.url}
                manual={disc?.manual}
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
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide opacity-50">
                <tr>
                  <th className="px-4 py-2 font-medium">Format</th>
                  <th className="px-4 py-2 font-medium">Channels</th>
                  <th className="px-4 py-2 font-medium">Language</th>
                  <th className="px-4 py-2 text-right font-medium">Bitrate</th>
                </tr>
              </thead>
              <tbody>
                {movie.audio.map((track, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
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
