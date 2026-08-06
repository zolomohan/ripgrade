import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { discoverTitleName, getDiscoverTitle } from "@/lib/discover";
import { hasJackett } from "@/lib/jackett";
import { getMovies } from "@/lib/library";
import { movieId, showId } from "@/lib/routes";
import { getShows } from "@/lib/shows";
import type { WishKind } from "@/lib/wishlist";
import { DiscSection, DiscPending } from "./disc-section";
import { DiscoverView } from "./discover-view";
import { runtime } from "./facts";
import { Seasons } from "./seasons";

/**
 * A film or a series that is not on the drive.
 *
 * The search used to answer a tile like this with a dialog: every release the
 * indexers had, and nothing else. But what you want to know before fetching
 * fifty gigabytes is what the thing *is* — the artwork, the year, how long it
 * runs, what it is made of, and above all what the best disc of it looks like,
 * since that is what every predicted score here is a percentage of. A dialog
 * has no room for any of that, so this is a page, built like the pages for the
 * titles you own.
 */

export const dynamic = "force-dynamic";

const kindOf = (value: string): WishKind | undefined =>
  value === "movie" || value === "tv" ? value : undefined;

const idOf = (value: string) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
};

type Params = { params: Promise<{ kind: string; id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { kind, id } = await params;
  const tmdbId = idOf(id);
  const wish = kindOf(kind);
  if (!wish || !tmdbId) return { title: "Not found — RipGrade" };

  const name = await discoverTitleName(wish, tmdbId);
  return { title: name ? `${name} — RipGrade` : "RipGrade" };
}

export default async function DiscoverPage({ params }: Params) {
  const { kind, id } = await params;

  const wish = kindOf(kind);
  const tmdbId = idOf(id);
  if (!wish || !tmdbId) notFound();

  /*
   * Something the library already holds does not belong here: its own page has
   * the file, the measured scores and the upgrade search, and this one could
   * only ever show it worse. A scan matching a want is exactly how a title
   * crosses that line, so the check is made on the way in rather than trusted
   * from whatever linked here.
   */
  if (wish === "movie") {
    const held = getMovies().find((movie) => movie.tmdb?.id === tmdbId);
    if (held) redirect(`/film/${movieId(held.path)}`);
  } else {
    const held = getShows().find((show) => show.tmdb?.id === tmdbId);
    if (held) redirect(`/show/${showId(held.key)}`);
  }

  const title = await getDiscoverTitle(wish, tmdbId);
  if (!title) notFound();

  // A film says how long it is; a series says how much of it there is, and its
  // running time is one episode's rather than the whole thing's.
  const length =
    wish === "tv"
      ? [
          title.seasonCount
            ? `${title.seasonCount} ${title.seasonCount === 1 ? "season" : "seasons"}`
            : undefined,
          title.episodeCount ? `${title.episodeCount} episodes` : undefined,
          runtime(title.runtimeMinutes) &&
            `${runtime(title.runtimeMinutes)} episodes`,
        ]
      : [runtime(title.runtimeMinutes)];

  const facts = [
    title.year ? String(title.year) : undefined,
    ...length,
    title.genres.slice(0, 3).join(", ") || undefined,
    title.rating ? `${title.rating.toFixed(1)} on TMDb` : undefined,
    wish === "tv" ? title.status : undefined,
  ].filter(Boolean) as string[];

  return (
    <main className="flex flex-col pb-16">
      <DiscoverView
        subject={{ kind: wish, tmdbId }}
        heading={title.title}
        facts={facts}
        overview={title.overview}
        art={{
          posterPath: title.posterPath,
          backdropPath: title.backdropPath,
          logoPath: title.logoPath,
          posterKey: `tmdb-${wish}-${tmdbId}`,
        }}
        logName={title.title}
        wish={{
          kind: wish,
          tmdbId,
          title: title.title,
          year: title.year,
          posterPath: title.posterPath,
          overview: title.overview,
          wanted: title.wanted,
        }}
        jackettReady={hasJackett()}
        /*
         * Streamed rather than awaited with the rest: a film nobody has looked
         * at before has no disc stored, and finding one means scraping
         * Blu-ray.com — seconds, sometimes. The hero and the release search
         * have no reason to wait behind that, so the panel arrives when it
         * arrives. A series has no disc of its own at all: discs are sold a
         * season at a time, and there is no season being asked about here.
         */
        disc={
          wish === "movie" ? (
            <Suspense fallback={<DiscPending />}>
              <DiscSection
                tmdbId={tmdbId}
                title={title.title}
                year={title.year}
              />
            </Suspense>
          ) : null
        }
      >
        {wish === "tv" && title.seasons && title.seasons.length > 0 && (
          <Seasons
            tmdbId={tmdbId}
            title={title.title}
            seasons={title.seasons}
            jackettReady={hasJackett()}
          />
        )}
      </DiscoverView>
    </main>
  );
}
