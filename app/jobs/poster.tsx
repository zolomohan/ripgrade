"use client";

import { Art } from "@/app/art";
import type { TaskFilm } from "@/lib/queue-tasks";
import { posterName } from "@/lib/routes";

/**
 * The film's poster, drawn the way every other list in the app draws one — the
 * same component, the same fallback block, so a job about a film is recognised
 * by the same picture the film is recognised by everywhere else.
 *
 * The block stands in for a job with no film as well as for a film with no
 * poster: a sweep is about the whole library and has no picture to show, and a
 * ragged left edge down the list would say something about those rows that is
 * not true of them. The cleanup list leans on that second case hardest — an
 * original whose film has since been renamed or removed is a row with a file
 * and no film at all, and it still has to line up with the rows above it.
 *
 * Its own module rather than the view that first needed it: the job log, the
 * task lists and the cleanup list all draw this, and the view holding it also
 * imports the cleanup list, so leaving it there would have made a cycle of a
 * component none of them owns.
 */
export function Poster({
  film,
  transition = true,
  box = "h-24 w-16",
}: {
  film?: TaskFilm;
  /**
   * Whether this poster is the one a click is aimed at.
   *
   * A transition name has to be unique among everything mounted, and these
   * lists share a page: the log sits under the pending lists, and a film with
   * work queued is exactly the film the log is likely to be talking about. Two
   * posters of one film claiming one name abort the transition outright, so a
   * list that is not the one worth animating from says so here.
   */
  transition?: boolean;
  /**
   * The box it is drawn in, where a row's is the wrong size for it.
   *
   * The width and height together, so the two cannot drift out of a poster's
   * proportions — and only those: the rounding, the ring and the fallback are
   * what make this the same picture everywhere, and a caller free to restyle
   * them is a caller that has drawn its own poster. A dialog header wanting a
   * thumbnail is the case this exists for.
   */
  box?: string;
}) {
  if (film && (film.poster || film.posterRemote)) {
    return (
      <Art
        src={film.poster}
        remote={film.posterRemote}
        version={film.artAt}
        // Named so it travels into the film's page, as the queue's rows do.
        transitionName={transition ? posterName(film.path) : undefined}
        size="w92"
        loading="lazy"
        className={`${box} shrink-0 rounded-control object-cover ring-1 ring-line`}
      />
    );
  }

  return (
    <div className={`${box} shrink-0 rounded-control bg-surface-strong`} />
  );
}
