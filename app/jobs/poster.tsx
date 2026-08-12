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
export function Poster({ film }: { film?: TaskFilm }) {
  if (film && (film.poster || film.posterRemote)) {
    return (
      <Art
        src={film.poster}
        remote={film.posterRemote}
        version={film.artAt}
        // Named so it travels into the film's page, as the queue's rows do.
        transitionName={posterName(film.path)}
        size="w92"
        loading="lazy"
        className="h-24 w-16 shrink-0 rounded-control object-cover ring-1 ring-line"
      />
    );
  }

  return <div className="h-24 w-16 shrink-0 rounded-control bg-surface-strong" />;
}
