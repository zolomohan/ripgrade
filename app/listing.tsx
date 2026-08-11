"use client";

import { useSearchParams } from "next/navigation";

import { Bar, ICONS, MenuItem, Popover, Switch } from "@/app/controls";
import { pickGroup } from "@/app/grouping";
import { pickSort } from "@/app/sorts";

/**
 * The furniture over a page of tabbed lists: which list, in what order, and cut
 * how.
 *
 * Two pages ask exactly this now — the queue, over what there is to fetch, and
 * the jobs page, over the work the library can do to its own files — and the
 * three questions are the same three questions in both. They were written once
 * for the queue and would have been copied for the second page: ninety lines of
 * markup and a URL-writing function, which is the kind of duplicate that starts
 * identical and ends up with one page's sort menu closing on click and the
 * other's not.
 *
 * All three answers live in the URL, like every other listing here, so opening
 * a film and coming back returns to the list you were reading, in the order you
 * were reading it — and so a link can point at a tab, which is how the
 * dashboard's tiles reach the work they count.
 */

/** An option in one of the two menus, as the menu needs it. */
export type Choice = { key: string; label: string };

export type Listing<T extends string> = {
  tab: T;
  tabs: readonly { key: T; label: string }[];
  /**
   * The raw parameters, passed down untouched. The lists sort and cut
   * themselves — the comparators live with the rows they compare — so what they
   * want is the key that was chosen and not the option it resolved to.
   */
  sort?: string;
  group?: string;
  /** The current tab's own options, and which of each is in force. */
  sorts: Choice[];
  groups: Choice[];
  current: Choice;
  grouping: Choice;
  update: (next: { t?: T; sort?: string; g?: string }) => void;
};

/**
 * Reads the three from the URL and hands back the writer for them.
 *
 * The first tab is the page unasked, and the first option in each menu is that
 * tab's default order and cut — so a page arrives in a known shape, and the
 * parameters that would say so are left out of the URL entirely.
 */
export function useListing<T extends string>(
  tabs: readonly { key: T; label: string }[],
  sorts: Record<T, Choice[]>,
  groups: Record<T, Choice[]>,
): Listing<T> {
  const searchParams = useSearchParams();

  const param = searchParams.get("t");
  const known = tabs.some((option) => option.key === param);
  const tab = (known ? param : tabs[0].key) as T;

  const options = sorts[tab];
  const sort = searchParams.get("sort") ?? undefined;
  const current = pickSort(options, sort);

  const cuts = groups[tab];
  const group = searchParams.get("g") ?? undefined;
  const grouping = pickGroup(cuts, group);

  function update(next: { t?: T; sort?: string; g?: string }) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.t !== undefined) {
      if (next.t === tabs[0].key) params.delete("t");
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
      if (next.g === cuts[0].key) params.delete("g");
      else params.set("g", next.g);
    }

    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  return {
    tab,
    tabs,
    sort,
    group,
    sorts: options,
    groups: cuts,
    current,
    grouping,
    update,
  };
}

/** The row itself: the tabs on the left, the two questions on the right. */
export function ListingBar<T extends string>({
  listing,
}: {
  listing: Listing<T>;
}) {
  const { tab, tabs, sorts, groups, current, grouping, update } = listing;

  return (
    /* Its own space below it rather than the column's gap: this row is the
       page's own furniture, and a list that begins one gap under it reads as a
       fourth control rather than as what the controls act on. */
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      {/* Scrolls rather than clips at the fifth tab. The switch sets its own
          width from its labels and refuses to shrink, which is right — a
          segmented control with squeezed words is unreadable — but on a phone
          five of them are wider than the page, and the layout's own
          `overflow-x-clip` would silently cut the last one off.

          The page's `-ml-2` is spent here rather than on the switch, which is
          the one place it cannot be: this is a scroll container, and a child
          hanging off its left edge is clipped and cannot be scrolled back to.
          Shifting the container takes its padding with it, which is the same
          eight pixels with nothing lost behind them. */}
      <div className="no-scrollbar -mr-1 -ml-2 min-w-0 max-w-full overflow-x-auto px-1">
        <Switch
          value={tab}
          onChange={(next) => update({ t: next as T })}
          // No counts. Numbers across the top read as a scoreboard, and the one
          // that matters is on the list you are looking at — each says its own
          // total in its own terms, which "139" never could.
          //
          // Copied rather than passed: the tab lists are declared `as const` so
          // a tab key is a union rather than a string, and the switch takes a
          // plain array it is free to hold.
          options={tabs.map(({ key, label }) => ({ key, label }))}
        />
      </div>

      {/* The two questions about the list, and nothing else. A filled Scan pill
          used to end this row on the downloads tab, asking the indexers again
          with the once-a-day rule off — the loudest control on a page whose
          whole job is to be read, for a pass that already runs itself after
          every scan. */}
      <div className="flex flex-wrap items-center gap-3">
        {/* The library shelf's own two controls, in the library shelf's own
            bar: the same pair of questions asked of a list — in what order, and
            cut how — so they are the same pair of buttons. */}
        <Bar className="w-auto">
          <Popover
            icon={ICONS.sort}
            label="Sort"
            value={current.label}
            buttonClassName="rounded-l-full"
          >
            {(close) => (
              <div className="py-1">
                {sorts.map((option) => (
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
            // put it in — every tab now opens as one ranked list, so "Group" is
            // what an untouched button says.
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
  );
}
