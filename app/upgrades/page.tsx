import { keepsEnhancementLayer } from "@/lib/convert";
import { hasJackett } from "@/lib/jackett";
import { getLibrary } from "@/lib/library";
import { alreadyFetching } from "@/lib/qbittorrent";
import { cleanupFiles, libraryTasks } from "@/lib/queue-tasks";
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

// Reads the database on every request, like the library itself.
export const dynamic = "force-dynamic";

export default async function UpgradesPage() {
  /*
   * The library, read once for the whole page.
   *
   * Four of the questions below want it, and each used to fetch its own copy —
   * four hundred rows of JSON parsed four times to answer four questions about
   * the same four hundred films. Every one of them takes it as an argument now,
   * defaulting to reading it themselves so nothing else had to change.
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
   * Both of the library's own lists, on every request rather than only for the
   * tab being shown: the counts on the switch are what makes the other two tabs
   * worth opening, and neither list touches anything but the database and a
   * stat per candidate.
   */
  const { dovi, audio } = libraryTasks(library);
  // One directory read per folder the library lives in, so it costs about what
  // the two lists above do and is worth having a count for on every request.
  const cleanup = cleanupFiles(library);

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
        dovi={dovi}
        keepingEl={keepsEnhancementLayer()}
        audio={audio}
        cleanup={cleanup}
      />
    </main>
  );
}
