"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, ViewTransition } from "react";

import { addWish, removeWish } from "@/app/actions";
import { Art } from "@/app/art";
import { TILE_FRAME } from "@/app/poster-tile";
import { Heart } from "@/app/heart";
import { scoreTheme } from "@/app/score-circle";
import { OVER_ART, RemoveButton, WANTED_ART } from "@/app/tile-button";
import { pace } from "@/app/collections/collections-view";
import { stagger } from "@/app/stagger";
import { filmKey, movieId, posterName } from "@/lib/routes";
import type { CollectionFilm, CollectionSet } from "@/lib/collections";

/**
 * One set, split by the only question worth asking of it: which of these do you
 * have, and which do you not.
 *
 * Both halves are the library's own tile — same grid, same proportions, same
 * score in the same corner — because a film is the same object here as it is on
 * the shelf. What differs is only which page the poster opens: a film you hold
 * opens its own, a film you do not opens its page on TMDb's side of the app,
 * where what it is and every release of it both live.
 *
 * A poster is a way in to a film, never a dialog. Clicking one used to throw
 * the release search over the page, which answered a question nobody had asked
 * yet and left no way to the film itself; the search still runs, on arrival, on
 * the page it belongs to.
 *
 * A set of your own is drawn by this too, and the only thing it adds is a way
 * out: `onRemove` puts a cross on each tile, because a list you wrote is a list
 * you can be wrong about. TMDb's sets pass nothing and get no cross — there is
 * no such thing as removing a film from a franchise.
 */
const GRID = "grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5";

const POSTER = "h-full w-full object-cover";

function Caption({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium" title={title}>
        {title}
      </p>
      <p className="truncate text-[11px] opacity-45">{meta || "—"}</p>
    </div>
  );
}

function Held({
  film,
  index,
  total,
  onRemove,
}: {
  film: CollectionFilm;
  index: number;
  total: number;
  onRemove?: () => void;
}) {
  const owned = film.owned!;

  const href = `/film/${movieId(owned.path)}`;

  return (
    <div style={stagger(index)} className="row-enter group flex flex-col gap-2">
      {/* The whole tile travels, exactly as it does from the shelf — the
          frame, the score on it, and the picture inside. */}
      <ViewTransition
        name={posterName(owned.path)}
        share={pace(index, total)}
        default="none"
      >
        {/* The frame is the thing that lifts, so the frame is what everything
            drawn on the poster has to be inside — see TILE_FRAME. That puts the
            link inside it rather than around it: an anchor cannot hold a
            button, so the one that has to give way is the anchor. */}
        <div className={TILE_FRAME}>
          <Link href={href} aria-label={film.title} className="block h-full">
            <Art
              src={owned.poster}
              // The chosen artwork's own source before the record's default,
              // exactly as the library tile falls back.
              remote={owned.posterSrc ?? film.posterPath}
              version={owned.artAt}
              loading="lazy"
              className={POSTER}
            />
          </Link>

          <span
            className={`pointer-events-none absolute top-2 right-2 rounded-full bg-background/85 px-1.5 py-0.5 font-score text-[11px] font-semibold tabular-nums backdrop-blur ${scoreTheme(owned.score).text}`}
            title={`${owned.score} of 100`}
          >
            {owned.score}
          </span>

          {onRemove && (
            <RemoveButton
              label={`Remove ${film.title} from this collection`}
              title="Remove from collection"
              onClick={onRemove}
            />
          )}
        </div>
      </ViewTransition>

      {/* Its own link now that the frame's is inside the frame. The words under
          a poster have always opened it, and losing that to a restructure would
          be paying for the lift with a click. */}
      <Link href={href}>
        <Caption
          title={film.title}
          meta={[film.year, owned.resolution].filter(Boolean).join(" · ")}
        />
      </Link>
    </div>
  );
}

