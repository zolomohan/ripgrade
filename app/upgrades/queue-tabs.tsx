"use client";

import { useSearchParams } from "next/navigation";

import { Bar, ICONS, MenuItem, Popover, Switch } from "@/app/controls";
import type { AudioTask, CleanupFile, DoviTask } from "@/lib/queue-tasks";
import type { UpgradeQueueItem } from "@/lib/upgrade-sweep";
import type { WishlistFind } from "@/lib/wishlist-search";
import { CLEANUP_GROUPS, CLEANUP_SORTS, CleanupList } from "./cleanup-list";
import { pickGroup } from "./grouping";
import { pickSort } from "./sorts";
import {
  AUDIO_GROUPS,
  AUDIO_SORTS,
  AudioTasks,
  DOVI_GROUPS,
  DOVI_SORTS,
  DoviTasks,
} from "./task-list";
import {
  DOWNLOAD_SORTS,
  DownloadsView,
  RELEASE_GROUPS,
  UPGRADE_SORTS,
  UpgradesView,
} from "./upgrades-view";

/**
 * Five kinds of pending work, on one page.
 *
 * The queue was only ever the first of these: files worth fetching from
 * somewhere else. But the library's own three jobs — a Profile 7 file that
 * should be 8.1, audio nobody here will ever play, and the originals both of
 * those leave behind — are the same kind of thing from where you are standing:
 * a list of films with something outstanding, which is exactly what this page
 * is for. They were reachable only by opening a film and finding out, one film
 * at a time.
 *
 * They differ in where the work comes from, not in what reading the page is
 * for, so they are tabs rather than five pages: what is left to do, and you
 * choose which kind.
 *
 * The first two used to be one tab, which was the last place on this page where
 * two subjects shared a list. A better copy of a film you own and a film you do
 * not own arrive from the same sweep and are drawn as the same row, and that is
 * the whole of what they have in common: one is ranked by what it would gain
 * over your copy, which the other has no answer to; one empties as you replace
 * files, the other as you fetch them; and the counts worth reporting are films
 * short of their best against wants nobody is seeding. Sharing a tab, the sort
 * menu had to offer an order that meant nothing to half the rows.
 *
 * Both the tab and its sort live in the URL, like every other listing here, so
 * opening a film and coming back returns to the list you were reading, in the
 * order you were reading it.
 */

const TABS = ["upgrades", "downloads", "dovi", "audio", "cleanup"] as const;
type Tab = (typeof TABS)[number];

/**
 * Each tab's own options; the first is what that list is ordered by unasked.
 *
 * Narrowed to what the menu draws. The comparators stay with the lists they
 * compare — this only has to name the choices and remember which was made.
 */
const SORTS: Record<Tab, { key: string; label: string }[]> = {
  upgrades: UPGRADE_SORTS,
  downloads: DOWNLOAD_SORTS,
  dovi: DOVI_SORTS,
  audio: AUDIO_SORTS,
  cleanup: CLEANUP_SORTS,
};

/** And the cuts each list can be made along, "No grouping" first everywhere. */
const GROUPS: Record<Tab, { key: string; label: string }[]> = {
  // The same cuts for both halves of the sweep: what can be asked of a release
  // does not depend on whether you already own a copy of the film.
  upgrades: RELEASE_GROUPS,
  downloads: RELEASE_GROUPS,
  dovi: DOVI_GROUPS,
  audio: AUDIO_GROUPS,
  cleanup: CLEANUP_GROUPS,
};

