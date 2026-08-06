import Link from "next/link";

import { stagger } from "@/app/stagger";
import type { DiscoverEpisode } from "@/lib/discover";
import { imageUrl } from "@/lib/image-url";
import { airDate, runtime } from "./facts";

/**
 * A season's episodes, each one a page you can fetch it from.
 *
 * The same card the show page draws for an episode on the drive, with the half
 * that describes a file taken out: no score ring, no format marks, no bitrate —
 * none of it exists until something has been downloaded and probed. What is
 * left is what tells one episode from another, which is the picture, the
 * number and the synopsis.
 */
export function EpisodeList({
  tmdbId,
  episodes,
}: {
  tmdbId: number;
  episodes: DiscoverEpisode[];
}) {
  if (episodes.length === 0) {
    return (
      <p className="py-8 text-center text-sm opacity-45">
        TMDb lists no episodes for this season yet.
      </p>
    );
  }

  return (
    /* No `ruled`: the rule above this list is drawn by whoever places it, so
       that the space either side of it can be set independently. */
    <ul className="flex flex-col">
      {episodes.map((episode, index) => (
        <li key={episode.number} style={stagger(index)} className="row-enter">
          {/* The whole card is the link: everything on it is about one
              episode, so anywhere on it is the same destination. */}
          <Link
            href={`/discover/tv/${tmdbId}/${episode.season}/${episode.number}`}
            className="glow -mx-5 flex flex-col gap-5 rounded-card px-5 py-5 transition-colors hover:bg-surface sm:flex-row"
          >
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
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-mono text-xs opacity-40">
                  E{String(episode.number).padStart(2, "0")}
                </span>
                <span className="min-w-0 truncate font-medium">
                  {episode.title}
                </span>
              </p>

              <p className="text-xs opacity-40">
                {[airDate(episode.airDate), runtime(episode.runtimeMinutes)]
                  .filter(Boolean)
                  .join(" · ") || "not aired yet"}
              </p>

              {/* Clamped: two lines is enough to know which episode this is,
                  and an even height is what lets a season be scanned down the
                  page rather than read. */}
              {episode.overview && (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed opacity-60">
                  {episode.overview}
                </p>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
