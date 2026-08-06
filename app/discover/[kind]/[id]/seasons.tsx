"use client";

import { useEffect, useState, useTransition } from "react";

import { listDiscoverEpisodes } from "@/app/actions";
import type { DiscoverEpisode, DiscoverSeason } from "@/lib/discover";
import { Downloads } from "./downloads";
import { EpisodeList } from "./episode-list";
import { airDate, episodeCount, numbering } from "./facts";

/**
 * The seasons of a series nobody here owns, one at a time.
 *
 * The same switcher the show page uses, for the same reason: a season is the
 * unit you think in, and stacking twelve of them down the page is a very long
 * scroll of near-identical rows. It is also what keeps the requests
 * proportional — TMDb numbers each season its own call, and only the season
 * being looked at is ever asked for.
 *
 * The releases sit under the season rather than at the top of the page,
 * because a season is what television is sold and seeded as. A series-wide
 * search answers with the same packs anyway, only without saying which season
 * any of them is.
 *
 * Episodes are held once fetched. Flipping back to a season you have already
 * opened is not a new question.
 */
export function Seasons({
  tmdbId,
  title,
  seasons,
  jackettReady,
}: {
  tmdbId: number;
  /** The series' name, for the download log. */
  title: string;
  seasons: DiscoverSeason[];
  jackettReady: boolean;
}) {
  const [selected, setSelected] = useState(seasons[0]?.number);
  const [cache, setCache] = useState<Record<number, DiscoverEpisode[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const season = seasons.find((s) => s.number === selected);
  const episodes = selected === undefined ? undefined : cache[selected];

  useEffect(() => {
    if (selected === undefined || cache[selected]) return;

    startTransition(async () => {
      const found = await listDiscoverEpisodes(tmdbId, selected);
      if (found.ok) {
        setError(null);
        setCache((held) => ({ ...held, [selected]: found.episodes }));
      } else {
        setError(found.error);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId, selected]);

  if (!season) return null;

  /*
   * Whether this season's name is a name at all. TMDb gives every season one,
   * and for almost all of them it is "Season 3" again — but some shows really
   * do name theirs ("Book One: Water", "Part 2: The Aftermath"), and that is
   * worth a line of its own.
   */
  const named =
    season.name.trim().toLowerCase() !== `season ${season.number}`;

  return (
    <section className="mt-12 flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            Seasons
          </h2>
          <span className="shrink-0 text-[11px] opacity-40">
            {seasons.length} listed at TMDb
          </span>
        </div>
        <div aria-hidden className="rule-head" />
      </div>

      {seasons.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {seasons.map((option) => {
            const active = option.number === season.number;
            return (
              <button
                key={option.number}
                type="button"
                onClick={() => setSelected(option.number)}
                aria-pressed={active}
                className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-transparent bg-foreground text-background"
                    : "border-line hover:bg-surface-strong"
                }`}
              >
                Season {option.number}
              </button>
            );
          })}
        </div>
      )}

      {/* A season has no page of its own: it is this block, on the series it
          belongs to. Everything one could hold — its count, its releases, its
          episodes — is already here.

          Its name is only shown where it is a name: TMDb calls most seasons
          "Season 3", which the pill above already says, in the same words, an
          inch higher. What is worth a line is what the pill cannot say — how
          many episodes, and when they went out. */}
      <div className="min-w-0">
        {named && <p className="font-medium">{season.name}</p>}
        <p className="text-xs opacity-45">
          {[
            // Only where no pill is saying it: a single-season series has no
            // switcher, so the line is the only thing that can.
            named || seasons.length > 1
              ? undefined
              : `Season ${season.number}`,
            episodeCount(season.episodeCount),
            airDate(season.airDate),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {season.overview && (
        <p className="max-w-prose text-sm leading-relaxed opacity-60">
          {season.overview}
        </p>
      )}

      {/* What there is to fetch of this season. Keyed by season so the panel
          starts clean when the switcher moves rather than showing the last
          season's releases under this one's name while the search runs. */}
      <Downloads
        key={season.number}
        subject={{ kind: "season", tmdbId, season: season.number }}
        logName={`${title} ${numbering(season.number)}`}
        jackettReady={jackettReady}
      />

      {pending && !episodes && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-28 w-full rounded-card" />
          ))}
        </div>
      )}

      {error && !episodes && (
        <p className="py-6 text-center font-mono text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* The rule between the releases and the episodes, drawn here rather
          than by the `.ruled` pair in globals.css so its two sides can be told
          apart. They are not the same distance: above it is the foot of an open
          panel, which already carries its own padding, and below it is the top
          of a list of cards. Splitting the space evenly there leaves the rule
          reading as the panel's underline instead of as the parting between
          two things. */}
      {episodes && (
        <>
          <div
            aria-hidden
            className="-mt-3 h-px bg-gradient-to-r from-transparent via-line-strong to-transparent"
          />
          <div className="pt-2">
            <EpisodeList tmdbId={tmdbId} episodes={episodes} />
          </div>
        </>
      )}
    </section>
  );
}
