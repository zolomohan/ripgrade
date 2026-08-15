import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { movieId, posterName, showId } from "@/lib/routes";
import { getEpisodeContext, type ShowEpisode } from "@/lib/shows";
import {
  groupIssues,
  languageName,
  openIssues,
  type Status,
  type SubtitleTrack,
} from "@/lib/derive";
import { getAudioPreference } from "@/lib/audio-prefs";
import { getSubtitlePreference } from "@/lib/subtitle-prefs";
import { audioBackupBytes } from "@/lib/audio-strip";
import {
  backupBytes,
  elArchiveBytes,
  filePresent,
  keepsEnhancementLayer,
} from "@/lib/convert";
import { getDisc } from "@/lib/disc";
import { entryFromSpec, qualityLabel } from "@/lib/disc-entry";
import { hasJackett } from "@/lib/jackett";
import { getMovie, type LibraryItem } from "@/lib/library";
import { canRevealInFinder } from "@/lib/system";
import { Art } from "@/app/art";
import { HERO_BOX, HERO_ART, HERO_VEIL } from "@/app/hero-art";
import { DiscHeading } from "@/app/disc-heading";
import { FormatBadges } from "@/app/format-badges";
import { UpgradeButton } from "@/app/release-search";
import { NoDisc } from "@/app/no-disc";
import { Panel } from "@/app/panel";
import { ScoreRing, SubScore } from "@/app/score-card";
import { AddToCollection } from "./add-to-collection";
import { ArtworkEditor } from "./artwork-editor";
import { TrackTables } from "./tracks";
import { BackButton } from "./back-button";
import { DiscReview } from "./disc-review";
import { DolbyVision } from "./dolby-vision";
import { ExtendedCut } from "./extended-cut";
import { RevealInFinder } from "./reveal-in-finder";
import { MatchReview } from "./match-review";
import { ScoreBreakdown } from "./score-breakdown";

const SEVERITY_TONE: Record<string, string> = {
  critical: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  info: "opacity-60",
};

