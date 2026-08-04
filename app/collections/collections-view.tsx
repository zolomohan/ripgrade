"use client";

import Link from "next/link";
import { Fragment, ViewTransition } from "react";

import type { CollectionFilm, CollectionSet } from "@/lib/collections";
import { Art } from "@/app/art";
import { stagger } from "@/app/stagger";
import {
  collectionMetaName,
  collectionTitleName,
  posterName,
} from "@/lib/routes";

/**
 * The sets, one line each.
 *
 * A grid of every film in every collection was a page you scrolled rather than
 * read: the answer it exists to give — which sets are short, and by how much —
 * was spread across screens of artwork. A row states that in one line and
 * carries just enough of the artwork to be recognised, with the set's own page
 * a click away for the films themselves.
 */

/** How many paces the ladder in globals.css defines before it repeats. */
const PACE_STEPS = 6;

/**
 * Which pace a poster travels at, by its place in the set.
 *
 * Forwards the first is quickest; backwards the order inverts, so the poster
 * that arrived first is the last to leave. A fan that unfolds fastest-first and
 * folds back fastest-first would read as the same motion twice — reversing it
 * is what makes the way out feel like the way in undone.
 */
export const pace = (index: number, total: number) => ({
  default: `morph-in-${index % PACE_STEPS}`,
  "nav-back": `morph-out-${(total - 1 - index) % PACE_STEPS}`,
});

function Fan({ films }: { films: CollectionFilm[] }) {
  return (
    // Overlapped and laid right to left, so each poster tucks behind the one
    // before it and the leftmost stays whole.
    <div className="flex shrink-0 flex-row-reverse items-center pl-4">
      {films
        .map((film, order) => ({ film, order }))
        .reverse()
        .map(({ film, order }) => {
          const tile = (
            <div className="-ml-4 h-14 w-[2.35rem] shrink-0 overflow-hidden rounded-chip bg-surface-strong ring-1 ring-line">
              <Art
                src={film.owned?.poster}
                remote={film.posterPath}
                size="w92"
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </div>
          );

          /*
           * Named with the film's own poster name, which is the name its tile
           * carries on the set's page and on the shelf and on its own page. One
           * name per film across the whole app means the fan does not need a
           * pairing of its own: each poster flies out from under the others to
           * the place it occupies in the grid, and back under them on the way
           * out. Only a held film has a path to be named by.
           */
          return film.owned ? (
            <ViewTransition
              key={film.tmdbId}
              name={posterName(film.owned.path)}
              share={pace(order, films.length)}
              default="none"
            >
              {tile}
            </ViewTransition>
          ) : (
            <Fragment key={film.tmdbId}>{tile}</Fragment>
          );
        })}
    </div>
  );
}

export function CollectionsView({ sets }: { sets: CollectionSet[] }) {
  if (sets.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface px-4 py-12 text-center">
        <p className="text-sm opacity-50">
          No collections yet. They come from TMDb once films are matched, and
          only films that belong to one appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {sets.map((set, i) => (
        <Fragment key={set.id}>
          {/* Fades out at both ends rather than ruling the full width: the rows
              are already separated by space, and this only has to mark where
              one ends without drawing a box around it. */}
          {i > 0 && (
            <div
              aria-hidden
              className="h-px bg-gradient-to-r from-transparent via-line-strong to-transparent"
            />
          )}

          <Link
            href={`/collections/${set.id}`}
            transitionTypes={["nav-forward"]}
            style={stagger(i)}
            className="glow row-enter -mx-3 flex items-center gap-4 rounded-control px-3 py-3 transition-colors hover:bg-surface"
          >
            <div className="min-w-0 flex-1">
              <ViewTransition
                name={collectionTitleName(set.id)}
                share="title"
                default="none"
              >
                {/* `w-fit` so the box hugs the words. Left to fill the row, it
                    is a 647px box holding 150px of text, and the heading it
                    pairs with is only as wide as its own line — two boxes of
                    different shape, which `contain` then scales by different
                    amounts, so the fading title ends up larger than the one
                    arriving. */}
                <p className="w-fit max-w-full truncate font-display leading-tight font-semibold tracking-tight">
                  {set.name}
                </p>
              </ViewTransition>
              <ViewTransition
                name={collectionMetaName(set.id)}
                share="title"
                default="none"
              >
                <p className="mt-1 w-fit max-w-full text-xs leading-tight opacity-45">
                  {set.owned.length} {set.owned.length === 1 ? "film" : "films"}
                </p>
              </ViewTransition>
            </div>

            <Fan films={set.owned} />
          </Link>
        </Fragment>
      ))}
    </div>
  );
}
