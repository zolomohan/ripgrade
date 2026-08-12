"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  addTransitionType,
  Fragment,
  useState,
  useTransition,
  ViewTransition,
} from "react";

import { removeWish } from "@/app/actions";
import { Art } from "@/app/art";
import { Bar, ICONS, MenuItem, Popover, Switch } from "@/app/controls";
import { movieId, posterName, showId } from "@/lib/routes";
import { stagger } from "@/app/stagger";
import { RemoveButton } from "@/app/tile-button";
import type { WishlistEntry } from "@/lib/wishlist";

/**
 * The one list in this app about things that are not on the drive.
 *
 * Its job is to stop being a want list, entry by entry, so an entry the library
 * has already matched is not quietly dropped — it stays, marked as got, until
 * you take it off yourself. That is the moment the list exists to show you.
 *
 * Wants arrive here from the floating search, which is where every question
 * about something not on this list gets asked. This page is the list itself:
 * what is on it, how it is grouped, and what to go and fetch.
 *
 * Films and shows are split by the same switch the library uses, in the same
 * place, keyed to the same `t` in the URL — one list read two ways, and the way
 * you left it is the way you come back to it.
 */

const GROUPINGS = [
  { key: "added", label: "None" },
  { key: "collection", label: "Collection" },
  { key: "year", label: "Year" },
];

/** A series belongs to no collection, so that grouping is not offered for one. */
const SHOW_GROUPINGS = GROUPINGS.filter((o) => o.key !== "collection");

/** How many paces the ladder in globals.css defines before it repeats. */
const WISH_STEPS = 6;

/**
 * The classes a wanted film answers to while a film is being taken off the
 * list, and only then.
 *
 * Keyed by transition type so the tiles are snapshotted for exactly that
 * gesture: the leaver plays the exit and the rest carry their snapshots to
 * their new places (see the .wish-* rules in globals.css). Every other
 * transition — navigation, a scan's refresh — sees `none` and pays nothing
 * for these names existing.
 *
 * The move pace is picked by place, the same ladder the collections fan
 * runs: on one clock the grid slides as a single sheet, laddered it closes
 * ranks tile by tile.
 */
const wishMotion = (index: number) => ({
  default: "none" as const,
  exit: { "wish-remove": "wish-exit", default: "none" },
  update: {
    "wish-remove": `wish-move-${index % WISH_STEPS}`,
    default: "none",
  },
});

/**
 * What the library already holds of a want, as the line across the poster: a
 * film is there or it is not, a show is there by degrees, and a link either way
 * to whatever is on the drive.
 */
function Held({ owned }: { owned: NonNullable<WishlistEntry["owned"]> }) {
  const [href, label] =
    owned.kind === "movie"
      ? [`/film/${movieId(owned.path)}`, "In the library"]
      : [
          `/show/${showId(owned.showKey)}`,
          `${owned.episodeCount} ${
            owned.episodeCount === 1 ? "episode" : "episodes"
          } on the drive`,
        ];

  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className="absolute inset-x-2 bottom-2 truncate rounded-chip bg-background/85 px-1.5 text-center text-[10px] leading-[18px] font-medium text-emerald-600 backdrop-blur dark:text-emerald-400"
    >
      {label}
    </Link>
  );
}

/** A want as a poster, with the same remove affordance as the row. */
function Tile({
  entry,
  onRemove,
  busy,
  index,
}: {
  entry: WishlistEntry;
  onRemove: () => void;
  busy: boolean;
  index: number;
}) {
  return (
    <ViewTransition
      name={`wish-${entry.kind}-${entry.tmdbId}`}
      {...wishMotion(index)}
    >
      <div
        style={stagger(index)}
        className="row-enter group relative flex flex-col gap-2"
      >
        {/* The poster opens its page — the same page the search opens, which is
            where what a want *is* and every release of it now live.

            Everything drawn on the poster is inside the frame, because the
            frame is what lifts under the pointer: a cross pinned outside it
            hangs still while the picture it belongs to moves. That puts the
            link inside as well — an anchor cannot hold a button, so the anchor
            is what gives way. */}
        <div className="glow glow-over tilt relative aspect-[2/3] overflow-hidden rounded-card bg-surface-strong ring-1 ring-line">
          <Link
            href={`/discover/${entry.kind}/${entry.tmdbId}`}
            aria-label={entry.title}
            className="block h-full"
          >
            {entry.posterPath && (
              <Art
                remote={entry.posterPath}
                // The name the page's own poster answers to, so the tile
                // travels into it rather than being swapped for it.
                transitionName={posterName(
                  `tmdb-${entry.kind}-${entry.tmdbId}`,
                )}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            )}
          </Link>

          {entry.owned && <Held owned={entry.owned} />}

          {/* The app's one cross, in the corner it keeps everywhere — see
              app/tile-button.tsx. This tile had a cross of its own before it,
              on a plate, half the size, in the other corner. */}
          <RemoveButton
            label={`Remove ${entry.title} from the wishlist`}
            title="Remove from wishlist"
            disabled={busy}
            onClick={onRemove}
          />
        </div>

        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={entry.title}>
            {entry.title}
          </p>
          {entry.year && <p className="text-[11px] opacity-45">{entry.year}</p>}
        </div>
      </div>
    </ViewTransition>
  );
}

