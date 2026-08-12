"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

import { ArtworkEditor } from "@/app/film/[id]/artwork-editor";
import { BackButton } from "@/app/film/[id]/back-button";
import { MatchReview } from "@/app/film/[id]/match-review";
import { BUTTON } from "@/app/controls";
import { FormatBadges } from "@/app/format-badges";
import { DiscHeading } from "@/app/disc-heading";
import { useClosing, useLingering } from "@/app/modal";
import { NoDisc } from "@/app/no-disc";
import { Panel } from "@/app/panel";
import { Art } from "@/app/art";
import { HERO_BOX_SHORT, HERO_ART, HERO_VEIL } from "@/app/hero-art";
import { DiscReview } from "@/app/film/[id]/disc-review";
import { ReleaseSearchModal } from "@/app/release-search";
import { stagger } from "@/app/stagger";
import { ScoreCircle, ScoreDial } from "@/app/score-circle";
import { ScoreRing, SubScore } from "@/app/score-card";
import { openIssues } from "@/lib/derive";
import { entryFromSpec, qualityLabel } from "@/lib/disc-entry";
import { imageUrl } from "@/lib/image-url";
import { movieId, posterName } from "@/lib/routes";
import type {
  MissingEpisode,
  Show,
  ShowEpisode,
  ShowSeason,
} from "@/lib/shows";

/**
 * A show, season by season.
 *
 * Episodes expand in place rather than each having a page: a season is read as
 * a run, and the question asked of one episode — why is this the odd one out —
 * only means anything with its neighbours still on screen.
 */

/** The collections list's rule: fades at both ends, marks where one thing stops. */
const RULE =
  "h-px shrink-0 bg-gradient-to-r from-transparent via-line-strong to-transparent";

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

