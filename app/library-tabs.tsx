"use client";

import type { LibraryItem } from "@/lib/library";
import type { Show } from "@/lib/shows";
import type { UpgradeQueueItem } from "@/lib/upgrade-sweep";
import { Switch } from "./controls";
import { useTabParam } from "./tab-param";
import { LibraryView } from "./library-view";
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

  /*
   * No Scan at the end of these rows any more.
   *
   * There were three places to press it — here, the dashboard, and Settings —
   * and this was the one with the strongest claim: the shelf is what a scan
   * refreshes, and the passes behind it are about the films on it. What it was
   * not was the place anybody was standing when they wanted one. A scan is
   * something you ask for on arriving, and arriving is the dashboard: it is the
   * page the app opens on and the one whose whole subject is the state of the
   * library rather than its contents. The mark in its corner is the ask now —
   * see `ScanFab` in app/scan-fab.tsx — and Settings keeps the one for the odd
   * time you have moved a file by hand.
   *
   * Which leaves this row as what it reads as: the tabs, and the controls for
   * arranging what is under them. A verb at the end of it was the only thing
   * here that did not arrange anything.
   */

  return tab === "movies" ? (
    <LibraryView
      movies={movies}
      upgrades={upgrades}
      jackettReady={jackettReady}
      tabs={tabs}
    />
  ) : (
    <ShowsView shows={shows} tabs={tabs} />
  );
}
