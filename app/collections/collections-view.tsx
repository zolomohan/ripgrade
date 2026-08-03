"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";

import { addWish } from "@/app/actions";
import type { CollectionFilm, CollectionSet } from "@/lib/collections";
import { Art } from "@/app/art";
import { stagger } from "@/app/stagger";
import { movieId } from "@/lib/routes";

/**
 * A collection is only interesting for the gap between what it contains and
 * what you hold, so the missing half is the point of this screen — but it
 * costs a request per set the first time, so it is asked for rather than
 * assumed.
 */

/**
 * Your artwork wins where you have it.
 *
 * A film on the drive has a poster sitting beside it — often one you picked
 * over what TMDb serves by default — and this grid mixes owned and missing
 * films in one row, so pulling everything from TMDb would quietly replace your
 * choice with theirs. TMDb only fills in for the films you do not have.
 */
function Poster({
  film,
  action,
}: {
  film: CollectionFilm;
  action?: React.ReactNode;
}) {
  const local = film.owned?.poster;

  return (
    <div className="relative aspect-[2/3] overflow-hidden rounded-card bg-surface-strong ring-1 ring-line">
      {(local || film.posterPath) && (
        <Art
          src={local}
          remote={film.posterPath}
          loading="lazy"
          // The dimming belongs to the artwork, not to the tile: on the tile it
          // also faded the heart sitting on top of it.
          className={`h-full w-full object-cover ${film.owned ? "" : "opacity-45"}`}
        />
      )}
      {action}
    </div>
  );
}

function Film({
  film,
  onWish,
  wishlisted,
  busy,
  index,
}: {
  film: CollectionFilm;
  onWish?: () => void;
  wishlisted?: boolean;
  busy?: boolean;
  index: number;
}) {
  const heart = film.owned ? undefined : (
    // On the poster rather than under it: it belongs to the film, and a row of
    // buttons beneath a row of posters reads as a toolbar rather than as an
    // action on each one.
    <button
      type="button"
      onClick={onWish}
      disabled={busy || wishlisted}
      aria-label={
        wishlisted
          ? `${film.title} is on your wishlist`
          : `Add ${film.title} to wishlist`
      }
      aria-pressed={wishlisted}
      title={wishlisted ? "On your wishlist" : "Add to wishlist"}
      className={`absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-background/85 backdrop-blur transition-colors disabled:cursor-default ${
        wishlisted
          ? "text-red-600 dark:text-red-400"
          : "opacity-70 hover:text-red-600 hover:opacity-100 dark:hover:text-red-400"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={wishlisted ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <path d="M12 20.3 3.9 12.2a4.6 4.6 0 0 1 0-6.5 4.6 4.6 0 0 1 6.5 0l1.6 1.6 1.6-1.6a4.6 4.6 0 0 1 6.5 0 4.6 4.6 0 0 1 0 6.5z" />
      </svg>
    </button>
  );

  const body = (
    <>
      <Poster film={film} action={heart} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={film.title}>
          {film.title}
        </p>
        <p className="truncate text-[11px] opacity-45">
          {film.owned
            ? [film.year, film.owned.resolution].filter(Boolean).join(" · ")
            : (film.year ?? "—")}
        </p>
      </div>
    </>
  );

  if (film.owned) {
    return (
      <Link
        href={`/movie/${movieId(film.owned.path)}`}
        style={stagger(index)}
        className="row-enter flex flex-col gap-2"
      >
        {body}
      </Link>
    );
  }

  return (
    <div style={stagger(index)} className="row-enter flex flex-col gap-2">
      {body}
    </div>
  );
}

export function CollectionsView({
  sets,
  withMissing,
  canFetch,
  wishlisted,
}: {
  sets: CollectionSet[];
  withMissing: boolean;
  canFetch: boolean;
  wishlisted: number[];
}) {
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState<number[]>([]);
  const router = useRouter();

  const onList = new Set([...wishlisted, ...added]);

  function wish(film: CollectionFilm) {
    // Marked locally as well as saved, so the button settles immediately
    // rather than after the round trip.
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

  const totalMissing = sets.reduce((n, s) => n + (s.missing?.length ?? 0), 0);

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
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm opacity-60">
          {sets.length} {sets.length === 1 ? "collection" : "collections"}
          {withMissing &&
            ` · ${totalMissing} ${totalMissing === 1 ? "film" : "films"} missing`}
        </p>

        {canFetch ? (
          // Still a link, so the expensive mode stays something you can land on
          // and reload — but dressed as a switch, and labelled once rather than
          // relabelling itself, since the knob is what carries the state.
          <Link
            href={withMissing ? "/collections" : "/collections?missing=1"}
            scroll={false}
            role="switch"
            aria-checked={withMissing}
            className="group flex items-center gap-2.5 text-sm"
          >
            <span className="opacity-60 transition-opacity group-hover:opacity-100">
              Show missing films
            </span>
            <span
              className={`relative h-5 w-9 shrink-0 rounded-full motion-safe:transition-colors motion-safe:duration-200 ${
                withMissing
                  ? "bg-foreground"
                  : "bg-surface-strong ring-1 ring-line ring-inset"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full motion-safe:transition-transform motion-safe:duration-200 ${
                  withMissing
                    ? "translate-x-[18px] bg-background"
                    : "translate-x-0.5 bg-foreground/60"
                }`}
              />
            </span>
          </Link>
        ) : (
          <span className="text-xs opacity-45">
            Set TMDB_READ_TOKEN to see what each set is missing.
          </span>
        )}
      </div>

      {sets.map((set, i) => (
        <Fragment key={set.id}>
          {/* Fades out at both ends rather than ruling the full width: the
              sets are already separated by space, and this only has to mark
              where one ends without drawing a box around it. */}
          {i > 0 && (
            <div
              aria-hidden
              className="h-px bg-gradient-to-r from-transparent via-line-strong to-transparent"
            />
          )}

          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-lg font-semibold tracking-tight">
                {set.name}
              </h2>
              <span className="shrink-0 text-xs opacity-45">
                {set.missing
                  ? `${set.owned.length} of ${set.owned.length + set.missing.length}`
                  : `${set.owned.length} held`}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              {set.owned.map((film, i) => (
                <Film key={film.tmdbId} film={film} index={i} />
              ))}
              {/* The missing carry on counting from the held, so one wave
                  crosses the whole set rather than two starting together. */}
              {set.missing?.map((film, i) => (
                <Film
                  key={film.tmdbId}
                  film={film}
                  index={set.owned.length + i}
                  busy={pending}
                  wishlisted={onList.has(film.tmdbId)}
                  onWish={() => wish(film)}
                />
              ))}
            </div>
          </section>
        </Fragment>
      ))}
    </div>
  );
}
