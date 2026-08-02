"use client";

import Link from "next/link";
import { useState } from "react";

import { ArtworkEditor } from "@/app/movie/[id]/artwork-editor";
import { BackButton } from "@/app/movie/[id]/back-button";
import { MatchReview } from "@/app/movie/[id]/match-review";
import { FormatBadges } from "@/app/format-badges";
import { PillCount } from "@/app/controls";
import { ScoreCircle } from "@/app/score-circle";
import { ScoreRing, SubScore } from "@/app/score-card";
import { openIssues } from "@/lib/derive";
import { imageUrl } from "@/lib/image-url";
import { artUrl, movieId } from "@/lib/routes";
import type { MissingEpisode, Show, ShowEpisode } from "@/lib/shows";

/**
 * A show, season by season.
 *
 * Episodes expand in place rather than each having a page: a season is read as
 * a run, and the question asked of one episode — why is this the odd one out —
 * only means anything with its neighbours still on screen.
 */

const size = (bytes: number) =>
  bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(2)} TB`
    : `${(bytes / 1e9).toFixed(1)} GB`;

const SCORE_RING = (score: number) =>
  score >= 78
    ? "stroke-emerald-500"
    : score >= 62
      ? "stroke-amber-500"
      : "stroke-red-500";

const SCORE_TONE = (score: number) =>
  score >= 78
    ? "text-emerald-600 dark:text-emerald-400"
    : score >= 62
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";

/** Rounded, and 0 for an empty season rather than NaN. */
const average = (values: number[]) =>
  values.length === 0
    ? 0
    : Math.round(values.reduce((n, v) => n + v, 0) / values.length);

/**
 * A synopsis, cut to a length the title block can hold.
 *
 * The block bottom-aligns with the poster, so its height pushes the title
 * upward — a five-sentence synopsis lifted the title clear off the artwork. Cut
 * on a word so it reads as a sentence that stops, with the whole text on the
 * element's title for anyone who wants it.
 */
const SYNOPSIS_WORDS = 34;

const trim = (text: string) => {
  const words = text.split(/\s+/);
  return words.length <= SYNOPSIS_WORDS
    ? text
    : `${words
        .slice(0, SYNOPSIS_WORDS)
        .join(" ")
        .replace(/[,.;:]$/, "")}…`;
};

const airDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const duration = (sec?: number) =>
  sec ? `${Math.round(sec / 60)} min` : undefined;

/** One fact about the file, as a label over its value. */
function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] tracking-[0.1em] uppercase opacity-40">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-xs" title={value}>
        {value || "—"}
      </dd>
    </div>
  );
}

/**
 * One episode, whole.
 *
 * It used to be a row that opened; every row was worth opening, which is the
 * definition of a control that should not exist. The card is what was inside
 * it, laid out so a season can be read straight down.
 */
function Episode({ episode }: { episode: ShowEpisode }) {
  const item = episode.item;
  const issues = openIssues(item);

  return (
    <li className="row-enter">
      {/* The whole card is the link — everything on it is about one file, so
          anywhere on it is the same destination. */}
      <Link
        href={`/movie/${movieId(item.path)}`}
        className="group flex flex-col gap-5 rounded-card border border-line bg-surface p-5 transition-colors hover:bg-surface-strong sm:flex-row"
      >
        {/* The still leads: a picture is how you recognise which episode this is,
          and the rest of the card is numbers. */}
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-card bg-surface-strong ring-1 ring-line sm:w-56">
          {episode.stillPath && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl(episode.stillPath, "w300")}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}

          {/* A count on the image, as on the film grid — what the issues are is
            the file page's job, and listing them here made every flawed episode
            twice the height of a clean one. */}
          {issues.length > 0 && (
            <span
              className="absolute bottom-2 left-2 rounded-chip bg-background/85 px-1.5 text-[10px] leading-[18px] font-medium text-amber-700 backdrop-blur dark:text-amber-300"
              title={issues.map((issue) => issue.message).join("\n")}
            >
              {issues.length} {issues.length === 1 ? "issue" : "issues"}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-mono text-xs opacity-40">
                  E{String(episode.number).padStart(2, "0")}
                  {episode.numberEnd &&
                    `–${String(episode.numberEnd).padStart(2, "0")}`}
                </span>
                <span className="min-w-0 truncate font-medium">
                  {episode.title ?? item.fileName}
                </span>
              </p>

              <p className="mt-1 text-xs opacity-40">
                {[
                  episode.airDate && airDate(episode.airDate),
                  duration(item.durationSec),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>

              {/* Clamped: two lines is enough to know which episode this is, and
                an even height is what lets a season be scanned down the page
                rather than read. */}
              {episode.overview && (
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed opacity-60">
                  {episode.overview}
                </p>
              )}
            </div>

            {/* The same ring the film shelf uses: the number is the score and the
              colour is the verdict, which a bare figure cannot say. */}
            <ScoreCircle movie={item} />
          </div>

          {/* The file, in one line: the marks say the formats, and what they
            cannot say — codec, bitrate, size — follows them. Everything else
            about the file lives on its own page. */}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3">
            <FormatBadges movie={item} />

            <p className="font-mono text-[11px] opacity-40">
              {[
                [item.videoCodec, item.bitDepth && `${item.bitDepth}-bit`]
                  .filter(Boolean)
                  .join(" "),
                item.videoBitrateKbps &&
                  `${item.videoBitrateKbps.toLocaleString("en-GB")} kbps`,
                size(item.sizeBytes),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      </Link>
    </li>
  );
}

/**
 * The seasons, one at a time.
 *
 * Stacking every season down the page made a four-season show a very long
 * scroll of near-identical rows, and nothing on screen said how complete any of
 * them was. A season is the unit you actually think in, so it gets a switcher,
 * a summary of its own, and a list that shows the gaps in place.
 */
function Seasons({ show }: { show: Show }) {
  const [selected, setSelected] = useState(show.seasons[0]?.number);
  const season =
    show.seasons.find((s) => s.number === selected) ?? show.seasons[0];
  if (!season) return null;

  const held = season.episodes.length;
  const bytes = season.episodes.reduce((n, e) => n + e.item.sizeBytes, 0);
  const bitrate = average(
    season.episodes.map((e) => e.item.videoBitrateKbps ?? 0),
  );
  const score = average(season.episodes.map((e) => e.item.scores.overall));

  // What the season is made of, when it is made of one thing. "2160p REMUX"
  // says more than a list of every value found, and a season that is a mix is
  // worth knowing about precisely because it is not uniform.
  const uniform = (values: (string | undefined)[]) => {
    const set = new Set(values.filter(Boolean));
    return set.size === 1 ? [...set][0] : `mixed (${set.size})`;
  };

  // Held and missing in one ordered run, so the season reads in its true shape
  // rather than as a list of what survived with a note about the rest.
  const rows = [
    ...season.episodes.map((episode) => ({
      number: episode.number,
      episode,
      gap: undefined,
    })),
    ...season.missing.map((gap) => ({
      number: gap.number,
      episode: undefined,
      gap,
    })),
  ].sort((a, b) => a.number - b.number);

  return (
    <section className="flex flex-col gap-4">
      {show.seasons.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {show.seasons.map((option) => {
            const active = option.number === season.number;
            return (
              <button
                key={option.number}
                type="button"
                onClick={() => setSelected(option.number)}
                aria-pressed={active}
                className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-transparent bg-foreground text-background"
                    : "border-line hover:bg-surface-strong"
                }`}
              >
                Season {option.number}
                <PillCount active={active}>{option.episodes.length}</PillCount>
                {option.missing.length > 0 && (
                  <span
                    aria-label="incomplete"
                    className="h-1.5 w-1.5 rounded-full bg-amber-500"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* What the season is like to watch, not how much of it there is: the
          switcher already flags an incomplete season, and the gaps show
          themselves in the list below. The same card a film gets, averaged. */}
      <section className="flex flex-col gap-6 rounded-card border border-line bg-surface p-6">
        <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-stretch">
          <div className="flex shrink-0 items-center justify-center">
            <ScoreRing
              score={score}
              ring={SCORE_RING(score)}
              caption="average"
            />
          </div>

          <div className="hidden w-px shrink-0 bg-line sm:block" />

          <div className="flex w-full flex-1 flex-col justify-center gap-3">
            <SubScore
              label="Video"
              value={average(season.episodes.map((e) => e.item.scores.video))}
            />
            <SubScore
              label="Audio"
              value={average(season.episodes.map((e) => e.item.scores.audio))}
            />
            <SubScore
              label="Release"
              value={average(season.episodes.map((e) => e.item.scores.release))}
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-3">
          <Fact
            label="Video"
            value={uniform(
              season.episodes.map((e) =>
                [e.item.resolution, e.item.videoCodec, e.item.releaseType]
                  .filter(Boolean)
                  .join(" · "),
              ),
            )}
          />
          <Fact
            label="Dynamic range"
            value={uniform(
              season.episodes.map((e) =>
                e.item.hdr === "Dolby Vision"
                  ? `Dolby Vision P${e.item.dvProfile ?? "?"}`
                  : e.item.hdr,
              ),
            )}
          />
          <Fact
            label="Audio"
            value={uniform(
              season.episodes.map((e) =>
                e.item.audio[0]
                  ? [
                      e.item.audio[0].label,
                      e.item.audio[0].channels &&
                        `${e.item.audio[0].channels}ch`,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "none",
              ),
            )}
          />
          <Fact
            label="Bitrate"
            value={
              bitrate
                ? `${bitrate.toLocaleString("en-GB")} kbps avg`
                : undefined
            }
          />
          <Fact
            label="Size"
            value={`${size(bytes)} · ${size(bytes / held)} each`}
          />
          {/* Files held, and the gaps only as a count — the list below shows
              each gap where it belongs. */}
          <Fact
            label="Episodes"
            value={`${held}${
              season.missing.length ? ` · ${season.missing.length} missing` : ""
            }`}
          />
        </dl>
      </section>

      <ul className="flex flex-col gap-5">
        {rows.map((row) =>
          row.episode ? (
            <Episode key={row.episode.item.path} episode={row.episode} />
          ) : (
            <Gap key={`gap-${row.number}`} missing={row.gap!} />
          ),
        )}
      </ul>
    </section>
  );
}

