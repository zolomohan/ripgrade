import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getDiscoverEpisodePage } from "@/lib/discover";
import { hasJackett } from "@/lib/jackett";
import { showId } from "@/lib/routes";
import { getShows } from "@/lib/shows";
import { DiscoverView } from "../../discover-view";
import { airDate, numbering, runtime } from "../../facts";

/**
 * One episode of a series that is not on the drive.
 *
 * The same page again, at the smallest unit an indexer will answer for. Its
 * still stands in for the backdrop: a page about one episode should show that
 * episode, and every episode of a series sharing one image is the thing that
 * makes a season unreadable.
 */

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{
    kind: string;
    id: string;
    season: string;
    episode: string;
  }>;
};

const idOf = (value: string) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
};

const seasonOf = (value: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { season, episode } = await params;
  const number = seasonOf(season);
  const within = idOf(episode);
  return {
    title:
      number === undefined || !within
        ? "Not found — RipGrade"
        : `${numbering(number, within)} — RipGrade`,
  };
}

export default async function DiscoverEpisodePage({ params }: Params) {
  const { kind, id, season, episode } = await params;

  const tmdbId = idOf(id);
  const number = seasonOf(season);
  const within = idOf(episode);
  if (kind !== "tv" || !tmdbId || number === undefined || !within) notFound();

  const held = getShows().find((show) => show.tmdb?.id === tmdbId);
  if (held) redirect(`/show/${showId(held.key)}`);

  const page = await getDiscoverEpisodePage(tmdbId, number, within);
  if (!page) notFound();

  const { show, episode: found } = page;

  const facts = [
    numbering(number, within),
    airDate(found.airDate) ?? "not aired yet",
    runtime(found.runtimeMinutes),
  ].filter(Boolean) as string[];

  return (
    <main className="flex flex-col pb-16">
      <DiscoverView
        subject={{ kind: "episode", tmdbId, season: number, episode: within }}
        heading={found.title}
        // Back to the series, which is where its seasons live — a season is a
        // block on that page rather than a page of its own.
        context={{
          label: `${show.title} · Season ${number}`,
          href: `/discover/tv/${tmdbId}`,
        }}
        facts={facts}
        overview={found.overview}
        art={{
          posterPath: show.posterPath,
          // This episode's still where there is one, so the page is about the
          // episode rather than about the series it belongs to.
          backdropPath: found.stillPath ?? show.backdropPath,
          logoPath: show.logoPath,
        }}
        logName={`${show.title} ${numbering(number, within)}`}
        jackettReady={hasJackett()}
      />
    </main>
  );
}