function Absent({
  film,
  index,
  wishlisted,
  onWish,
  onRemove,
}: {
  film: CollectionFilm;
  index: number;
  wishlisted: boolean;
  /** Toggles: the heart is a switch, not a one-way door. */
  onWish: () => void;
  onRemove?: () => void;
}) {
  /*
   * Held back so the two halves of the page read apart at a glance, and brought
   * most of the way up under the pointer.
   */
  const poster = (
    <Art
      src={undefined}
      remote={film.posterPath}
      // The name the discover page's own poster answers to, so the tile
      // travels into it rather than being swapped for it. Only where there
      // is a page for it to travel to.
      transitionName={
        film.tmdbId === undefined
          ? undefined
          : posterName(`tmdb-movie-${film.tmdbId}`)
      }
      loading="lazy"
      className={`${POSTER} opacity-40 transition-opacity group-hover:opacity-90`}
    />
  );

  return (
    <div style={stagger(index)} className="row-enter group flex flex-col gap-2">
      {/* Everything drawn on the poster is inside the frame, because the frame
          is the thing that lifts under the pointer — a heart pinned outside it
          hangs in the air while the picture behind it moves. The link goes
          inside for the same reason, since an anchor cannot hold a button. */}
      <div className={TILE_FRAME}>
        {film.tmdbId === undefined ? (
          /*
           * A film only a set of your own could hold: one that was on the drive
           * when you added it, that TMDb never matched, and that a rescan has
           * since found gone. There is no page to open — the app knows nothing
           * about it beyond the name you added it under — so the tile is a
           * tile, and the cross beside it is the only thing left to do with it.
           */
          poster
        ) : (
          <Link
            href={`/discover/movie/${film.tmdbId}`}
            aria-label={film.title}
            className="block h-full"
          >
            {poster}

            <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded-chip bg-background/85 py-1 text-center text-[10px] font-medium opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
              Find releases
            </span>
          </Link>
        )}

        {film.tmdbId !== undefined && (
          <button
            type="button"
            onClick={onWish}
            aria-pressed={wishlisted}
            aria-label={
              wishlisted
                ? `Remove ${film.title} from the wishlist`
                : `Add ${film.title} to the wishlist`
            }
            title={wishlisted ? "On the wishlist" : "Add to wishlist"}
            /* No plate. A bigger mark on a shadow reads on artwork without a
               black disc having to be drawn in the corner of every poster to
               hold it — see OVER_ART. The box is larger than the disc was
               even so: with nothing painted on it, a generous target costs
               nothing. */
            className={`absolute top-1 right-1 z-10 grid h-9 w-9 place-items-center transition-opacity ${
              wishlisted
                ? WANTED_ART
                : `${OVER_ART} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`
            }`}
          >
            <Heart filled={wishlisted} />
          </button>
        )}

        {onRemove && (
          <RemoveButton
            label={`Remove ${film.title} from this collection`}
            title="Remove from collection"
            onClick={onRemove}
          />
        )}
      </div>

      <Caption title={film.title} meta={film.year ? String(film.year) : ""} />
    </div>
  );
}

/** The library's own section heading, so a shelf is titled the same everywhere. */
function Heading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {label}
      </h2>
      {/* A floor for the shelf to stand on, and the space that comes with it. */}
      <div aria-hidden className="rule-head" />
    </div>
  );
}

export function CollectionView({
  set,
  wishlisted,
  onRemove,
}: {
  set: CollectionSet;
  wishlisted: number[];
  /** Given only by a set of your own, which is the only kind you can edit. */
  onRemove?: (key: string) => void;
}) {
  /**
   * Hearts pressed since the page was drawn, as answers rather than as a list
   * of additions.
   *
   * It was a list of what had been added, which could only ever grow — so the
   * heart was a door that opened once. A press is a new answer to "do you want
   * this", and the answer can be no: kept here by id, it overrides what the
   * server said until the refresh brings the server round to the same view.
   */
  const [pressed, setPressed] = useState<Record<number, boolean>>({});
  const [, startTransition] = useTransition();
  const router = useRouter();

  const onList = new Set(wishlisted);
  const wanted = (film: CollectionFilm) =>
    film.tmdbId !== undefined &&
    (pressed[film.tmdbId] ?? onList.has(film.tmdbId));

  const missing = set.missing ?? [];

  function wish(film: CollectionFilm) {
    if (film.tmdbId === undefined) return;
    const id = film.tmdbId;
    const next = !wanted(film);

    // Marked locally as well as saved, so the heart settles immediately rather
    // than after the round trip — which is the whole of what the pop is for.
    setPressed((answers) => ({ ...answers, [id]: next }));
    startTransition(async () => {
      if (next) {
        await addWish({
          id,
          title: film.title,
          year: film.year ? String(film.year) : undefined,
          posterPath: film.posterPath,
          overview: film.overview,
        });
      } else {
        await removeWish(id, "movie");
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-12">
      {/* A TMDb set always holds something — that is why it is listed at all —
          but one of yours can be empty, or can be entirely films you have not
          got yet, and a shelf headed "In the library" with nothing on it is a
          heading explaining that there is nothing to head. */}
      {set.owned.length > 0 && (
        <section className="flex flex-col gap-7">
          <Heading label="In the library" />
          <div className={GRID}>
            {set.owned.map((film, i) => (
              <Held
                key={filmKey(film)}
                film={film}
                index={i}
                total={set.owned.length}
                onRemove={onRemove && (() => onRemove(filmKey(film)))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Nothing to say when the set is complete: an empty section headed
          "Not in the library" is a paragraph explaining that there is no
          paragraph. */}
      {missing.length > 0 && (
        <section
          className={`flex flex-col gap-7 ${set.owned.length > 0 ? "pt-6" : ""}`}
        >
          <Heading label="Not in the library" />
          <div className={GRID}>
            {missing.map((film, i) => (
              <Absent
                key={filmKey(film)}
                film={film}
                index={i}
                wishlisted={wanted(film)}
                onWish={() => wish(film)}
                onRemove={onRemove && (() => onRemove(filmKey(film)))}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
