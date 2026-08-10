import { notFound } from "next/navigation";
import { ViewTransition } from "react";

import { Art } from "@/app/art";
import { BackButton } from "@/app/film/[id]/back-button";
import { ScoreRing } from "@/app/score-card";
import { scoreTheme } from "@/app/score-circle";
import { getCollectionSet } from "@/lib/collections";
import { collectionMetaName, collectionTitleName } from "@/lib/routes";
import { getMovies } from "@/lib/library";
import { getWishlistIds } from "@/lib/wishlist";
import { CollectionView } from "./collection-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const set = await getCollectionSet(Number((await params).id), getMovies());
  return { title: `${set?.name ?? "Collection"} — RipGrade` };
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();

  // Always asked, unlike the list: you opened this one, which is the whole
  // signal that its missing half is worth fetching.
  const set = await getCollectionSet(id, getMovies());
  if (!set) notFound();

  // The set's standing, which is the average of what you actually hold — the
  // films you do not have score nothing and would only drag it toward zero for
  // being absent, which is the other question this page already answers.
  const average = set.owned.length
    ? Math.round(
        set.owned.reduce((sum, film) => sum + (film.owned?.score ?? 0), 0) /
          set.owned.length,
      )
    : 0;

  return (
    // The same shape a film and a show open with: artwork first, then the name
    // sitting over the foot of it. A set has its own backdrop on TMDb, so there
    // is no reason for its page to begin colder than a film's.
    <main className="flex flex-col pb-16">
      <div className="relative h-72 w-full overflow-hidden sm:h-96">
        {set.backdropPath ? (
          <>
            <Art
              remote={set.backdropPath}
              size="original"
              className="enter-veil absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
          </>
        ) : (
          <div className="absolute inset-0 bg-surface-strong" />
        )}

        <BackButton label="Back to collections" />
      </div>

      {/* relative + z-10: the hero above is positioned, so without its own
          stacking position this content would paint underneath it. */}
      <div className="relative z-10 mx-auto -mt-24 flex w-full max-w-6xl flex-col gap-12 px-6 sm:px-8">
        <div className="flex items-end justify-between gap-6">
          <div className="enter-rise min-w-0">
            <ViewTransition
              name={collectionTitleName(set.id)}
              share="title"
              default="none"
            >
              <h1 className="w-fit font-display text-3xl leading-tight font-semibold tracking-tight">
                {set.name}
              </h1>
            </ViewTransition>
            {/* The same words the row carried, so the line travels with the
                title rather than being replaced by a different sentence. What
                is missing is stated by the second shelf below, which is where
                you would go looking for it. */}
            <ViewTransition
              name={collectionMetaName(set.id)}
              share="title"
              default="none"
            >
              <p className="mt-2 w-fit text-sm leading-tight opacity-55">
                {set.owned.length} {set.owned.length === 1 ? "film" : "films"}
              </p>
            </ViewTransition>
          </div>

          {/* The same ring a film carries, at the head of the set: one number
              for the shelf, drawn the way every other score in the app is. */}
          {set.owned.length > 0 && (
            <ScoreRing
              score={average}
              ring={scoreTheme(average).stroke}
              caption="average"
            />
          )}
        </div>

        <CollectionView set={set} wishlisted={[...getWishlistIds()]} />
      </div>
    </main>
  );
}