// Tailwind needs literal class names, so each status carries its own palette.
const STATUS_THEME: Record<Status, { ring: string }> = {
  "Best Available": { ring: "stroke-emerald-500" },
  Reference: { ring: "stroke-emerald-500" },
  Excellent: { ring: "stroke-emerald-500" },
  Good: { ring: "stroke-amber-500" },
  "Upgrade Recommended": { ring: "stroke-amber-500" },
  "Must Upgrade": { ring: "stroke-red-500" },
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
    [
      "Subtitles",
      movie.subtitleLanguages.map(languageName).join(", ") || "none",
    ],
    ...(movie.imdbId ? ([["IMDb", movie.imdbId]] as [string, string][]) : []),
    ["Path", movie.path],
  ];

  return (
    <div className="py-1">
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

const airDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/**
 * One neighbour in the season. The empty side of a run keeps its space rather
 * than letting the other link slide across — the first episode's "next" should
 * stay where every other episode's next was.
 */
function EpisodeLink({
  episode,
  direction,
}: {
  episode?: ShowEpisode;
  direction: "prev" | "next";
}) {
  if (!episode) return <span />;

  const forward = direction === "next";
  return (
    <Link
      href={`/episode/${movieId(episode.item.path)}`}
      className={`group flex min-w-0 items-center gap-2 rounded-control border border-line px-3 py-2 transition-colors hover:bg-surface-strong ${
        forward ? "col-start-2 flex-row-reverse text-right" : ""
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={`h-3.5 w-3.5 shrink-0 opacity-40 ${forward ? "" : "rotate-180"}`}
      >
        <path d="m9 6 6 6-6 6" />
      </svg>
      <span className="min-w-0">
        <span className="block text-[10px] tracking-[0.1em] uppercase opacity-40">
          {forward ? "Next" : "Previous"} · E
          {String(episode.number).padStart(2, "0")}
        </span>
        <span className="block truncate text-sm">
          {episode.title ?? episode.item.fileName}
        </span>
      </span>
    </Link>
  );
}

/**
 * One file's page — a film's or an episode's, which differ only in what they
 * borrow from a series. Shared by the /film and /episode routes; a file that
 * arrived under the wrong word is sent to the right one, so an old link keeps
 * working and the address always says what the page is.
 */
export async function DetailPage({
  id,
  expected,
}: {
  id: string;
  expected: "movie" | "episode";
}) {
  const movie = getMovie(id);
  if (!movie) notFound();

  if (movie.kind !== expected) {
    redirect(`/${movie.kind === "episode" ? "episode" : "film"}/${id}`);
  }

  const theme = STATUS_THEME[movie.status];
  const { breakdown } = movie;
  // What still stands against this copy — never the raw list. A film accepted
  // as-is, or one whose length you have already accounted for, has answered
  // here already, and this is the page it answered on.
  const open = openIssues(movie);
  // Full specs live in the disc table; the derived payload only carries the gaps.
  const disc = movie.tmdb ? getDisc(movie.tmdb.id) : undefined;
  const jackettReady = hasJackett();
  // The track the audio summary names — the same one the spec grid calls the
  // file's audio, so the shut panel and the open one cannot disagree.
  const bestTrack =
    movie.audio.find((track) => track.atmos || track.dtsx) ??
    movie.audio.find((track) => track.lossless) ??
    movie.audio[0];
  // A file scanned before the per-track detail was recorded knows only which
  // languages it has. That much is still worth showing, so it stands in as a
  // row per language and fills itself in at the next scan.
  const subtitles: SubtitleTrack[] =
    movie.subtitles ??
    movie.subtitleLanguages.map((language) => ({
      format: "unknown",
      language,
      forced: false,
      sdh: false,
      default: false,
    }));

  // An episode is not identified on its own — everything TMDb knows about it
  // comes through its series, so the page looks the file up in its show and
  // borrows the show's artwork and match for the parts a film gets from its
  // own record.
  const tv =
    movie.kind === "episode" ? getEpisodeContext(movie.path) : undefined;
  // The still is of this episode; the show's backdrop is of the series. For a
  // page about one episode the still is the truer image, and it also stops
  // every episode of a show looking identical.
  // An episode's still is served from TMDb already, so it has no local file;
  // everything else prefers the drive and falls back to where it came from.
  const backdrop = tv?.episode.stillPath
    ? undefined
    : (movie.fanart ?? tv?.show.fanart);
  const backdropRemote =
    tv?.episode.stillPath ?? movie.art.fanart ?? tv?.show.art.fanart;
  const poster = movie.poster ?? tv?.show.poster;
  const logo = movie.logo ?? tv?.show.logo;
  // Each image above came from either the film's own folder or, for an episode
  // falling back, the series' — and the version has to be the one belonging to
  // whichever folder actually holds the file.
  const artAt = (own?: string) => (own ? movie.artAt : tv?.show.artAt);
  // The poster the shelf was showing is the one that should arrive here. An
  // episode borrowing the series' poster is showing the same object the shows
  // grid and the series page show, so it answers to that name instead of its
  // own — which is also the only name anything else on screen knows it by.
  const posterKey = tv && !movie.poster ? tv.show.key : movie.path;

  return (
    <main className="flex flex-col pb-16">
      {/* Hero */}
      <div className={HERO_BOX}>
        {backdrop || backdropRemote ? (
          <>
            <Art
              src={backdrop}
              remote={backdropRemote}
              version={artAt(movie.fanart)}
              size="original"
              className={HERO_ART}
            />
            <div className={HERO_VEIL} />
          </>
        ) : (
          <div className="absolute inset-0 bg-surface-strong" />
        )}

        {/* A title treatment is drawn to sit on artwork, so it goes on the
            backdrop — in the corner, where the image is at full strength rather
            than faded into the page. Decorative: the real title is the h1
            below, and repeating it here would only make a screen reader say it
            twice. */}
        {(logo || movie.art.logo || tv?.show.art.logo) && (
          <div className="enter-drop pointer-events-none absolute top-6 right-6 z-[5] flex justify-end sm:top-8 sm:right-8">
            <Art
              src={logo}
              remote={movie.art.logo ?? tv?.show.art.logo}
              version={artAt(movie.logo)}
              size="original"
              className="max-h-20 w-auto max-w-[45vw] object-contain object-right drop-shadow-[0_2px_14px_rgba(0,0,0,0.6)] sm:max-h-28 sm:max-w-sm"
            />
          </div>
        )}

        <BackButton />
      </div>

      {/* relative + z-10: the hero above is positioned, so without its own
          stacking position this content would paint underneath it and the
          poster overlapping the backdrop would be clipped. */}
      <div className="relative z-10 mx-auto -mt-28 w-full max-w-6xl px-6 sm:px-8">
        {/* Title block */}
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end">
          <Art
            src={poster}
            remote={movie.art.poster ?? tv?.show.art.poster}
            version={artAt(movie.poster)}
            transitionName={posterName(posterKey)}
            size="w780"
            className="h-60 w-40 shrink-0 rounded-card object-cover shadow-2xl ring-1 ring-line"
          />

          <div className="enter-rise flex flex-col gap-2 pb-1">
            {/* An episode is a part of something, so the series is named above
                it and links back — the h1 is the episode, which is what this
                page is actually about. */}
            {tv && (
              <Link
                href={`/show/${showId(tv.show.key)}`}
                className="text-sm opacity-60 transition-opacity hover:opacity-100"
              >
                {tv.show.title}
              </Link>
            )}
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {tv ? (tv.episode.title ?? movie.fileName) : movie.title}
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm opacity-60">
              {/* Dynamic range moved out: the logos directly below say it
                  better. Edition lives in Technical details. */}
              {tv ? (
                <span>
                  S{String(tv.season.number).padStart(2, "0")}E
                  {String(tv.episode.number).padStart(2, "0")}
                  {tv.episode.numberEnd &&
                    `–${String(tv.episode.numberEnd).padStart(2, "0")}`}
                </span>
              ) : (
                movie.year && <span>{movie.year}</span>
              )}
              <span>· {movie.resolution}</span>
              <span>· {movie.releaseType}</span>
              <span>· {bytes(movie.sizeBytes)}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <FormatBadges movie={movie} />
            </div>
          </div>

          {/* Pinned to the bottom of the title block rather than given a row of
              its own: level with the hero it belongs to, and the score card
              stays where it was. Stacked below on a narrow screen, where there
              is no room beside the poster to pin anything to. */}
          <div className="mt-2 flex items-center justify-end gap-2 sm:absolute sm:right-0 sm:bottom-1 sm:mt-0">
            {canRevealInFinder && <RevealInFinder moviePath={movie.path} />}
            {/* An episode has no artwork of its own — the poster and backdrop
                above are the show's, so this edits the show's. */}
            {tv?.show.tmdb ? (
              <ArtworkEditor showKey={tv.show.key} tmdbId={tv.show.tmdb.id} />
            ) : (
              movie.tmdb && (
                <ArtworkEditor moviePath={movie.path} tmdbId={movie.tmdb.id} />
              )
            )}
            {/* Films only. A set of your own is a set of films, exactly as
                TMDb's are — an episode belongs to a season, which is a set
                somebody has already drawn up. */}
            {movie.kind === "movie" && (
              <AddToCollection film={{ from: "library", path: movie.path }} />
            )}
            {/* Last, so the primary action ends the row rather than leading it.

                Only where there is something to gain. A copy that already
                matches the best disc released has nothing above it to find, so
                offering to go looking is offering a wasted search. `priority`
                is the app's own answer to "does this file want attention", so
                the button appears exactly where the rest of the app already
                says it should — which keeps the two from drifting apart if the
                bands are ever retuned. */}
            {movie.kind === "movie" && movie.priority !== "None" && (
              <UpgradeButton
                subject={{ kind: "movie", path: movie.path }}
                title={movie.title}
                subtitle={movie.year ? String(movie.year) : undefined}
                posterPath={movie.art.poster}
                configured={jackettReady}
              />
            )}
            {/* An episode's search asks for this one episode by its numbers —
                the season pack lives on the show page, but replacing the file
                this page is about is this page's business. Results rank
                against this copy's own score. */}
            {tv && movie.priority !== "None" && (
              <UpgradeButton
                subject={{
                  kind: "episode",
                  showKey: tv.show.key,
                  season: tv.season.number,
                  episode: tv.episode.number,
                }}
                title={tv.show.tmdb?.name ?? tv.show.title}
                subtitle={`S${String(tv.season.number).padStart(2, "0")}E${String(
                  tv.episode.number,
                ).padStart(2, "0")}${
                  tv.episode.title ? ` · ${tv.episode.title}` : ""
                }`}
                posterPath={movie.art.poster ?? tv.show.art.poster}
                configured={jackettReady}
              />
            )}
          </div>
        </div>

        {/* Scores */}
        <section className="mt-10 flex flex-col items-center gap-8 py-2 sm:flex-row sm:items-stretch">
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
          <div
            aria-hidden
            className="hidden w-px shrink-0 bg-gradient-to-b from-transparent via-line-strong to-transparent sm:block"
          />

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
          </div>
        </section>

        {/*
         * What this copy is, and what is wrong with it — one list.
         *
         * They were two: a summary here and an Issues section below it. But
         * both answer the same question in the same sentences, and reading the
         * good news in one place and the bad in another, a fold apart, made a
         * page you had to assemble. The flaws come first because they are what
         * changes what you do next, tinted by severity rather than labelled —
         * the same trick the score ring plays, with the words kept for anyone
         * who cannot see the colour.
         */}
        {/* Not ruled apart, unlike the lists on the queue: these are single
            lines of prose about one file, already parted by their own dashes and
            tints, and a hairline between each would rule this paragraph into a
            table. The class was on it for a while doing nothing, which is the
            only reason it ever looked right. */}
        <ul className="mt-10 mb-10 flex flex-col gap-2 text-sm opacity-80">
          {groupIssues(open).flatMap((group) =>
            group.messages
              // The rubric often gives its reason in the issue's own words;
              // said once is enough.
              .filter((message) => !movie.reasons.includes(message))
              .map((message) => (
                <li
                  key={`${group.code}-${message}`}
                  className={`flex gap-2 ${SEVERITY_TONE[group.severity]}`}
                >
                  <span className="opacity-30">—</span>
                  <span>
                    <span className="sr-only">{group.severity}: </span>
                    {message}
                    <code className="ml-2 font-mono text-xs opacity-40">
                      {group.code}
                    </code>
                  </span>
                </li>
              )),
          )}

          {movie.reasons.map((reason, i) => (
            <li key={i} className="flex gap-2">
              <span className="opacity-30">—</span>
              {reason}
            </li>
          ))}
        </ul>

        {/* Directly beneath the list, because it is about one line of it: asked
            only while that line is actually raised, so it never appears over an
            empty list with nothing to explain it.

            Answering is what removes the line, which is why an answer already
            given keeps the question on screen — one that vanished with the
            issue it settled would leave the copy quietly marked and no way
            back to unmark it. */}
        {(open.some((issue) => issue.code === "runtime-longer") ||
          movie.extendedCut !== undefined) && (
          <ExtendedCut
            moviePath={movie.path}
            answer={movie.extendedCut}
            // Rounded exactly as the check rounds them, so the card and the
            // issue line above it cannot disagree by a minute.
            fileMinutes={
              movie.durationSec ? Math.round(movie.durationSec / 60) : undefined
            }
            listedMinutes={movie.tmdb?.runtimeMinutes}
          />
        )}

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
            elArchiveBytes={elArchiveBytes(movie.path)}
            keepingEl={keepsEnhancementLayer()}
            present={filePresent(movie.path)}
          />
        )}

        {/* TMDb identity */}
        {movie.tmdb && (
          <Panel
            title="Identified as"
            summary={[movie.tmdb.title, movie.tmdb.year]
              .filter(Boolean)
              .join(" · ")}
            // A guess is worth seeing without being asked for: it is the one
            // fact on this page that everything else is derived from.
            open={movie.tmdb.confidence !== "high"}
          >
            <div>
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
          </Panel>
        )}

        {tv && (
          <Panel
            title="Episode"
            summary={`${tv.episode.title ?? "Untitled"} · S${String(
              tv.season.number,
            ).padStart(2, "0")}E${String(tv.episode.number).padStart(2, "0")}`}
          >
            <div>
              {tv.show.tmdb ? (
                <>
                  <p className="font-medium">
                    {tv.episode.title ?? "Untitled episode"}
                    <span className="ml-1.5 font-normal opacity-40">
                      S{String(tv.season.number).padStart(2, "0")}E
                      {String(tv.episode.number).padStart(2, "0")}
                    </span>
                  </p>

                  {tv.episode.overview && (
                    <p className="mt-2 text-sm opacity-70">
                      {tv.episode.overview}
                    </p>
                  )}

                  <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-x-6 gap-y-2 text-sm">
                    <div className="contents">
                      <dt className="opacity-50">Series</dt>
                      <dd>
                        <Link
                          href={`/show/${showId(tv.show.key)}`}
                          className="underline underline-offset-4 decoration-transparent transition-colors hover:decoration-current"
                        >
                          {tv.show.tmdb.name}
                        </Link>
                        <span className="opacity-50">
                          {" "}
                          · season {tv.season.number} of{" "}
                          {tv.show.seasons.length} held
                        </span>
                      </dd>
                    </div>
                    {tv.episode.airDate && (
                      <div className="contents">
                        <dt className="opacity-50">First aired</dt>
                        <dd>{airDate(tv.episode.airDate)}</dd>
                      </div>
                    )}
                    <div className="contents">
                      <dt className="opacity-50">TMDb</dt>
                      <dd>
                        <a
                          href={`https://www.themoviedb.org/tv/${tv.show.tmdb.id}/season/${tv.season.number}/episode/${tv.episode.number}`}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-4 opacity-70 hover:opacity-100"
                        >
                          {tv.show.tmdb.id}
                        </a>
                      </dd>
                    </div>
                  </dl>

                  {/* The match belongs to the series, so correcting it belongs
                      on the show's page — doing it here would fix one file and
                      leave its neighbours wrong. */}
                  {tv.show.tmdb.confidence !== "high" && (
                    <p className="mt-4 text-xs opacity-50">
                      This series was matched by name and not confirmed.{" "}
                      <Link
                        href={`/show/${showId(tv.show.key)}`}
                        className="underline underline-offset-4"
                      >
                        Review it on the show page
                      </Link>{" "}
                      — the match covers every episode at once.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm">
                  No TMDb match for this series, so there is no episode title or
                  air date.{" "}
                  <Link
                    href={`/show/${showId(tv.show.key)}`}
                    className="underline underline-offset-4"
                  >
                    Link it on the show page
                  </Link>{" "}
                  and every episode gets its facts at once.
                </p>
              )}

              {/* A season is read in order, so its neighbours are one click
                  away rather than two through the show page. */}
              <div className="mt-6 grid grid-cols-2 gap-3">
                <EpisodeLink episode={tv.prev} direction="prev" />
                <EpisodeLink episode={tv.next} direction="next" />
              </div>
            </div>
          </Panel>
        )}

        {/* Open: this one is a thing to do, not a thing to read. */}
        {!movie.tmdb && !tv && (
          <Panel title="Not identified" summary="No TMDb match" open>
            <div>
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
          </Panel>
        )}

        {/* An episode is scored against its season's set, so the page says
            which set that is — the edition is chosen on the show page, where it
            applies to every episode at once. */}
        {tv && movie.disc?.releaseTitle && (
          <Panel
            title="Best quality available"
            summary={[
              movie.disc.releaseTitle,
              movie.disc.format &&
                qualityLabel({
                  format: movie.disc.format,
                  source: movie.disc.source,
                }),
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <div>
              {/* The title is the release, and where the release has a page the
                  words themselves link to it. A separate "View on Blu-ray.com"
                  beside them was a second thing to read that pointed at the
                  first. A set entered by hand has no page, so it is just the
                  name. */}
              <div className="flex flex-wrap items-baseline gap-2">
                {movie.disc.url ? (
                  <a
                    href={movie.disc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
                  >
                    {movie.disc.releaseTitle}
                    <span aria-hidden className="ml-1 opacity-40">
                      ↗
                    </span>
                  </a>
                ) : (
                  <p className="font-medium">{movie.disc.releaseTitle}</p>
                )}
                {movie.disc.format && (
                  <span className="rounded-chip px-1.5 text-[11px] leading-[18px] font-medium ring-1 ring-line-strong ring-inset">
                    {qualityLabel({
                      format: movie.disc.format,
                      source: movie.disc.source,
                    })}
                  </span>
                )}
              </div>

              {movie.disc.gaps.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs tracking-wide uppercase opacity-45">
                    Where this episode falls short
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

              <p className="mt-6 text-xs opacity-50">
                Every episode of season {tv.season.number} is compared against
                this set.{" "}
                <Link
                  href={`/show/${showId(tv.show.key)}`}
                  className="underline underline-offset-4"
                >
                  Change the edition on the show page
                </Link>
                .
              </p>
            </div>
          </Panel>
        )}

        {/* Best quality available */}
        {movie.tmdb && (
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
                // The explanation and the way out of it on one line: a
                // paragraph with a button dropped under its last word reads as
                // two unrelated things.
                <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
                  <NoDisc
                    scope="film"
                    lookedUp={Boolean(disc)}
                    error={disc?.error}
                  />
                  <DiscReview
                    tmdbId={movie.tmdb.id}
                    title={movie.tmdb.title}
                    year={movie.tmdb.year}
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
                        ["Aspect ratio", disc.best.aspectRatio ?? "unknown"],
                        ["Audio", disc.best.audio.join(" · ") || "unknown"],
                        [
                          "Editions",
                          disc.entered
                            ? "Entered by hand"
                            : `${disc.releaseCount} on Blu-ray.com${
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
                    <div className="mt-6">
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

              {disc?.best && !disc.error && (
                <DiscReview
                  tmdbId={movie.tmdb.id}
                  title={movie.tmdb.title}
                  year={movie.tmdb.year}
                  currentUrl={disc.best.url}
                  manual={disc.manual}
                  entered={disc.entered ? entryFromSpec(disc.best) : undefined}
                />
              )}
            </div>
          </Panel>
        )}

        {/* Technical */}
        <Panel
          title="Technical details"
          summary={[
            movie.width && movie.height
              ? `${movie.width}×${movie.height}`
              : movie.resolution,
            movie.videoCodec,
            bytes(movie.sizeBytes),
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <Spec movie={movie} />
        </Panel>

        {/* Every removable track, and what removing the unwanted ones would
            free. Audio and subtitles are one console because they are one
            remux — see `TrackTables`, which explains why that is forced rather
            than a layout preference. */}
        <TrackTables
          moviePath={movie.path}
          fileName={movie.fileName}
          summary={[
            `${movie.audio.length} audio`,
            subtitles.length > 0 ? `${subtitles.length} subtitle` : null,
            bestTrack?.label,
            bestTrack?.channels ? `${bestTrack.channels}ch` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          tracks={movie.audio}
          subtitles={subtitles}
          sizeBytes={movie.sizeBytes}
          backupBytes={audioBackupBytes(movie.path)}
          present={filePresent(movie.path)}
          // What you said you keep, and what this particular film was made in
          // — together they decide which rows the table marks, and which ones
          // it stops you removing without saying so first.
          preference={getAudioPreference()}
          subtitlePreference={getSubtitlePreference()}
          // A film knows its own; an episode borrows the series', because there
          // is no per-episode record for TMDb to have put it on. Without the
          // second half every anime on the shelf reads as having no original
          // language at all — which is the one shelf this setting is for.
          originalLanguage={
            movie.tmdb?.originalLanguage ?? tv?.show.tmdb?.originalLanguage
          }
        />

        {/* The subtitle table used to stand here on its own, reading and
            offering nothing. It is inside the console above now, because a
            listing you cannot act on and a listing you can are the same table
            with a column added — and because the removal it feeds is the same
            remux the audio one starts. */}

        {/* Last, because it explains what the top of the page already showed. */}
        <Panel
          title="Why this score"
          // "vs disc", in the words the ring under the poster already uses.
          summary={
            breakdown.relative
              ? `${movie.scores.overall} vs the best quality available`
              : `${movie.scores.overall} on the rubric alone`
          }
        >
          <ScoreBreakdown scores={movie.scores} breakdown={breakdown} />
        </Panel>
      </div>
    </main>
  );
}
