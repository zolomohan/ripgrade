"use client";

import { useSearchParams } from "next/navigation";

import { Bar, ICONS, MenuItem, Popover, Switch } from "@/app/controls";
import { pickGroup } from "@/app/grouping";
import { pickSort } from "@/app/sorts";

/**
 * The furniture over a page of lists: which list, in what order, and cut how.
 *
 * Three pages ask this now — the jobs page, over the work the library can do to
 * its own files; the queue, over the better copies there are to fetch; and the
 * wishlist, over what has turned up for the films you do not own — and the
 * questions are the same questions in every one. They were written once for the
 * queue and would have been copied for each: ninety lines of markup and a
 * URL-writing function, which is the kind of duplicate that starts identical and
 * ends up with one page's sort menu closing on click and the other's not.
 *
 * Two of those pages are one list rather than several, so the tabs are the part
 * that comes off: `useListingOptions` and `ListingControls` are the questions
 * about a list, and `useListing` and `ListingBar` are those plus the switch that
 * says which list is being asked about.
 *
 * All the answers live in the URL, like every other listing here, so opening a
 * film and coming back returns to the list you were reading, in the order you
 * were reading it — and so a link can point at a tab, which is how the
 * dashboard's tiles reach the work they count.
 */

/** An option in one of the two menus, as the menu needs it. */
export type Choice = { key: string; label: string };

/**
 * The two shapes a list of films can be read in.
 *
 * Re-exported rather than declared: the answer is a setting now — see
 * `readLayout` in lib/layout.ts — and the pages that draw a list both ways are
 * handed it by their server page rather than asking a control here for it. It
 * was the fourth question in this bar for as long as it was a fact about the
 * page; it is a fact about the reader, and it stopped being asked once per
 * page.
 */
export type { Layout } from "@/lib/layout";

/** What the two menus can be asked to change. */
export type ListingChange = { sort?: string; g?: string };

/** The questions about one list, and how they were answered. */
export type ListingOptions = {
  /**
   * The raw parameters, passed down untouched. The lists sort and cut
   * themselves — the comparators live with the rows they compare — so what they
   * want is the key that was chosen and not the option it resolved to.
   */
  sort?: string;
  group?: string;
  /** The list's own options, and which of each is in force. */
  sorts: Choice[];
  groups: Choice[];
  current: Choice;
  grouping: Choice;
  update: (next: ListingChange) => void;
};

export type Listing<T extends string> = Omit<ListingOptions, "update"> & {
  tab: T;
  tabs: readonly { key: T; label: string }[];
  update: (next: { t?: T } & ListingChange) => void;
};

/**
 * Writes the answers back without a navigation.
 *
 * `replaceState` rather than the router: these are questions about how the page
 * you are on is drawn, and every one of them would otherwise be a step in the
 * history you have to press back through to leave.
 */
function commit(params: URLSearchParams) {
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

/**
 * An answer written, or dropped where it is the one the page opens in.
 *
 * A list arrives in a known shape, so the parameters that would only say so are
 * left out of the URL entirely — which is what keeps a shared link short and a
 * default one address rather than two.
 */
function set(
  params: URLSearchParams,
  key: string,
  value: string,
  fallback: string,
) {
  if (value === fallback) params.delete(key);
  else params.set(key, value);
}

/**
 * Reads the three from the URL and hands back the writer for them.
 *
 * The first option in each menu is the list's default order and cut. For a page
 * that is one list this is the whole of it; `useListing` adds the tab.
 */
export function useListingOptions(
  sorts: Choice[],
  groups: Choice[],
): ListingOptions {
  const searchParams = useSearchParams();

  const sort = searchParams.get("sort") ?? undefined;
  const group = searchParams.get("g") ?? undefined;

  function update(next: ListingChange) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.sort !== undefined) set(params, "sort", next.sort, sorts[0].key);
    if (next.g !== undefined) set(params, "g", next.g, groups[0].key);
    commit(params);
  }

  return {
    sort,
    group,
    sorts,
    groups,
    current: pickSort(sorts, sort),
    grouping: pickGroup(groups, group),
    update,
  };
}

/**
 * The same, over a page of several lists: which one, and then the three.
 *
 * The first tab is the page unasked, and each tab brings its own menus — so
 * `sorts` and `groups` are keyed by tab rather than being one list of options.
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

  const options = useListingOptions(sorts[tab], groups[tab]);

  function update(next: { t?: T } & ListingChange) {
    if (next.t === undefined) return options.update(next);

    const params = new URLSearchParams(searchParams.toString());
    set(params, "t", next.t, tabs[0].key);
    // The lists are ranked and cut by different things, so a key from the tab
    // you are leaving means nothing on the one you are opening. Dropped rather
    // than carried across, which puts each tab back in its own default shape.
    params.delete("sort");
    params.delete("g");
    commit(params);
  }

  return { ...options, tab, tabs, update };
}

/*
 * Two hooks stood here once and neither is left. `useLayout` asked posters or
 * rows on its own, for a page with nothing else to ask; `LayoutToggle` drew the
 * answer as the third control in this bar. The question is a setting now — one
 * answer, under Settings → Themes, obeyed by every list that draws both ways —
 * so what was a control repeated on three pages is a preference stated once.
 */

