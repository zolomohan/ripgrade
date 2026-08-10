"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, ViewTransition } from "react";

import { addWish } from "@/app/actions";
import { Art } from "@/app/art";
import { scoreTheme } from "@/app/score-circle";
import { pace } from "@/app/collections/collections-view";
import { stagger } from "@/app/stagger";
import { movieId, posterName } from "@/lib/routes";
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
 */
const GRID = "grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5";

const FRAME =
  "glow glow-over tilt relative aspect-[2/3] overflow-hidden rounded-card bg-surface-strong ring-1 ring-line";

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
}: {
  film: CollectionFilm;
  index: number;
  total: number;
}) {
  const owned = film.owned!;

  return (
    <Link
      href={`/film/${movieId(owned.path)}`}
      style={stagger(index)}
      className="row-enter group flex flex-col gap-2"
    >
      {/* The whole tile travels, exactly as it does from the shelf — the frame,
          the score on it, and the picture inside. */}
      <ViewTransition
        name={posterName(owned.path)}
        share={pace(index, total)}
        default="none"
      >
        <div className={FRAME}>
          <Art
            src={owned.poster}
            // The chosen artwork's own source before the record's default,
            // exactly as the library tile falls back.
            remote={owned.posterSrc ?? film.posterPath}
            version={owned.artAt}
            loading="lazy"
            className={POSTER}
          />
          <span
            className={`absolute top-2 right-2 rounded-full bg-background/85 px-1.5 py-0.5 font-score text-[11px] font-semibold tabular-nums backdrop-blur ${scoreTheme(owned.score).text}`}
            title={`${owned.score} of 100`}
          >
            {owned.score}
          </span>
        </div>
      </ViewTransition>

      <Caption
        title={film.title}
        meta={[film.year, owned.resolution].filter(Boolean).join(" · ")}
      />
    </Link>
  );
}

function Absent({
  film,
  index,
  wishlisted,
  onWish,
}: {
  film: CollectionFilm;
  index: number;
  wishlisted: boolean;
  onWish: () => void;
}) {
  return (
    <div style={stagger(index)} className="row-enter group flex flex-col gap-2">
      {/* The heart is a sibling of the link rather than a child of it: a button
          nested inside an anchor is invalid, and one click would fire both. */}
      <div className="relative">
        <Link
          href={`/discover/movie/${film.tmdbId}`}
          aria-label={film.title}
          className={`${FRAME} block`}
        >
          {/* Held back so the two halves of the page read apart at a glance, and
              brought most of the way up under the pointer. */}
          <Art
            src={undefined}
            remote={film.posterPath}
            // The name the discover page's own poster answers to, so the tile
            // travels into it rather than being swapped for it.
            transitionName={posterName(`tmdb-movie-${film.tmdbId}`)}
            loading="lazy"
            className={`${POSTER} opacity-40 transition-opacity group-hover:opacity-90`}
          />

          <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded-chip bg-background/85 py-1 text-center text-[10px] font-medium opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
            Find releases
          </span>
        </Link>

        <button
          type="button"
          onClick={() => {
            if (!wishlisted) onWish();
          }}
          disabled={wishlisted}
          aria-label={
            wishlisted
              ? `${film.title} is on the wishlist`
              : `Add ${film.title} to the wishlist`
          }
          title={wishlisted ? "On the wishlist" : "Add to wishlist"}
          className={`absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-background/85 text-xs backdrop-blur transition-opacity ${
            wishlisted
              ? "text-red-500 disabled:opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
        >
          {wishlisted ? "♥" : "♡"}
        </button>
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
}: {
  set: CollectionSet;
  wishlisted: number[];
}) {
  const [added, setAdded] = useState<number[]>([]);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const onList = new Set([...wishlisted, ...added]);
  const missing = set.missing ?? [];

  function wish(film: CollectionFilm) {
    // Marked locally as well as saved, so the heart settles immediately rather
    // than after the round trip.
    setAdded((ids) => [...ids, film.tmdbId]);
    startTransition(async () => {
      await addWish({
        id: film.tmdbId,
        title: film.title,
        year: film.year ? String(film.year) : undefined,
        posterPath: film.posterPath,
        overview: film.overview,
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-7">
        <Heading label="In the library" />
        <div className={GRID}>
          {set.owned.map((film, i) => (
            <Held
              key={film.tmdbId}
              film={film}
              index={i}
              total={set.owned.length}
            />
          ))}
        </div>
      </section>

      {/* Nothing to say when the set is complete: an empty section headed
          "Not in the library" is a paragraph explaining that there is no
          paragraph. */}
      {missing.length > 0 && (
        <>
          <section className="flex flex-col gap-7 pt-6">
            <Heading label="Not in the library" />
            <div className={GRID}>
              {missing.map((film, i) => (
                <Absent
                  key={film.tmdbId}
                  film={film}
                  index={i}
                  wishlisted={onList.has(film.tmdbId)}
                  onWish={() => wish(film)}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
