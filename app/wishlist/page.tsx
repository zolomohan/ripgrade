import { backfillWishlistCollections, getWishlist } from "@/lib/wishlist";
import { WishlistView } from "./wishlist-view";

export const metadata = { title: "Wishlist — RipGrade" };

// Reads the database on every request, like the library itself.
export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  // Entries added before the collection was recorded are filled in here rather
  // than during a scan: a scan is about the drive, and this list is about what
  // is not on it. It runs once per entry and then costs nothing.
  await backfillWishlistCollections();

  const entries = getWishlist();

  return (
    <div className="flex flex-col">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 sm:px-8">
        <WishlistView entries={entries} />
      </main>
    </div>
  );
}
