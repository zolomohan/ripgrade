import { notFound } from "next/navigation";

import { getCustomSet } from "@/lib/custom-collections";
import { getMovies } from "@/lib/library";
import { getWishlistIds } from "@/lib/wishlist";
import { CustomCollectionView } from "./custom-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const set = getCustomSet(Number((await params).id), getMovies());
  return { title: `${set?.name ?? "Collection"} — RipGrade` };
}

/**
 * A set of your own, on the page a TMDb set gets.
 *
 * Everything below the hero is the same component the published sets are drawn
 * with — same grid, same two shelves, same tiles — because being the same is
 * the whole claim: a collection you wrote down is a collection, not a second
 * kind of thing with a page of its own conventions.
 *
 * What is different is that this one can be changed, and every control that
 * changes it lives in the client half beside the shelves.
 */
export default async function CustomCollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();

  const set = getCustomSet(id, getMovies());
  if (!set) notFound();

  return <CustomCollectionView set={set} wishlisted={[...getWishlistIds()]} />;
}
