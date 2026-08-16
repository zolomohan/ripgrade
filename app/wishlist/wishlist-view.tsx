"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { addTransitionType, useTransition, ViewTransition } from "react";

import { removeWish } from "@/app/actions";
import { Art } from "@/app/art";
import { Switch } from "@/app/controls";
import type { GroupOption } from "@/app/grouping";
import { ListingControls, useListingOptions } from "@/app/listing";
import { SectionHeading } from "@/app/section-heading";
import { EmptyState } from "@/app/empty-state";
import { TILE_FRAME, TILE_GRID_RULED } from "@/app/poster-tile";
import { ShelfTotal } from "@/app/shelf-total";
import { movieId, posterName, showId } from "@/lib/routes";
import { stagger } from "@/app/stagger";
import { RemoveButton } from "@/app/tile-button";
import { RescanButton } from "@/app/rescan-button";
import { useTabParam } from "@/app/tab-param";
import { DOWNLOAD_SORTS, DownloadsView, RELEASE_GROUPS } from "./finds-view";
import type { WishlistEntry } from "@/lib/wishlist";
import type { WishlistFind } from "@/lib/wishlist-search";

/**
 * The one list in this app about things that are not on the drive, and now the
 * whole of what happens to it.
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
 *
 * The wants come in two halves, and the split is the sweep's answer to each:
 * **Found**, the films something has turned up for, drawn as the release you
 * would fetch — and **Not found**, everything still outstanding. A want belongs
 * to exactly one of them. It used to appear in both, because the finds were a
 * tab on a page of their own and this page listed the whole wishlist regardless: the
 * same film was a poster here and a release there, one click along the rail,
 * and nothing on either said they were the same thing.
 *
 * Found leads. It is the half with something to do about it — a release, a
 * score, a button that fetches it — and the half that empties itself as you act
 * on it. Not found is the standing list underneath, which changes only when you
 * add to it or the indexers do.
 *
 * A want being fetched right now is on neither list: it has left Found, because
 * it is no longer something to fetch, and it never falls into Not found,
 * because something *was* found for it. It is on the downloads page, which is
 * where every fetch goes whichever list started it — see `answered`, and
 * app/downloads/downloads-view.tsx.
 *
 * One bar of controls over both, at the head of the page. Found and Not found
 * are not two lists with two sets of questions — they are one wishlist cut in
 * two, and the cut is itself the first entry in the Group menu. Choose another
 * and the found half is cut that way instead, by indexer or resolution or the
 * set a film belongs to; the wants nothing was found for cannot answer any of
 * those questions — there is no release to read them off — so they stay
 * gathered at the foot under the name they already had. Every cut ends the same
 * way, and the last thing on the page is always what is still outstanding.
 */

/**
 * The cuts this page can be read along, over the half that has releases in it.
 *
 * The first is the page's own shape and is drawn flat, which is what the key
 * `none` means to `Grouped` — the two halves are already parted by their own
 * headings, so cutting the top one as well would be a rule through a rule. Its
 * label names the shape rather than denying one: every other list in this app
 * opens on "No grouping", and this one opens on a grouping it cannot be
 * without.
 *
 * Then the two facts about the film, which the old wants menu offered and which
 * are worth as much over a shelf of releases: the set it belongs to, and when
 * it came out. Both are read off the wishlist entry rather than the release —
 * a release name knows nothing about a collection — so they are built where the
 * entries are, in `WishlistView`.
 *
 * Then the release's own cuts, exactly as the queue offers them; see
 * `RELEASE_GROUPS`. Its own first entry is dropped, because this list already
 * has a first entry and two ways of saying "flat" in one menu is one too many.
 */
function wishGroups(
  entries: Map<number, WishlistEntry>,
  finds: WishlistFind[],
): GroupOption<WishlistFind>[] {
  return [
    { key: "none", label: "Found / Not found", of: () => "" },
    {
      key: "collection",
      label: "Collection",
      of: (find) => entries.get(find.tmdbId)?.collection?.name ?? "No set",
    },
    {
      key: "year",
      label: "Year",
      of: (find) => (find.year ? String(find.year) : "Unknown year"),
      // Newest first, which alphabetical order is exactly backwards for. Stated
      // as a fixed order over the years actually present rather than left to
      // the sort, because these are numbers wearing strings.
      order: [...new Set(finds.map((find) => find.year).filter(Boolean))]
        .sort((a, b) => b! - a!)
        .map(String),
    },
    ...RELEASE_GROUPS.slice(1),
  ];
}