export function WishlistView({ entries }: { entries: WishlistEntry[] }) {
  const [group, setGroup] = useState("added");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // The same `t` the library reads, so the two shelves and the two lists all
  // answer to one word in the URL; see app/library-tabs.tsx.
  const searchParams = useSearchParams();
  const tab = searchParams.get("t") === "tv" ? "tv" : "movies";

  function select(next: "movies" | "tv") {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "tv") params.set("t", "tv");
    else params.delete("t");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  const list = entries.filter((e) =>
    tab === "tv" ? e.kind === "tv" : e.kind === "movie",
  );
  const groupings = tab === "tv" ? SHOW_GROUPINGS : GROUPINGS;
  // A grouping the other tab does not offer falls back rather than showing
  // nothing: switching to the shows while grouped by collection is a switch,
  // not a request for an empty page.
  const grouping = groupings.find((o) => o.key === group) ?? groupings[0];

  const owned = list.filter((e) => e.owned).length;

  /**
   * Within any group, newest first: a want list is read as a queue, and what
   * you added last is what you are hunting now.
   */
  const newest = (list: WishlistEntry[]) =>
    [...list].sort((a, b) => b.addedAt - a.addedAt);

  /**
   * The default is that queue, whole — no headings. Grouping is offered
   * rather than imposed: by collection for filling out a set, by year for
   * working through an era, each still newest-first inside.
   */
  const groups = (() => {
    if (grouping.key === "collection") {
      // Only where a set is more than one film: a heading over a single
      // poster fragments the page without telling you anything the poster
      // did not.
      const bySet = new Map<string, WishlistEntry[]>();
      const loose: WishlistEntry[] = [];

      for (const entry of list) {
        if (!entry.collection) {
          loose.push(entry);
          continue;
        }
        const bucket = bySet.get(entry.collection.name);
        if (bucket) bucket.push(entry);
        else bySet.set(entry.collection.name, [entry]);
      }

      const sets: { name?: string; entries: WishlistEntry[] }[] = [];
      for (const [name, list] of bySet) {
        if (list.length > 1) sets.push({ name, entries: list });
        else loose.push(...list);
      }

      sets.sort((a, b) => a.name!.localeCompare(b.name!));
      return loose.length
        ? [...sets, { name: "Everything else", entries: newest(loose) }]
        : sets;
    }

    if (grouping.key === "year") {
      const byYear = new Map<string, WishlistEntry[]>();
      for (const entry of list) {
        const key = entry.year ? String(entry.year) : "Unknown year";
        const bucket = byYear.get(key);
        if (bucket) bucket.push(entry);
        else byYear.set(key, [entry]);
      }

      return [...byYear.entries()]
        .sort((a, b) => {
          if (a[0] === "Unknown year") return 1;
          if (b[0] === "Unknown year") return -1;
          return Number(b[0]) - Number(a[0]);
        })
        .map(([name, list]) => ({ name, entries: newest(list) }));
    }

    return [{ name: undefined, entries: newest(list) }];
  })();

  /**
   * Taking an entry off runs as a typed transition: the type is what the tiles'
   * exit and reflow classes are keyed on, so the leaver animates out and the
   * rest travel to their new places — on this gesture and no other.
   */
  const remove = (entry: WishlistEntry) =>
    startTransition(async () => {
      addTransitionType("wish-remove");
      await removeWish(entry.tmdbId, entry.kind);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      {/* Which half on the left, what to do with it on the right — the line the
          library's shelves already run. The switch stays on an empty tab: it is
          the way back to the other one, and an empty tab is when you want it. */}
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          value={tab}
          onChange={(next) => select(next as "movies" | "tv")}
          options={[
            { key: "movies", label: "Films" },
            { key: "tv", label: "Shows" },
          ]}
          className="-ml-2"
        />

        {list.length > 0 && (
          <Bar className="ml-auto">
            <Popover
              icon={ICONS.group}
              label="Group by"
              value={grouping.label}
              // The bar's only slot, so the fill follows both its rounded ends.
              buttonClassName="rounded-full"
            >
              {(close) => (
                <div className="py-1">
                  {groupings.map((option) => (
                    <MenuItem
                      key={option.key}
                      active={option.key === grouping.key}
                      onClick={() => {
                        setGroup(option.key);
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
        )}
      </div>

      {list.length === 0 ? (
        <div className="rounded-card border border-line bg-surface px-4 py-12 text-center">
          <p className="text-sm opacity-50">
            {tab === "tv"
              ? "No shows on the list yet. Search from anywhere — the button in the corner — and heart the series you are hunting for."
              : "Nothing on the list yet. Search from anywhere — the button in the corner — and heart the films you are hunting for."}
          </p>
        </div>
      ) : (
        <>
          {groups.map((section, i) => (
            <Fragment key={section.name ?? "all"}>
              {/* Space alone between the groups: each already has a rule under
                  its own name, and a second one at its foot fenced the films
                  in rather than parting them from what follows. */}
              <section
                className={`flex flex-col gap-7 ${i > 0 ? "pt-14" : "pt-6"}`}
              >
                {section.name && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-4">
                      <h2 className="font-display text-lg font-semibold tracking-tight">
                        {section.name}
                      </h2>
                      <span className="shrink-0 text-xs opacity-45">
                        {section.entries.length} wanted
                      </span>
                    </div>
                    <div aria-hidden className="rule-head" />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
                  {section.entries.map((entry, n) => (
                    <Tile
                      key={`${entry.kind}-${entry.tmdbId}`}
                      entry={entry}
                      index={n}
                      busy={pending}
                      onRemove={() => remove(entry)}
                    />
                  ))}
                </div>
              </section>
            </Fragment>
          ))}

          <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-4 text-xs opacity-45">
            <p>
              {list.length}{" "}
              {tab === "tv"
                ? list.length === 1
                  ? "show"
                  : "shows"
                : list.length === 1
                  ? "film"
                  : "films"}
            </p>
            {owned > 0 && <p>{owned} now in the library</p>}
          </div>
        </>
      )}
    </div>
  );
}
