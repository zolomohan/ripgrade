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
 * A grid is for recognising and a list is for reading — the same division the
 * library shelf and the film page have always had between a poster and a row of
 * figures. Which one a page wants depends on what you came to it for, so both
 * pages that ask the three questions above ask this fourth one as well.
 *
 * Grid leads, because on both of these pages every row is a film and a film is
 * recognised by its artwork long before it is recognised by its filename. The
 * rows are what you drop to when the figures are the point — which of forty
 * conversions is largest, what a release actually claims to be — and they say
 * more per row than a tile ever can.
 */
export type Layout = "grid" | "rows";

/** What the three menus can be asked to change. */
export type ListingChange = { sort?: string; g?: string; v?: Layout };

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
  /** And how they are drawn, which is not a question about the list — see below. */
  layout: Layout;
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
  const layout: Layout = searchParams.get("v") === "rows" ? "rows" : "grid";

  function update(next: ListingChange) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.sort !== undefined) set(params, "sort", next.sort, sorts[0].key);
    if (next.g !== undefined) set(params, "g", next.g, groups[0].key);
    if (next.v !== undefined) set(params, "v", next.v, "grid");
    commit(params);
  }

  return {
    sort,
    group,
    sorts,
    groups,
    current: pickSort(sorts, sort),
    grouping: pickGroup(groups, group),
    layout,
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
    //
    // The layout is not dropped with them, and that is the whole difference
    // between it and the other two: a sort key is a fact about one list, while
    // reading a page as posters or as rows is a fact about the person reading
    // it. Reset at every tab it would be a preference you have to state three
    // times to hold.
    params.delete("sort");
    params.delete("g");
    if (next.v !== undefined) set(params, "v", next.v, "grid");
    commit(params);
  }

  return { ...options, tab, tabs, update };
}

/*
 * There was a `useLayout` here — posters or rows on its own, for a page with
 * nothing else to ask. The downloads page was the only one that ever asked it,
 * on the grounds that what is moving and what has been sent are two sections
 * rather than a list you would rank. That page asks all three questions now,
 * through `useListing` like every other list here, and a hook kept for nobody
 * is a second way of doing something with no one left doing it.
 */

/**
 * The third question about the list, drawn the way the two menus are.
 *
 * It was very nearly a menu of two like its neighbours, and a menu is the wrong
 * shape for a pair — you would open a panel to choose between the thing you are
 * looking at and the only other thing there is.
 *
 * So it says what it is set to, as the menus do, and switching is the click
 * rather than a step after it. `aria-pressed` is not what this is: it is not a
 * mode being held down, it is one of two named states, so the label says which
 * state pressing it produces.
 */
export function LayoutToggle({
  layout,
  onChange,
  className = "rounded-full",
}: {
  layout: Layout;
  onChange: (next: Layout) => void;
  /** Which caps it keeps: the end of a bar of three, or the whole of one. */
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(layout === "grid" ? "rows" : "grid")}
      aria-label={layout === "grid" ? "Show as rows" : "Show as a grid"}
      title={
        layout === "grid"
          ? "Read these as rows, with the figures on them"
          : "Read these as a grid of posters"
      }
      // The Popover trigger's own shape, spelled out rather than shared: that
      // one is a button that opens a panel, and everything about it beyond
      // these classes — the open state, the outside click, the panel — is
      // exactly what this does not do.
      className={`flex items-center gap-2 self-stretch px-3.5 text-sm transition-colors hover:bg-surface-strong ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="h-4 w-4 opacity-50"
      >
        <path d={layout === "grid" ? ICONS.grid : ICONS.rows} />
      </svg>
      <span className="hidden sm:inline">
        {layout === "grid" ? "Grid" : "Rows"}
      </span>
    </button>
  );
}

/**
 * The three questions about a list, in one bar.
 *
 * Its own component because a list does not have to be a tab to be asked them:
 * the queue and the wishlist are each a single page-long list, and what they
 * want is this bar without a switch in front of it. `ListingBar` is this plus
 * the switch.
 */
export function ListingControls({ listing }: { listing: ListingOptions }) {
  const { sorts, groups, current, grouping, layout, update } = listing;

  return (
    /* The library shelf's own two controls, in the library shelf's own bar: the
       same pair of questions asked of a list — in what order, and cut how — so
       they are the same pair of buttons. */
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

      {/* The third question about the list, in the bar the other two are in:
          the same frame, the same rule between the parts, the same cap on the
          end. */}
      <LayoutToggle
        layout={layout}
        onChange={(v) => update({ v })}
        className="rounded-r-full"
      />
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
    /* Its own space below it rather than the column's gap: this row is the
       page's own furniture, and a list that begins one gap under it reads as a
       fourth control rather than as what the controls act on. */
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
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