export function QueueTabs({
  queue,
  finds,
  candidates,
  checked,
  wants,
  wantsChecked,
  jackettReady,
  dovi,
  keepingEl,
  audio,
  cleanup,
}: {
  queue: UpgradeQueueItem[];
  finds: WishlistFind[];
  candidates: number;
  checked: number;
  /** Wanted films the sweep would search for, and how many it has asked about. */
  wants: number;
  wantsChecked: number;
  jackettReady: boolean;
  dovi: DoviTask[];
  /** Whether a conversion started from here keeps the layer it discards. */
  keepingEl: boolean;
  audio: AudioTask[];
  cleanup: CleanupFile[];
}) {
  const searchParams = useSearchParams();
  const param = searchParams.get("t");
  // Upgrades is the page unasked: it is the list the sweep spends most of its
  // time filling, and the one the dashboard's plain /upgrades link means.
  const tab: Tab = TABS.includes(param as Tab) ? (param as Tab) : "upgrades";

  const options = SORTS[tab];
  const sort = searchParams.get("sort") ?? undefined;
  const current = pickSort(options, sort);

  const groups = GROUPS[tab];
  const group = searchParams.get("g") ?? undefined;
  const grouping = pickGroup(groups, group);

  function update(next: { t?: Tab; sort?: string; g?: string }) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.t !== undefined) {
      if (next.t === "upgrades") params.delete("t");
      else params.set("t", next.t);
      // The lists are ranked and cut by different things, so a key from the tab
      // you are leaving means nothing on the one you are opening. Dropped rather
      // than carried across, which puts each tab back in its own default shape.
      params.delete("sort");
      params.delete("g");
    }
    if (next.sort !== undefined) {
      if (next.sort === options[0].key) params.delete("sort");
      else params.set("sort", next.sort);
    }
    if (next.g !== undefined) {
      if (next.g === groups[0].key) params.delete("g");
      else params.set("g", next.g);
    }

    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  return (
    <>
      {/* Its own space below it rather than the column's gap: this row is the
          page's own furniture, and a list that begins one gap under it reads
          as a fourth control rather than as what the controls act on. */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        {/* Scrolls rather than clips at the fifth tab. The switch sets its own
            width from its labels and refuses to shrink, which is right — a
            segmented control with squeezed words is unreadable — but on a phone
            five of them are wider than the page, and the layout's own
            `overflow-x-clip` would silently cut the last one off. */}
        <div className="no-scrollbar -mx-1 min-w-0 max-w-full overflow-x-auto px-1">
          <Switch
            value={tab}
            onChange={(next) => update({ t: next as Tab })}
            // No counts. Five numbers across the top read as a scoreboard, and
            // the one that matters is on the list you are looking at — each says
            // its own total in its own terms, which "139" never could.
            options={[
              { key: "upgrades", label: "Upgrades" },
              { key: "downloads", label: "Downloads" },
              { key: "dovi", label: "Dolby Vision" },
              { key: "audio", label: "Audio tracks" },
              { key: "cleanup", label: "Cleanup" },
            ]}
          />
        </div>

        {/* The two questions about the list, and nothing else. A filled Scan
            pill used to end this row on the downloads tab, asking the indexers
            again with the once-a-day rule off — the loudest control on a page
            whose whole job is to be read, for a pass that already runs itself
            after every scan. */}
        <div className="flex flex-wrap items-center gap-3">
          {/* The library shelf's own two controls, in the library shelf's own
              bar: the same pair of questions asked of a list — in what order,
              and cut how — so they are the same pair of buttons. */}
          <Bar className="w-auto">
            <Popover
              icon={ICONS.sort}
              label="Sort"
              value={current.label}
              buttonClassName="rounded-l-full"
            >
              {(close) => (
                <div className="py-1">
                  {options.map((option) => (
                    <MenuItem
                      key={option.key}
                      active={option.key === current.key}
                      onClick={() => {
                        update({ sort: option.key });
                        close();
                      }}
                    >
                      {option.label}
                    </MenuItem>
                  ))}
                </div>
              )}
            </Popover>

            <Popover
              icon={ICONS.group}
              label="Group by"
              // "Group" rather than "No grouping" when the list is flat: the
              // button has to say what it is before it says what it is set to.
              // Every other state names the cut instead, which is the state you
              // put it in — every tab now opens as one ranked list, so "Group"
              // is what an untouched button says.
              value={grouping.key === "none" ? "Group" : grouping.label}
              buttonClassName="rounded-r-full"
            >
              {(close) => (
                <div className="py-1">
                  {groups.map((option) => (
                    <MenuItem
                      key={option.key}
                      active={option.key === grouping.key}
                      onClick={() => {
                        update({ g: option.key });
                        close();
                      }}
                    >
                      {option.label}
                    </MenuItem>
                  ))}
                </div>
              )}
            </Popover>
          </Bar>
        </div>
      </div>

      {tab === "upgrades" ? (
        <UpgradesView
          queue={queue}
          candidates={candidates}
          checked={checked}
          jackettReady={jackettReady}
          sort={sort}
          group={group}
        />
      ) : tab === "downloads" ? (
        <DownloadsView
          finds={finds}
          wants={wants}
          checked={wantsChecked}
          jackettReady={jackettReady}
          sort={sort}
          group={group}
        />
      ) : (
        // flex-1 in every branch, so an empty list centres its state in the
        // page rather than sitting under the switch.
        <div className="flex flex-1 flex-col">
          {tab === "dovi" ? (
            <DoviTasks
              tasks={dovi}
              keepingEl={keepingEl}
              sort={sort}
              group={group}
            />
          ) : tab === "audio" ? (
            <AudioTasks tasks={audio} sort={sort} group={group} />
          ) : (
            <CleanupList files={cleanup} sort={sort} group={group} />
          )}
        </div>
      )}
    </>
  );
}
