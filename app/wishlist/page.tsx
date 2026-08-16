import { hasJackett } from "@/lib/jackett";
import { alreadyFetching } from "@/lib/qbittorrent";
import { backfillWishlistCollections, getWishlist } from "@/lib/wishlist";
import {
  getWishlistFinds,
  wishlistCandidates,
  wishlistCheckedCount,
} from "@/lib/wishlist-search";
import { WishlistView } from "./wishlist-view";

export const metadata = { title: "Wishlist — RipGrade" };

// Reads the database and qBittorrent on every request, like the library itself.
export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  // Entries added before the collection was recorded are filled in here rather
  // than during a scan: a scan is about the drive, and this list is about what
  // is not on it. It runs once per entry and then costs nothing.
  await backfillWishlistCollections();

  const entries = getWishlist();

  /*
   * A release already in the client is no longer something to fetch, so it
   * comes off the list of finds and turns up in the transfers below them
   * instead. One lookup for the whole page — the predicate is a set of hashes,
   * not a request per row.
   *
   * The wants that were answered at all are kept either way, because the page
   * draws everything else as "Not found" and a film being fetched is the one
   * thing that would be a lie about: something was found for it. Read once and
   * cut twice rather than asked for twice.
   */
  const fetching = await alreadyFetching();
  const searched = getWishlistFinds();
  const finds = searched.filter(
    (find) => !fetching({ title: find.title, magnet: find.hit.magnet }),
  );

  return (
    <div className="flex flex-col">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 sm:px-8">
        <WishlistView
          entries={entries}
          finds={finds}
          answered={searched.map((find) => find.tmdbId)}
          // The two figures the empty states need, without which an empty list
          // cannot tell an empty wishlist from a wishlist nothing is seeding.
          wants={wishlistCandidates().length}
          wantsChecked={wishlistCheckedCount()}
          jackettReady={hasJackett()}
        />
      </main>
    </div>
  );
}