/** An episode the library does not have, in the place it would occupy. */
function Gap({ missing }: { missing: MissingEpisode }) {
  return (
    <li className="flex items-center gap-3 rounded-card border border-dashed border-amber-500/30 bg-amber-500/[0.04] px-4 py-3">
      <span className="shrink-0 font-mono text-xs opacity-30">
        E{String(missing.number).padStart(2, "0")}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm opacity-45">
        {missing.title ?? "Unknown episode"}
      </span>
      <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
        not in library
      </span>
    </li>
  );
}

export function ShowView({ show }: { show: Show }) {
  return (
    <>
      {/* The same hero a film gets: a show earns it more, if anything, since
          this page stands in for every episode below it. */}
      <div className="relative h-72 w-full overflow-hidden sm:h-96">
        {show.fanart ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artUrl(show.fanart)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
          </>
        ) : (
          <div className="absolute inset-0 bg-surface-strong" />
        )}

        {/* Decorative — the h1 below is the real title. */}
        {show.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artUrl(show.logo)}
            alt=""
            aria-hidden
            className="pointer-events-none absolute top-6 right-6 z-[5] max-h-20 w-auto max-w-[45vw] object-contain object-right drop-shadow-[0_2px_14px_rgba(0,0,0,0.6)] sm:top-8 sm:right-8 sm:max-h-24 sm:max-w-sm"
          />
        )}

        <BackButton />
      </div>

      <div className="relative z-10 mx-auto -mt-24 flex w-full max-w-5xl flex-col gap-8 px-6 sm:px-8">
        <header className="relative flex flex-col gap-5 sm:flex-row sm:items-end">
          {show.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={artUrl(show.poster)}
              alt=""
              className="h-52 w-36 shrink-0 rounded-card object-cover shadow-2xl ring-1 ring-line"
            />
          ) : (
            <div className="h-52 w-36 shrink-0 rounded-card bg-surface-strong shadow-2xl ring-1 ring-line" />
          )}

          <div className="flex flex-col gap-2 pb-1">
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {show.title}
            </h1>
            <p className="text-sm opacity-55">
              {show.tmdb?.year && <>{show.tmdb.year} · </>}
              {show.seasons.length}{" "}
              {show.seasons.length === 1 ? "season" : "seasons"} ·{" "}
              {show.episodeCount} episodes · {size(show.sizeBytes)} ·{" "}
              <span className={SCORE_TONE(show.score)}>{show.score}/100</span>{" "}
              <span className="opacity-60">average</span>
            </p>
            {show.tmdb?.overview && (
              <p
                className="max-w-prose pt-1 text-sm leading-relaxed opacity-65"
                title={show.tmdb.overview}
              >
                {trim(show.tmdb.overview)}
              </p>
            )}
          </div>

          {show.tmdb && (
            <div className="mt-2 flex items-center justify-end gap-2 sm:absolute sm:right-0 sm:bottom-1 sm:mt-0">
              <ArtworkEditor showKey={show.key} tmdbId={show.tmdb.id} />
            </div>
          )}
        </header>

        {/* A wrong series poisons every episode title and every missing-episode
            count below, so the way to correct it sits at the top rather than
            buried at the bottom of the page. */}
        {(!show.tmdb || show.tmdb.confidence !== "high") && (
          <section
            className={`rounded-card border p-5 ${
              show.tmdb
                ? "border-line bg-surface"
                : "border-amber-500/30 bg-amber-500/[0.06]"
            }`}
          >
            <p className="text-sm">
              {show.tmdb
                ? `Matched to “${show.tmdb.name}” by name, which was close but not exact. Confirm it and later scans will leave it alone.`
                : "No TMDb match, so there are no episode titles and no way to tell which episodes are missing. Search below to link it by hand."}
            </p>

            <MatchReview
              showKey={show.key}
              currentId={show.tmdb?.id}
              needsReview={Boolean(show.tmdb)}
              defaultQuery={show.title}
            />
          </section>
        )}

        <Seasons show={show} />
      </div>
    </>
  );
}
