import { getWishlist } from "@/lib/wishlist";
import { hasCredentials } from "@/lib/tmdb";
import { WishlistView } from "./wishlist-view";

export const metadata = { title: "Wishlist — RipGrade" };

// Reads the database on every request, like the library itself.
export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  const entries = getWishlist();

  return (
    <div className="flex flex-col">
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 sm:px-8">
        <WishlistView entries={entries} canSearch={hasCredentials()} />
      </main>
    </div>
  );
}