/**
 * The two questions about a list, in one bar.
 *
 * Its own component because a list does not have to be a tab to be asked them:
 * the queue and the wishlist are each a single page-long list, and what they
 * want is this bar without a switch in front of it. `ListingBar` is this plus
 * the switch.
 */
export function ListingControls({ listing }: { listing: ListingOptions }) {
  const { sorts, groups, current, grouping, update } = listing;

  /*
   * A menu is drawn where there is a choice in it, and the bar caps whichever
   * ends up at each end.
   *
   * The Group button has always come and gone on this rule — a menu of one item
   * saying "No grouping" is a control that exists to say it does nothing — and
   * Sort follows it now that a page can declare a single order. The downloads
   * log is that page: it is a record, and a record reads newest first or it is
   * not being read as one.
   *
   * The caps cannot be written onto the buttons, because which button is at
   * which end is now a question about what was drawn. One control takes the
   * whole pill; two take one cap each.
   */
  const ranked = sorts.length > 1;
  const cut = groups.length > 1;
  if (!ranked && !cut) return null;

  const capLeft = ranked ? "rounded-l-full" : "";
  const capRight = cut ? "rounded-r-full" : "";

  return (
    /* The library shelf's own two controls, in the library shelf's own bar: the
       same pair of questions asked of a list — in what order, and cut how — so
       they are the same pair of buttons. */
    <Bar className="w-auto">
      {ranked && (
        <Popover
          icon={ICONS.sort}
          label="Sort"
          value={current.label}
          buttonClassName={`${capLeft} ${cut ? "" : "rounded-r-full"}`}
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
      )}

      {/* Only where there is a choice to make. A list that can be cut one way
          — which is to say not at all — would otherwise carry a button that
          opens a menu of a single item saying "No grouping", which is a control
          that exists to tell you it does nothing. The downloads page is the one
          that asks: what is arriving and what has arrived are ranked but never
          cut, since every cut worth naming there is a fact printed on the row
          itself. Written as a length rather than a flag so a page declares its
          cuts and the bar draws what it was given. */}
      {groups.length > 1 && (
        <Popover
          icon={ICONS.group}
          label="Group by"
          // "Group" rather than "No grouping" when the list is flat: the button
          // has to say what it is before it says what it is set to. Every other
          // state names the cut instead, which is the state you put it in —
          // every list now opens as one ranked list, so "Group" is what an
          // untouched button says.
          value={grouping.key === "none" ? "Group" : grouping.label}
          buttonClassName={`${capRight} ${ranked ? "" : "rounded-l-full"}`}
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
      )}
    </Bar>
  );
}

/** The row itself: the tabs on the left, the three questions on the right. */
export function ListingBar<T extends string>({
  listing,
  action,
}: {
  listing: Listing<T>;
  /**
   * One control of the page's own, at the end of the row after the two menus.
   *
   * Not every tabbed list has something to do to itself — the jobs page reads
   * work that is already queued — so it is a slot rather than a prop the bar
   * knows the meaning of. The queue's is the pass that fills it.
   */
  action?: React.ReactNode;
}) {
  const { tab, tabs, update } = listing;

  return (
    /* No margin of its own. It used to keep `mb-8` under itself — this row is
       the page's furniture and a list beginning one gap below it reads as a
       fourth control — but the column it sits in has a gap too, and the two
       added: 56px here against 24px under the switch on the shelves and 40px
       under the one on the stats page. Four pages, four distances, all meaning
       "this is the head of the page".

       The distance is the column's now, and it is 2rem everywhere. See the
       note on the jobs page's `main`. */
    <div className="flex flex-wrap items-center justify-between gap-3">
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

      {/* The two questions about the list, and then whatever the page can do to
          it. The queue's Scan pill was taken off this row once for being the
          loudest control on a page whose whole job is to be read — but the pass
          it runs is the only one that ignores the once-a-day rule, and without
          it a row that says "checked 20 h ago" is a fact with nothing to do
          about it. It is back, as a slot the bar does not have to understand. */}
      <div className="flex flex-wrap items-center gap-3">
        <ListingControls listing={listing} />
        {action}
      </div>
    </div>
  );
}