/** What a season scores: its episodes' verdicts, averaged. */
const seasonScore = (season: ShowSeason) =>
  average(season.episodes.map((e) => e.item.scores.overall));

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
function Episode({ episode, index }: { episode: ShowEpisode; index: number }) {
  const item = episode.item;
  const issues = openIssues(item);

  return (
    <li style={stagger(index)} className="row-enter">
      {/* The whole card is the link — everything on it is about one file, so
          anywhere on it is the same destination. */}
      <Link
        href={`/episode/${movieId(item.path)}`}
        className="glow group -mx-5 flex flex-col gap-5 rounded-row px-5 py-5 transition-colors hover:bg-surface sm:flex-row"
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
function Seasons({
  show,
  jackettReady,
}: {
  show: Show;
  jackettReady: boolean;
}) {
  const [selected, setSelected] = useState(show.seasons[0]?.number);
  const season =
    show.seasons.find((s) => s.number === selected) ?? show.seasons[0];
  if (!season) return null;

  const held = season.episodes.length;
  const bytes = season.episodes.reduce((n, e) => n + e.item.sizeBytes, 0);
  const bitrate = average(
    season.episodes.map((e) => e.item.videoBitrateKbps ?? 0),
  );
  const score = seasonScore(season);
  // Every episode of a season is compared against the same set, so the disc's
  // own score and its parts are one fact about the season, not one per file.
  const relative = season.episodes.some((e) => e.item.breakdown.relative);
  const absolute = average(
    season.episodes.map((e) => e.item.breakdown.absolute),
  );
  const discScore = season.episodes.find((e) => e.item.breakdown.discScore)
    ?.item.breakdown.discScore;
  const discParts = season.episodes.find((e) => e.item.disc?.discParts)?.item
    .disc?.discParts;

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
    <section className="flex flex-col pt-6">
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
      {/* Not keyed: the card stays mounted across a change of season so its
          ring, figure and bars travel from the season you were on to the one
          you picked. Redrawing from zero would say the page had reloaded. */}
      <section className="flex flex-col gap-6 pt-12 pb-8">
        <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-stretch">
          {/* Against the set the season was released as where there is one, on
              the rubric where there is not — the same two rings a film gets,
              averaged over the season. */}
          <div className="flex shrink-0 items-center justify-center gap-5">
            <ScoreRing
              score={score}
              ring={SCORE_RING(score)}
              caption={relative ? "vs disc" : "average"}
            />
            {relative && (
              <ScoreRing
                score={absolute}
                ring="stroke-foreground/35"
                caption="absolute"
                ceiling={discScore}
              />
            )}
          </div>

          <div
            aria-hidden
            className="hidden w-px shrink-0 bg-gradient-to-b from-transparent via-line-strong to-transparent sm:block"
          />

          <div className="flex w-full flex-1 flex-col justify-center gap-3">
            <SubScore
              label="Video"
              value={average(season.episodes.map((e) => e.item.scores.video))}
              ceiling={discParts?.video}
              escalates
            />
            <SubScore
              label="Audio"
              value={average(season.episodes.map((e) => e.item.scores.audio))}
              ceiling={discParts?.audio}
              escalates
            />
            <SubScore
              label="Release"
              value={average(season.episodes.map((e) => e.item.scores.release))}
              ceiling={discParts?.release}
            />
          </div>
        </div>
      </section>

      <ShowIdentity show={show} />

      {/* Everything past the verdict is folded, exactly as it is on a film's
          page: what the season is scored at stays open, and the evidence for it
          is asked for. The episodes below are the exception — they are the list
          this page exists to show. */}
      <Panel
        title="Season details"
        summary={[
          `${held} ${held === 1 ? "episode" : "episodes"}`,
          uniform(season.episodes.map((e) => e.item.resolution)),
          size(bytes),
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
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
      </Panel>

      <SeasonDisc show={show} season={season} />

      <Panel
        title="Episodes"
        summary={`${held}${
          season.missing.length
            ? ` held · ${season.missing.length} missing`
            : ""
        }`}
        open
      >
        <ul className="flex flex-col">
          {rows.map((row, i) =>
            row.episode ? (
              <Fragment key={row.episode.item.path}>
                {i > 0 && <li aria-hidden className={`${RULE} my-1`} />}
                <Episode episode={row.episode} index={i} />
              </Fragment>
            ) : (
              <Fragment key={`gap-${row.number}`}>
                {i > 0 && <li aria-hidden className={`${RULE} my-1`} />}
                <Gap
                  missing={row.gap!}
                  index={i}
                  show={show}
                  season={season.number}
                  jackettReady={jackettReady}
                />
              </Fragment>
            ),
          )}
        </ul>
      </Panel>
    </section>
  );
}

/**
 * Going looking for better releases, for whichever season you name.
 *
 * A search belongs to a season — television is released that way — but the
 * question "what could be better here" is asked of the show. So the button is
 * the show's and the season is chosen in the menu, where each one carries the
 * score it would be replacing: a season already matching the best disc released
 * has nothing above it to find, and is shown saying so rather than hidden.
 */
function SeasonUpgrade({
  show,
  jackettReady,
}: {
  show: Show;
  jackettReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<ShowSeason | null>(null);
  const shown = useLingering(chosen);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const seasons = show.seasons.filter((season) => season.episodes.length > 0);
  if (seasons.length === 0) return null;

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // h-8 to sit level with the icon buttons beside it, exactly as a film's
        // own upgrade button does — the same pill with equal sides.
        className={`${BUTTON.primary} h-8 font-medium`}
      >
        Upgrade
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`h-3 w-3 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="row-enter absolute top-full right-0 z-30 mt-2 w-64 overflow-hidden glass-panel rounded-card border border-line py-1 shadow-2xl">
          {seasons.map((season) => {
            const score = seasonScore(season);
            const best = score >= 100;

            return (
              <button
                key={season.number}
                type="button"
                disabled={best || !jackettReady}
                onClick={() => {
                  setChosen(season);
                  setOpen(false);
                }}
                title={
                  best
                    ? "Already matches the best release available"
                    : jackettReady
                      ? undefined
                      : "Connect Jackett on the Settings page to search"
                }
                className="glow flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-strong disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <span className="min-w-0 flex-1 truncate">
                  Season {season.number}
                  {best && (
                    <span className="ml-2 text-[11px] opacity-60">
                      nothing better
                    </span>
                  )}
                </span>
                <ScoreDial score={score} size={26} />
              </button>
            );
          })}
        </div>
      )}

      {shown && (
        <ReleaseSearchModal
          open={chosen !== null}
          subject={{
            kind: "season",
            showKey: show.key,
            season: shown.number,
          }}
          title={show.tmdb?.name ?? show.title}
          posterPath={show.art.poster}
          subtitle={`Season ${shown.number}`}
          configured={jackettReady}
          onClose={() => setChosen(null)}
        />
      )}
    </div>
  );
}

/**
 * What the show was matched to.
 *
 * Show-level, so it does not change as you move between seasons — it sits among
 * the season's panels because that is where the folded facts are, not because
 * it belongs to a season.
 */
function ShowIdentity({ show }: { show: Show }) {
  return (
    <Panel
      title={show.tmdb ? "Identified as" : "Not identified"}
      summary={
        show.tmdb
          ? [show.tmdb.name, show.tmdb.year].filter(Boolean).join(" · ")
          : "No TMDb match"
      }
      open={!show.tmdb || show.tmdb.confidence !== "high"}
    >
      <div>
        {show.tmdb ? (
          <>
            <p className="font-medium">{show.tmdb.name}</p>

            {show.tmdb.overview && (
              <p className="mt-2 text-sm opacity-70">{show.tmdb.overview}</p>
            )}

            <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-x-6 gap-y-2 text-sm">
              <div className="contents">
                <dt className="opacity-50">Seasons held</dt>
                <dd>
                  {show.seasons.length} ·{" "}
                  {show.seasons.reduce(
                    (n, season) => n + season.episodes.length,
                    0,
                  )}{" "}
                  episodes
                </dd>
              </div>
              <div className="contents">
                <dt className="opacity-50">TMDb</dt>
                <dd>
                  <a
                    href={`https://www.themoviedb.org/tv/${show.tmdb.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4 opacity-70 hover:opacity-100"
                  >
                    {show.tmdb.id}
                  </a>
                </dd>
              </div>
            </dl>

            {show.tmdb.confidence !== "high" && (
              <p className="mt-4 text-xs opacity-50">
                Matched by name, which was close but not exact. Confirm it and
                later scans will leave it alone.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm">
            No TMDb match, so there are no episode titles and no way to tell
            which episodes are missing. Search below to link it by hand.
          </p>
        )}

        <MatchReview
          showKey={show.key}
          currentId={show.tmdb?.id}
          needsReview={Boolean(show.tmdb) && show.tmdb?.confidence !== "high"}
          defaultQuery={show.title}
        />
      </div>
    </Panel>
  );
}

/**
 * How this season falls short of the set it was released as.
 *
 * Each episode is already compared against that set — the same comparison a
 * film gets — so this is only a matter of collecting what they said, with the
 * count of episodes each shortfall applies to. A gap on every episode is a gap
 * in the season; a gap on two of nine is worth saying so.
 */
function discGaps(season: ShowSeason): { text: string; count: number }[] {
  const counts = new Map<string, number>();

  for (const episode of season.episodes) {
    for (const gap of episode.item.disc?.gaps ?? []) {
      counts.set(gap, (counts.get(gap) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count);
}

/** The disc set this season was released as, and how your copy compares. */
function SeasonDisc({ show, season }: { show: Show; season: ShowSeason }) {
  const disc = season.disc;
  const gaps = discGaps(season);

  return (
    <Panel
      title="Best quality available"
      summary={
        disc?.best
          ? [disc.best.title, qualityLabel(disc.best)]
              .filter(Boolean)
              .join(" · ")
          : "None found"
      }
    >
      <div>
        {!disc || disc.error || !disc.best ? (
          <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <NoDisc
              scope="season"
              lookedUp={Boolean(disc)}
              error={disc?.error}
            />
            <DiscReview
              showKey={show.key}
              season={season.number}
              title={show.tmdb?.name ?? show.title}
              year={season.year}
              currentUrl={disc?.best?.url}
              manual={disc?.manual}
              inline
            />
          </div>
        ) : (
          <>
            <DiscHeading best={disc.best} entered={disc.entered} />

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
                  ["Audio", disc.best.audio.join(" · ") || "unknown"],
                  [
                    "Editions",
                    disc.entered
                      ? "Entered by hand"
                      : `${disc.releaseCount} for this season${
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

            {gaps.length > 0 && (
              <div className="mt-6">
                <p className="text-xs tracking-wide uppercase opacity-45">
                  Where your copy falls short
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {gaps.map((gap) => (
                    <li key={gap.text} className="flex gap-2">
                      <span className="opacity-30">—</span>
                      <span>
                        {gap.text}
                        {gap.count < season.episodes.length && (
                          <span className="opacity-45">
                            {" "}
                            ({gap.count} of {season.episodes.length} episodes)
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* Only where there is a release on screen to correct: with none, the
            same button is already beside the sentence explaining why. */}
        {disc?.best && !disc.error && (
          <DiscReview
            showKey={show.key}
            season={season.number}
            title={show.tmdb?.name ?? show.title}
            year={season.year}
            currentUrl={disc.best.url}
            manual={disc.manual}
            entered={disc.entered ? entryFromSpec(disc.best) : undefined}
          />
        )}
      </div>
    </Panel>
  );
}

/**
 * An episode the library does not have, in the place it would occupy.
 *
 * The one thing to do about a gap is fill it, so the row carries the search
 * itself rather than sending you to the season's upgrade menu — that searches
 * for the whole season, and a single missing episode is a smaller ask.
 */
function Gap({
  missing,
  index,
  show,
  season,
  jackettReady,
}: {
  missing: MissingEpisode;
  index: number;
  show: Show;
  season: number;
  jackettReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const mounted = useClosing(open);

  const code = `S${String(season).padStart(2, "0")}E${String(
    missing.number,
  ).padStart(2, "0")}`;

  return (
    <li
      style={stagger(index)}
      className="row-enter -mx-5 flex items-center gap-3 rounded-card px-5 py-4"
    >
      <span className="shrink-0 font-mono text-xs opacity-30">
        E{String(missing.number).padStart(2, "0")}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm opacity-45">
        {missing.title ?? "Unknown episode"}
      </span>
      <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
        not in library
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={BUTTON.small}
      >
        Find
      </button>

      {mounted && (
        <ReleaseSearchModal
          open={open}
          subject={{
            kind: "episode",
            showKey: show.key,
            season,
            episode: missing.number,
          }}
          title={show.tmdb?.name ?? show.title}
          posterPath={show.art.poster}
          subtitle={`${code}${missing.title ? ` · ${missing.title}` : ""}`}
          configured={jackettReady}
          onClose={() => setOpen(false)}
        />
      )}
    </li>
  );
}

export function ShowView({
  show,
  jackettReady,
}: {
  show: Show;
  jackettReady: boolean;
}) {
  return (
    <>
      {/* The same hero a film gets: a show earns it more, if anything, since
          this page stands in for every episode below it. */}
      <div className={HERO_BOX_SHORT}>
        {show.fanart || show.art.fanart ? (
          <>
            <Art
              src={show.fanart}
              remote={show.art.fanart}
              version={show.artAt}
              size="original"
              className={HERO_ART}
            />
            <div className={HERO_VEIL} />
          </>
        ) : (
          <div className="absolute inset-0 bg-surface-strong" />
        )}

        {/* Decorative — the h1 below is the real title. */}
        {(show.logo || show.art.logo) && (
          <Art
            src={show.logo}
            remote={show.art.logo}
            version={show.artAt}
            size="original"
            className="enter-drop pointer-events-none absolute top-6 right-6 z-[5] max-h-20 w-auto max-w-[45vw] object-contain object-right drop-shadow-[0_2px_14px_rgba(0,0,0,0.6)] sm:top-8 sm:right-8 sm:max-h-24 sm:max-w-sm"
          />
        )}

        <BackButton />
      </div>

      <div className="relative z-10 mx-auto -mt-24 flex w-full max-w-6xl flex-col px-6 sm:px-8">
        <header className="relative mb-10 flex flex-col gap-5 sm:flex-row sm:items-end">
          {show.poster || show.art.poster ? (
            <Art
              src={show.poster}
              remote={show.art.poster}
              version={show.artAt}
              transitionName={posterName(show.key)}
              size="w780"
              className="h-52 w-36 shrink-0 rounded-card object-cover shadow-2xl ring-1 ring-line"
            />
          ) : (
            <div className="h-52 w-36 shrink-0 rounded-card bg-surface-strong shadow-2xl ring-1 ring-line" />
          )}

          <div className="enter-rise flex flex-col gap-2 pb-1">
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {show.title}
            </h1>
            <p className="text-sm opacity-55">
              {show.tmdb?.year && <>{show.tmdb.year} · </>}
              {show.seasons.length}{" "}
              {show.seasons.length === 1 ? "season" : "seasons"} ·{" "}
              {show.episodeCount} episodes · {size(show.sizeBytes)} ·{" "}
              <span className={`font-score ${SCORE_TONE(show.score)}`}>
                {show.score}/100
              </span>{" "}
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

          <div className="mt-2 flex items-center justify-end gap-2 sm:absolute sm:right-0 sm:bottom-1 sm:mt-0">
            {show.tmdb && (
              <ArtworkEditor showKey={show.key} tmdbId={show.tmdb.id} />
            )}
            <SeasonUpgrade show={show} jackettReady={jackettReady} />
          </div>
        </header>

        {/* A wrong series poisons every episode title and every missing-episode
            count below, so the way to correct it sits at the top rather than
            buried at the bottom of the page. */}
        <Seasons show={show} jackettReady={jackettReady} />
      </div>
    </>
  );
}
