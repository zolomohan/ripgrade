"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { addWish, removeWish } from "@/app/actions";
import { Art } from "@/app/art";
import { BackButton } from "@/app/film/[id]/back-button";
import { HERO_BUTTON } from "@/app/film/[id]/hero-button";
import { posterName } from "@/lib/routes";
import type { WishKind } from "@/lib/wishlist";
import { Downloads, type DiscoverSubject } from "./downloads";

/**
 * The page for something you do not have.
 *
 * It is built as a film's page is built — hero, then the evidence — with the
 * two differences that follow from there being no file: the line under the
 * title says what the thing is rather than what a copy of it contains, since
 * nothing has been probed, and the release list is open rather than shut,
 * because it is why you are here.
 *
 * One view for four subjects: a film, a series, a season and an episode. They
 * differ only in what is searched for and what is listed underneath, and a
 * series' season is not a lesser thing than the series — you download it the
 * same way, so you should be able to look at it the same way.
 *
 * The search runs on mount — being on this page is the request — and the list
 * is where a release is taken from. The hero briefly carried a Download button
 * aimed at the best-scoring one; it was a second answer to a question the list
 * below was already answering, and it could only ever be right about a choice
 * you had not looked at yet. The hero holds the want list instead, which is the
 * one thing the list of releases cannot say.
 */

/** What the heart writes to the want list; absent where there is nothing to want. */
export type Wish = {
  kind: WishKind;
  tmdbId: number;
  title: string;
  year?: number;
  posterPath?: string;
  overview?: string;
  wanted: boolean;
};

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export function DiscoverView({
  subject,
  heading,
  context,
  facts,
  overview,
  art,
  logName,
  wish,
  jackettReady,
  disc,
  children,
}: {
  subject: DiscoverSubject;
  /** The h1 — the film, the series, the season, the episode. */
  heading: string;
  /** What this page is part of, named above the title and linking to it. */
  context?: { label: string; href: string };
  /** The line under the title: year, length, genres — whatever is known. */
  facts: string[];
  overview?: string;
  art: {
    posterPath?: string;
    backdropPath?: string;
    logoPath?: string;
    /** The name the tile that opened this page gave its poster, if any. */
    posterKey?: string;
  };
  /** What the download log should call whatever is fetched from here. */
  logName: string;
  wish?: Wish;
  jackettReady: boolean;
  /** The disc panel, streamed in from the server. Films only. */
  disc?: React.ReactNode;
  /** The seasons of a series, or the episodes of a season. */
  children?: React.ReactNode;
}) {
  const [wanted, setWanted] = useState(wish?.wanted ?? false);
  const [saving, startSaving] = useTransition();

  function want() {
    if (!wish) return;
    const next = !wanted;
    setWanted(next);
    startSaving(async () => {
      if (next) {
        await addWish({
          id: wish.tmdbId,
          kind: wish.kind,
          title: wish.title,
          year: wish.year ? String(wish.year) : undefined,
          posterPath: wish.posterPath,
          overview: wish.overview,
        });
      } else {
        await removeWish(wish.tmdbId, wish.kind);
      }
    });
  }

  return (
    <>
      {/* Hero. The same one a film gets, drawn from TMDb rather than from a
          folder on the drive — there is no folder. */}
      <div className="relative h-96 w-full overflow-hidden sm:h-[32rem]">
        {art.backdropPath ? (
          <>
            <Art
              remote={art.backdropPath}
              size="original"
              className="enter-veil absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
          </>
        ) : (
          <div className="absolute inset-0 bg-surface-strong" />
        )}

        {/* Decorative: the h1 below is the real title, and a screen reader
            saying it twice is the whole cost of repeating it here. */}
        {art.logoPath && (
          <div className="enter-drop pointer-events-none absolute top-6 right-6 z-[5] flex justify-end sm:top-8 sm:right-8">
            <Art
              remote={art.logoPath}
              size="original"
              className="max-h-20 w-auto max-w-[45vw] object-contain object-right drop-shadow-[0_2px_14px_rgba(0,0,0,0.6)] sm:max-h-28 sm:max-w-sm"
            />
          </div>
        )}

        <BackButton label="Back" />
      </div>

      <div className="relative z-10 mx-auto -mt-28 w-full max-w-5xl px-6 sm:px-8">
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end">
          {art.posterPath ? (
            <Art
              remote={art.posterPath}
              size="w780"
              // The poster the tile was showing is the one that should arrive
              // here, so both answer to the same name.
              transitionName={
                art.posterKey ? posterName(art.posterKey) : undefined
              }
              className="h-60 w-40 shrink-0 rounded-card object-cover shadow-2xl ring-1 ring-line"
            />
          ) : (
            <div className="h-60 w-40 shrink-0 rounded-card bg-surface-strong shadow-2xl ring-1 ring-line" />
          )}

          <div className="enter-rise flex min-w-0 flex-col gap-2 pb-1">
            {/* What this page is a part of: a season names its series, an
                episode names both. A film and a series are the top of their
                own tree and name nothing above them. */}
            {context && (
              <Link
                href={context.href}
                className="text-sm opacity-60 transition-opacity hover:opacity-100"
              >
                {context.label}
              </Link>
            )}

            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {heading}
            </h1>

            {/* Where a film's page carries its format badges. Nothing has been
                probed here, so what a release claims is the release list's to
                say — this line is what the thing is. */}
            {facts.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm opacity-60">
                {facts.map((fact, i) => (
                  <span key={fact}>
                    {i > 0 && <span className="mr-2 opacity-50">·</span>}
                    {fact}
                  </span>
                ))}
              </p>
            )}

            {overview && (
              <p className="max-w-prose pt-1 text-sm leading-relaxed opacity-65">
                {overview}
              </p>
            )}
          </div>

          {/* Pinned to the bottom of the title block, exactly as on a film's
              page, and stacked below it where there is no room beside the
              poster to pin anything to.

              A want is the whole film or the whole series: the list is what you
              are missing, and half a series is not a different want — so a
              season and an episode have nothing to put here. */}
          {wish && (
            <div className="mt-2 flex items-center justify-end gap-2 sm:absolute sm:right-0 sm:bottom-1 sm:mt-0">
              <button
                type="button"
                onClick={want}
                disabled={saving}
                aria-pressed={wanted}
                aria-label={
                  wanted
                    ? `Remove ${wish.title} from wishlist`
                    : `Want ${wish.title}`
                }
                title={wanted ? "On the wishlist" : "Add to wishlist"}
                className={`${HERO_BUTTON} ${
                  wanted ? "text-red-600 dark:text-red-400" : ""
                }`}
              >
                <Heart filled={wanted} />
              </button>
            </div>
          )}
        </div>

        {/* The disc, then what is out there. In that order because the second
            is measured in units of the first.

            A series has no such list of its own: television is downloaded a
            season at a time, so the panel belongs under the season being
            looked at — see the seasons below. */}
        <div className="mt-10 flex flex-col">
          {disc}

          {subject.kind !== "tv" && (
            <Downloads
              subject={subject}
              logName={logName}
              posterPath={art.posterPath}
              jackettReady={jackettReady}
            />
          )}
        </div>

        {/* What this thing is made of: a series' seasons, a season's episodes.
            Below the releases rather than above them, because the page is
            first about fetching this and only then about its parts. */}
        {children}
      </div>
    </>
  );
}
