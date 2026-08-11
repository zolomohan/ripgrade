"use client";

import { ListingBar, useListing, type Choice } from "@/app/listing";
import { SectionHeading } from "@/app/section-heading";
import type { DownloadEntry } from "@/lib/qbittorrent";
import type { UpgradeQueueItem } from "@/lib/upgrade-sweep";
import type { WishlistFind } from "@/lib/wishlist-search";
import { Transfers } from "./transfers";
import {
  DOWNLOAD_SORTS,
  DownloadsView,
  RELEASE_GROUPS,
  UPGRADE_SORTS,
  UpgradesView,
} from "./upgrades-view";

/**
 * Everything that comes from somewhere else: what to fetch, and what is being
 * fetched.
 *
 * A better copy of a film you own and a film you do not own arrive from the
 * same sweep and are drawn as the same row. That is also the whole of what they
 * have in common: one is ranked by what it would gain over your copy, which the
 * other has no answer to; one empties as you replace files, the other as you
 * fetch them; and the counts worth reporting are films short of their best
 * against wants nobody is seeding. Sharing a tab, the sort menu had to offer an
 * order that meant nothing to half the rows — so they are two.
 *
 * Three more tabs used to be here: the Profile 7 files worth converting, the
 * audio nobody will ever play, and the originals both of those leave behind.
 * They read as the same kind of thing from where you were standing — a list of
 * films with something outstanding — but what you do about one is a job this
 * app runs, watches, and writes down afterwards. That is the jobs page's
 * subject, and the pending work now sits above the log of the same work rather
 * than a page away from it. See app/jobs/jobs-view.tsx.
 *
 * What is left is the page's actual subject — and the downloads themselves have
 * joined it. Those were a page of their own, one click along the rail: you
 * pressed Download on a find, its row vanished because it is being fetched and
 * is no longer something to fetch, and where it had gone was somewhere else.
 * The two are one tab now, so a row leaves the list at the top of it and turns
 * up in the list underneath. See ./transfers.tsx.
 */

const TABS = [
  { key: "upgrades", label: "Upgrades" },
  // Labelled for what the list is *of* rather than what is happening to it:
  // the rows are the wishlist's finds and the fetches they turn into, and the
  // dashboard has always sent you here under the name "Wishlist finds". The
  // key stays `downloads`, so existing links still open the right tab.
  { key: "downloads", label: "Wishlist" },
] as const;

type Tab = (typeof TABS)[number]["key"];

/**
 * Each tab's own options; the first is what that list is ordered by unasked.
 *
 * Narrowed to what the menu draws. The comparators stay with the lists they
 * compare — this only has to name the choices and remember which was made.
 */
const SORTS: Record<Tab, Choice[]> = {
  upgrades: UPGRADE_SORTS,
  downloads: DOWNLOAD_SORTS,
};

/**
 * And the cuts each list can be made along, "No grouping" first everywhere.
 *
 * The same cuts for both: what can be asked of a release does not depend on
 * whether you already own a copy of the film.
 */
const GROUPS: Record<Tab, Choice[]> = {
  upgrades: RELEASE_GROUPS,
  downloads: RELEASE_GROUPS,
};

export function QueueTabs({
  queue,
  finds,
  candidates,
  checked,
  wants,
  wantsChecked,
  jackettReady,
  transfers,
}: {
  queue: UpgradeQueueItem[];
  finds: WishlistFind[];
  candidates: number;
  checked: number;
  /** Wanted films the sweep would search for, and how many it has asked about. */
  wants: number;
  wantsChecked: number;
  jackettReady: boolean;
  /** Everything ever handed to qBittorrent, as of this request. */
  transfers: DownloadEntry[];
}) {
  // Upgrades is the page unasked: it is the list the sweep spends most of its
  // time filling, and the one the dashboard's plain /upgrades link means.
  const listing = useListing(TABS, SORTS, GROUPS);

  return (
    <>
      <ListingBar listing={listing} />

      {listing.tab === "upgrades" ? (
        /* `flex-1` on the section rather than only on the list inside it: the
           list claims the page's spare height so an empty state can centre in
           it, and a section that did not pass the height on would leave it
           centring in nothing. */
        <section className="flex flex-1 flex-col gap-1">
          <SectionHeading label="Pending" />
          <UpgradesView
            queue={queue}
            candidates={candidates}
            checked={checked}
            jackettReady={jackettReady}
            sort={listing.sort}
            group={listing.group}
          />
        </section>
      ) : (
        /* One tab, the whole life of a fetch, in the order the jobs page puts
           the same three in: what is moving now, what is still to send, and
           what has been sent. Running before pending, because a transfer in
           flight is the thing you opened the tab to look at — a list of what
           you have not sent yet is not what you came back for while something
           is at 40%.

           So the finds go *through* the transfer list rather than above it:
           the two halves either side of them share one poll and one dialog.
           See ./transfers.tsx. */
        <Transfers
          initial={transfers}
          between={
            <section className="flex flex-col gap-1">
              {/* Named, like the other tab's list and like the jobs page's
                  outstanding work. A heading that appears on one tab and not
                  the next reads as a section the second tab is missing rather
                  than as one it does not need. */}
              <SectionHeading label="Pending" />
              <DownloadsView
                finds={finds}
                wants={wants}
                checked={wantsChecked}
                jackettReady={jackettReady}
                sort={listing.sort}
                group={listing.group}
              />
            </section>
          }
        />
      )}
    </>
  );
}