/** The two lists, as the values the address may carry — the library's own. */
const TABS = ["movies", "tv"] as const;

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
        <div className={TILE_FRAME}>
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

export function WishlistView({
  entries,
  finds,
  answered,
  wants,
  wantsChecked,
  jackettReady,
}: {
  entries: WishlistEntry[];
  /** What the last sweep's wishlist pass turned up, one release per want. */
  finds: WishlistFind[];
  /**
   * Every want the sweep has an answer for, whether or not it is still listed
   * above.
   *
   * Wider than `finds` by exactly the releases already in qBittorrent, which
   * are dropped from that list because they have stopped being things to
   * fetch. Those must not fall through into "Not found" — something *was*
   * found for them, and it is downstairs under Downloading. A want being
   * fetched is in neither list, which is the same rule the queue keeps.
   */
  answered: number[];
  /** Wanted films the sweep would search for, and how many it has asked about. */
  wants: number;
  wantsChecked: number;
  jackettReady: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  /*
   * One set of questions for the page, in the URL like every other listing.
   *
   * The cuts are built here rather than declared beside the component because
   * two of them read the wishlist entry a find belongs to — see `wishGroups`.
   */
  // Films only: TMDb numbers films and series in separate sequences, so a map
  // over both would let a series answer for a film of the same number.
  const byId = new Map(
    entries
      .filter((entry) => entry.kind === "movie")
      .map((entry) => [entry.tmdbId, entry]),
  );
  const groups = wishGroups(byId, finds);
  const listing = useListingOptions(DOWNLOAD_SORTS, groups);

  // The same `t` the library reads, through the same hook, so the two shelves
  // and the two lists all answer to one word in the URL and cross over the same
  // way; see app/tab-param.ts and app/library-tabs.tsx.
  const [tab, select] = useTabParam("t", TABS, "movies");

  const list = entries.filter((e) =>
    tab === "tv" ? e.kind === "tv" : e.kind === "movie",
  );

  const owned = list.filter((e) => e.owned).length;

  /**
   * The wants nothing has turned up for, newest first.
   *
   * A want the sweep answered is drawn once, up above, as the release it would
   * fetch — so it comes out of here. Both lists showed it before this split,
   * which made the page count the same film twice and put its poster on screen
   * twice under one name.
   *
   * Never cut into sections, whatever the Group menu is set to. Every cut this
   * page offers is a question about a release — which indexer answered, what it
   * claims to be, which set the film it is for belongs to — and these are the
   * wants that have no release to ask. Read as a queue, so what you added last
   * is what you are hunting now.
   *
   * Films are matched by id against `answered`; a series is never answered, so
   * on the shows tab this is the whole list. TMDb numbers films and series in
   * separate sequences — 1399 is a film and also Game of Thrones — so the kind
   * has to be checked as well, or a series would drop off the list because a
   * film it never met was found.
   */
  const found = new Set(answered);
  const unanswered = list
    .filter((e) => !(e.kind === "movie" && found.has(e.tmdbId)))
    .sort((a, b) => b.addedAt - a.addedAt);

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

  /*
   * Whether the list is worth splitting in two at all.
   *
   * Films only, because the sweep searches films only: a want that is a series
   * is a season at a time or an episode at a time, and no background pass can
   * decide which — see wishlistCandidates in lib/wishlist-search.ts. On the
   * shows there is no question of found or not found, so there is one list and
   * it keeps the page's own name.
   *
   * And nothing at all when there is nothing wanted and nothing found, where
   * `DownloadsView`'s own empty state would be a second "nothing on the
   * wishlist" directly above the grid's.
   */
  const releases = tab === "movies" && (wants > 0 || finds.length > 0);

  return (
    <div className="flex flex-col gap-8">
      {/* Which half on the left, what to do with it on the right — the line the
          library's shelves already run. The switch stays on an empty tab: it is
          the way back to the other one, and an empty tab is when you want it. */}
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          value={tab}
          onChange={select}
          options={[
            { key: "movies", label: "Films" },
            { key: "tv", label: "Shows" },
          ]}
          className="-ml-2"
        />

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {/* One bar for the page, in the place every listing here keeps its
              own: how the found half is ordered, how the whole list is cut, and
              which shape both halves are read in. Only where there is a found
              half to ask about — on the shows all three questions are about a
              list that is not on the page. */}
          {releases && <ListingControls listing={listing} />}

          {/* The pass that fills the list below, with the once-a-day rule off.
              The page's own control rather than the releases' — a forced sweep
              asks the indexers about every want *and* every film you own, so it
              belongs at the head of the page rather than on one section's
              heading, which is the same argument that kept it out of the
              queue's tabs. Present on both halves of the switch for that
              reason: what it starts is not this tab's pass. */}
          <RescanButton jackettReady={jackettReady} />
        </div>
      </div>

      {/* The list in its two halves, at the gap `Grouped` puts between its own
          sections — because that is what these two are. Found and Not found are
          the first cut this page offers, and they should not sit closer
          together than two indexers do. */}
      <div className="flex flex-col gap-14">
        {releases && (
          <section className="flex flex-col gap-5">
            {/* Headed "Found" only while the list is uncut. Ask for any
                    other grouping and the sections name themselves — the
                    indexer, the resolution, the set — and a "Found" above them
                    would be a rule drawn through a list that is already ruled.
                    What makes them all found is that they are above the one
                    heading that never moves. */}
            {listing.grouping.key === "none" && (
              <SectionHeading label="Found" />
            )}
            <DownloadsView
              finds={finds}
              wants={wants}
              checked={wantsChecked}
              jackettReady={jackettReady}
              sort={listing.sort}
              group={listing.group}
              groups={groups}
              layout={listing.layout}
            />
          </section>
        )}

        {list.length === 0 ? (
          <EmptyState
            icon={
              <>
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
              </>
            }
            title={tab === "tv" ? "No shows wanted yet" : "Nothing wanted yet"}
          >
            Search from anywhere — the button in the corner, or ⌘F — and heart
            the {tab === "tv" ? "series" : "films"} you are hunting for.
          </EmptyState>
        ) : (
          <section className="flex flex-col gap-5">
            {/* Named only where there is something to be named apart from.
                    On the shows, and on a list nothing has been searched for
                    yet, this grid is the whole wishlist — and a heading over
                    all of it would be parting it from nothing. */}
            {releases && (
              <SectionHeading
                label="Not found"
                action={
                  <span className="shrink-0 text-xs opacity-45">
                    {unanswered.length} wanted
                  </span>
                }
              />
            )}

            <div className="flex flex-col gap-6">
              {unanswered.length === 0 ? (
                <p className="text-sm opacity-50">
                  Nothing outstanding — every film on the list has a release
                  waiting above.
                </p>
              ) : (
                // `TILE_GRID_RULED` itself, so this grid clears the rule above
                // it by exactly as much as every other grid on the page does —
                // it was that constant's shape written out by hand, naming the
                // thing it was declining to import.
                <div className={TILE_GRID_RULED}>
                  {unanswered.map((entry, n) => (
                    <Tile
                      key={`${entry.kind}-${entry.tmdbId}`}
                      entry={entry}
                      index={n}
                      busy={pending}
                      onRemove={() => remove(entry)}
                    />
                  ))}
                </div>
              )}

              {/* The tab's own total, not this section's — which is why the
                      heading above carries its own count. A page foot that
                      reported only what is under it would say the wishlist had
                      shrunk every time the sweep found something. */}
              <ShelfTotal
                left={`${list.length} ${
                  tab === "tv"
                    ? list.length === 1
                      ? "show"
                      : "shows"
                    : list.length === 1
                      ? "film"
                      : "films"
                }`}
                right={owned > 0 ? `${owned} now in the library` : undefined}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
