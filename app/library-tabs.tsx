"use client";

import type { LibraryItem } from "@/lib/library";
import type { Show } from "@/lib/shows";
import type { UpgradeQueueItem } from "@/lib/upgrade-sweep";
import { Switch } from "./controls";
import { useTabParam } from "./tab-param";
import { LibraryView } from "./library-view";
import { RescanButton } from "./rescan-button";
import { ShowsView } from "./shows-view";

/**
 * Films and shows are the same library and different work: the filters, sorts
 * and groupings that make sense of a film shelf mean little against a show,
 * which is read season by season. One switch, two shelves.
 *
 * In the URL like every other library control, so opening a show and coming
 * back returns to the tab you were on — through `useTabParam`, which is where
 * that reading and writing lives now, and which carries the switch over as a
 * flight rather than a cut. See app/tab-param.ts.
 */

/** The two shelves, as the values the address may carry. */
const TABS = ["movies", "tv"] as const;

export function LibraryTabs({
  movies,
  shows,
  upgrades,
  jackettReady,
}: {
  movies: LibraryItem[];
  shows: Show[];
  /**
   * The better copies the sweep found, for the film shelf alone.
   *
   * The shows tab is handed neither of these and wants neither: the sweep only
   * searches films — see sweepCandidates in lib/upgrade-sweep.ts — so a series
   * has no release waiting for it to report.
   */
  upgrades: UpgradeQueueItem[];
  jackettReady: boolean;
}) {
  const [tab, select] = useTabParam("t", TABS, "movies");

  const options = [
    { key: "movies" as const, label: "Films" },
    { key: "tv" as const, label: "Shows" },
  ];

  /**
   * The head of whichever shelf is showing, handed to it so the switch and the
   * shelf's own controls can share one line.
   *
   * It belongs to the page rather than to either shelf — it is how you leave
   * one for the other — but the controls beside it belong to the shelf, and a
   * row split across two components is a row that cannot be one line.
   */
  const tabs = (
    <Switch value={tab} onChange={select} options={options} className="-ml-2" />
  );

  /**
   * The shelf's own refresh, at the end of both shelves' rows: read the
   * folders, then ask the indexers about what is in them.
   *
   * This page inherited the queue's job when the queue page went — the films
   * something better has been found for are a section of this shelf now — and
   * it inherited the queue's dead end with it. A card here opens a release
   * stamped "Checked 20 h ago", and the sweep that wrote that line skips
   * anything checked within the day: a reading on screen with nothing to do
   * about it, which is precisely the state `RescanButton` was written to end.
   * It was left on the wishlist alone, while the page that actually shows the
   * releases had no trigger at all.
   *
   * On both tabs, and deliberately so even though the sweep only searches films
   * — what it starts is not this tab's pass but a pass over everything, wants
   * included. The same argument that keeps it at the head of the wishlist
   * rather than on one of its sections.
   *
   * The drive pass in front of it is `readDrive`, and it is here for the same
   * reason the sweep is: this page is the drive, and a shelf that could ask
   * other people's machines about your films but not look at the films
   * themselves had the two halves the wrong way round. The scan runs first —
   * a release is only better than what you have if what you have is what the
   * library thinks it is — and the sweep follows it on the server.
   *
   * Here rather than inside either shelf, for the reason `tabs` is here: it
   * belongs to the page, and a row split across two components is a row that
   * cannot be one line.
   */
  const action = <RescanButton jackettReady={jackettReady} readDrive />;

  return tab === "movies" ? (
    <LibraryView
      movies={movies}
      upgrades={upgrades}
      jackettReady={jackettReady}
      tabs={tabs}
      action={action}
    />
  ) : (
    <ShowsView shows={shows} tabs={tabs} action={action} />
  );
}
