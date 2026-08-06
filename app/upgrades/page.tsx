import { hasJackett } from "@/lib/jackett";
import { alreadyFetching } from "@/lib/qbittorrent";
import {
  checkedCount,
  getUpgradeQueue,
  sweepCandidates,
} from "@/lib/upgrade-sweep";
import { getWishlistFinds } from "@/lib/wishlist-search";
import { UpgradesView } from "./upgrades-view";

export const metadata = { title: "Queue — RipGrade" };

// Reads the database on every request, like the library itself.
export const dynamic = "force-dynamic";

export default async function UpgradesPage() {
  /*
   * Asked once and applied to both halves: a want and an upgrade are read the
   * same way here, so a release being fetched takes its row off the page
   * whichever question put it there. One round trip to the client for the
   * whole page — the predicate is a lookup, not a request per row.
   */
  const fetching = await alreadyFetching();
  const queue = getUpgradeQueue().filter(
    (item) => !fetching({ title: item.title, magnet: item.hit.magnet }),
  );
  const finds = getWishlistFinds().filter(
    (find) => !fetching({ title: find.title, magnet: find.hit.magnet }),
  );

  return (
    // min-h-dvh rather than flex-1: the layout's own column has no definite
    // height for a flex child to fill, so the viewport is claimed directly —
    // which is what lets an empty state centre itself in it.
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-6 py-8 sm:px-8">
      <UpgradesView
        queue={queue}
        finds={finds}
        candidates={sweepCandidates().length}
        checked={checkedCount()}
        jackettReady={hasJackett()}
      />
    </main>
  );
}
