import { hasJackett } from "@/lib/jackett";
import { getLibrary } from "@/lib/library";
import { alreadyFetching, getDownloadLog } from "@/lib/qbittorrent";
import {
  checkedCount,
  getUpgradeQueue,
  sweepCandidates,
} from "@/lib/upgrade-sweep";
import {
  getWishlistFinds,
  wishlistCandidates,
  wishlistCheckedCount,
} from "@/lib/wishlist-search";
import { QueueTabs } from "./queue-tabs";

export const metadata = { title: "Queue — RipGrade" };

// Reads the database and qBittorrent on every request, like the library itself.
export const dynamic = "force-dynamic";

export default async function UpgradesPage() {
  /*
   * The library, read once for the whole page — four hundred rows of JSON, and
   * every question below takes it as an argument rather than reading its own
   * copy.
   */
  const library = getLibrary();
  const movies = library.filter((item) => item.kind === "movie");

  /*
   * Asked once and applied to both halves: a want and an upgrade are read the
   * same way here, so a release being fetched takes its row off the page
   * whichever question put it there. One round trip to the client for the
   * whole page — the predicate is a lookup, not a request per row.
   */
  const fetching = await alreadyFetching();
  const queue = getUpgradeQueue(movies).filter(
    (item) => !fetching({ title: item.title, magnet: item.hit.magnet }),
  );
  const finds = getWishlistFinds().filter(
    (find) => !fetching({ title: find.title, magnet: find.hit.magnet }),
  );

  /*
   * And what has already been handed over, which is the other half of the same
   * tab: a release leaves the list above the moment it is sent, and this is
   * where it goes. Read on the server for the first paint only — the list polls
   * itself from there, quickly while anything is moving.
   *
   * A second read of qBittorrent on top of `alreadyFetching`, and deliberately
   * not folded into it: that one asks whether a magnet is already in the
   * client and is answered by a set of hashes, while this is the log joined to
   * what the client says about each row. Both are one round trip to a program
   * on this machine.
   */
  const transfers = await getDownloadLog();

  return (
    // min-h-dvh rather than flex-1: the layout's own column has no definite
    // height for a flex child to fill, so the viewport is claimed directly —
    // which is what lets an empty state centre itself in it.
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-6 py-8 sm:px-8">
      <QueueTabs
        queue={queue}
        finds={finds}
        candidates={sweepCandidates(movies).length}
        checked={checkedCount()}
        // The downloads tab's own two figures, read the same way the upgrades
        // tab's are: what the sweep would search for, and how much of it has
        // been asked about at all. Without them an empty list cannot tell an
        // empty wishlist from a wishlist nothing is seeding.
        wants={wishlistCandidates().length}
        wantsChecked={wishlistCheckedCount()}
        jackettReady={hasJackett()}
        transfers={transfers}
      />
    </main>
  );
}
