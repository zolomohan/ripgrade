import { getCollectionSets } from "@/lib/collections";
import { getMovies } from "@/lib/library";
import { hasCredentials } from "@/lib/tmdb";
import { getWishlistIds } from "@/lib/wishlist";
import { CollectionsView } from "./collections-view";

export const metadata = { title: "Collections — RipGrade" };

export const dynamic = "force-dynamic";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ missing?: string }>;
}) {
  // In the URL rather than in state: asking TMDb what a set contains is the
  // expensive half of this page, so it should be a link you can share, land on
  // and reload without surprise.
  const withMissing = (await searchParams).missing === "1";
  const sets = await getCollectionSets(getMovies(), withMissing);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 sm:px-8">
      <CollectionsView
        sets={sets}
        withMissing={withMissing}
        canFetch={hasCredentials()}
        wishlisted={[...getWishlistIds()]}
      />
    </main>
  );
}
