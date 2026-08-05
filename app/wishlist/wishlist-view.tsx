"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addTransitionType,
  Fragment,
  useEffect,
  useRef,
  useState,
  useTransition,
  ViewTransition,
} from "react";

import { addWish, removeWish, searchTmdb, type SearchHit } from "@/app/actions";
import { Bar, BarSearch, ICONS, MenuItem, Popover } from "@/app/controls";
import { imageUrl } from "@/lib/image-url";
import { movieId } from "@/lib/routes";
import { ReleaseSearchModal } from "@/app/release-search";
import { useLingering } from "@/app/modal";
import { stagger } from "@/app/stagger";
import type { WishlistEntry } from "@/lib/wishlist";

/**
 * How long the results take to arrive and to leave. Kept in one place because
 * the CSS has to finish before the JS drops the results from the tree, and the
 * two drifting apart is what makes a panel vanish mid-fade.
 */
const MOTION_MS = 180;

/**
 * The one list in this app about films that are not on the drive.
 *
 * Its job is to stop being a want list, film by film, so an entry the library
 * has already matched is not quietly dropped — it stays, marked as got, until
 * you take it off yourself. That is the moment the list exists to show you.
 */

function Poster({ path, alt }: { path?: string; alt: string }) {
  return path ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl(path, "w92")}
      alt={alt}
      loading="lazy"
      className="h-[72px] w-12 shrink-0 rounded-chip object-cover ring-1 ring-line"
    />
  ) : (
    <span className="h-[72px] w-12 shrink-0 rounded-chip bg-surface-strong" />
  );
}

const GROUPINGS = [
  { key: "added", label: "None" },
  { key: "collection", label: "Collection" },
  { key: "year", label: "Year" },
];

/** How long a pause in typing counts as "done typing". */
const DEBOUNCE_MS = 300;

/** How many paces the ladder in globals.css defines before it repeats. */
const WISH_STEPS = 6;

/**
 * The classes a wanted film answers to while the list itself is changing —
 * a film added or removed — and only then.
 *
 * Keyed by transition type so the tiles are snapshotted for exactly those
 * gestures: the leaver plays the exit, a newcomer plays the entrance, and
 * the rest carry their snapshots to their new places (see the .wish-* rules
 * in globals.css). Every other transition — navigation, a scan's refresh —
 * sees `none` and pays nothing for these names existing.
 *
 * The move pace is picked by place, the same ladder the collections fan
 * runs: on one clock the grid slides as a single sheet, laddered it closes
 * ranks — or parts them — tile by tile.
 */
const wishMotion = (index: number) => ({
  default: "none" as const,
  enter: { "wish-add": "wish-enter", default: "none" },
  exit: { "wish-remove": "wish-exit", default: "none" },
  update: {
    "wish-remove": `wish-move-${index % WISH_STEPS}`,
    // An add's own ladder rather than the remove's: an add always happens
    // behind the open search's veil, and the overlay draws every travelling
    // poster above that veil where its frost cannot reach — so these
    // snapshots are drawn already muted, as if underneath it.
    "wish-add": `wish-part-${index % WISH_STEPS}`,
    default: "none",
  },
});

/**
 * The search panel while a film is being added from it.
 *
 * Named so it is captured as a group of its own and told to stay put. Left
 * unnamed it rides the page's own crossfade with the travelling posters
 * drawn over it, which read as the search blinking shut and open again. Its
 * group is also raised above every poster's in the stylesheet — capture
 * order is not guaranteed to put it on top, and an entering poster flashing
 * over the bar is exactly the fight this exists to end. The add is meant to
 * happen behind the search, not instead of it.
 */
const WISH_STILL = {
  default: "none" as const,
  update: { "wish-add": "wish-still", default: "none" },
};

/** A wanted film as a poster, with the same remove affordance as the row. */
function Tile({
  entry,
  onRemove,
  onFind,
  busy,
  index,
}: {
  entry: WishlistEntry;
  onRemove: () => void;
  onFind: () => void;
  busy: boolean;
  index: number;
}) {
  return (
    <ViewTransition name={`wish-${entry.tmdbId}`} {...wishMotion(index)}>
      <div
        style={stagger(index)}
        className="row-enter group relative flex flex-col gap-2"
      >
        {/* The poster is the trigger — a grid of films you want is a grid of
            things to go and find, so there is nothing else the tile would do.
            A div with a button role because it holds a link and a button of its
            own; nesting those inside a <button> is invalid. */}
        <div
          role="button"
          tabIndex={0}
          onClick={onFind}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onFind();
            }
          }}
          aria-label={`Find releases for ${entry.title}`}
          className="glow glow-over tilt relative aspect-[2/3] cursor-pointer overflow-hidden rounded-card bg-surface-strong ring-1 ring-line"
        >
          {entry.posterPath && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl(entry.posterPath, "w342")}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}

          {entry.owned && (
            <Link
              href={`/film/${movieId(entry.owned.path)}`}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-x-2 bottom-2 rounded-chip bg-background/85 px-1.5 text-center text-[10px] leading-[18px] font-medium text-emerald-600 backdrop-blur dark:text-emerald-400"
            >
              In the library
            </Link>
          )}

          {/* Only on hover: a grid of posters should read as posters until you
              reach for one. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            disabled={busy}
            aria-label={`Remove ${entry.title}`}
            title="Remove from wishlist"
            className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-background/85 opacity-0 backdrop-blur transition-opacity hover:text-red-700 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30 dark:hover:text-red-300"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-3 w-3"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
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
  canSearch,
  jackettReady,
}: {
  entries: WishlistEntry[];
  canSearch: boolean;
  jackettReady: boolean;
}) {
  const [group, setGroup] = useState("added");
  // Which entry has its release search open. Held here rather than in the row
  // because the dialog belongs to the page, not to the tile that opened it —
  // and clicking a second tile should swap the film rather than stack another.
  const [finding, setFinding] = useState<WishlistEntry | null>(null);
  const shown = useLingering(finding);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const searchBox = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const router = useRouter();

  /**
   * Mounted closed, then opened on the next frame — set both in one commit and
   * the browser paints the open state directly, with nothing to transition
   * from.
   */
  function showResults(results: SearchHit[]) {
    window.clearTimeout(closeTimer.current);
    setHits(results);
    requestAnimationFrame(() => setOpen(true));
  }

  /** Fades out first; the results are dropped once it is off screen. */
  function closeResults() {
    setOpen(false);
    closeTimer.current = window.setTimeout(() => setHits(null), MOTION_MS);
  }

  // Dismissing the results has to work without picking one, so: anywhere else
  // on the page, or Escape.
  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      if (!searchBox.current?.contains(e.target as Node)) closeResults();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeResults();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const listed = new Set(entries.map((e) => e.tmdbId));
  const owned = entries.filter((e) => e.owned).length;

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
    if (group === "collection") {
      // Only where a set is more than one film: a heading over a single
      // poster fragments the page without telling you anything the poster
      // did not.
      const bySet = new Map<string, WishlistEntry[]>();
      const loose: WishlistEntry[] = [];

      for (const entry of entries) {
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

    if (group === "year") {
      const byYear = new Map<string, WishlistEntry[]>();
      for (const entry of entries) {
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

    return [{ name: undefined, entries: newest(entries) }];
  })();

  function search() {
    setError(null);
    startTransition(async () => {
      try {
        showResults(await searchTmdb(query));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  /**
   * Typing is the request — the search runs itself once the typing pauses.
   * The timer lives in a ref so Enter can cut the wait rather than double it.
   */
  const debounce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!canSearch) return;
    const term = query.trim();
    debounce.current = window.setTimeout(() => {
      if (term) search();
      else closeResults();
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, canSearch]);

  /**
   * Both changes to the list run as typed transitions: the type is what the
   * tiles' entrance, exit and reflow classes are keyed on, so the newcomer
   * arrives, the leaver animates out, and the rest travel to their new
   * places — on these gestures and no other.
   */
  const add = (hit: SearchHit) =>
    startTransition(async () => {
      addTransitionType("wish-add");
      await addWish(hit);
      router.refresh();
    });

  const remove = (tmdbId: number) =>
    startTransition(async () => {
      addTransitionType("wish-remove");
      await removeWish(tmdbId);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        {/* Everything else recedes while the results are up — including the
            rail, so the effect reads as deliberate rather than as one panel
            that happened to miss it. Dismissal is the same outside-click that
            handles the rest of the page, so this needs no handler of its own. */}
        {/* Deliberately not extracted into the add's view transition: every
            attempt flickered — a snapshot renders in isolation where
            backdrop-blur has nothing to blur, and group-level frost is at the
            browser's mercy. Left in the page capture its frost is baked and
            it cannot waver; the posters flying above it are muted to look as
            though they are underneath (see the .wish-part rules). */}
        {hits && (
          <div
            aria-hidden
            className={`fixed inset-0 z-40 bg-background/40 backdrop-blur-sm motion-safe:transition-opacity ${
              open ? "opacity-100" : "opacity-0"
            }`}
            style={{ transitionDuration: `${MOTION_MS}ms` }}
          />
        )}

        {/* The results hang over the list rather than pushing it down the page,
            so adding several in a row never moves what you are looking at.

            Held out of the add animation by name: the panel and the veil paint
            above the tiles, so they are captured above them — and told to stay
            put, they sit unmoved over the shuffle instead of blinking away
            while the posters fly. Adding is meant to happen *behind* the
            search, not instead of it. */}
        <ViewTransition name="wish-search" {...WISH_STILL}>
          <div ref={searchBox} className="relative z-50">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                // Enter searches now rather than after the pause the debounce
                // is still waiting out.
                window.clearTimeout(debounce.current);
                if (query.trim()) search();
              }}
            >
              {/* The same bar the library is narrowed with: one frame, its parts
                  ruled apart. A page that searches in a different-looking field
                  reads as a different app. Typing searches by itself, so the bar
                  carries no Search button — the field is the whole request. */}
              <Bar>
                <BarSearch
                  value={query}
                  onChange={setQuery}
                  placeholder="Search TMDb for a film to add…"
                  disabled={!canSearch}
                />

                {/* On the same line as the search rather than over the list:
                    they are controls, and the list below has no header of its
                    own to hang controls from. */}
                {entries.length > 0 && (
                  <Popover
                    icon={ICONS.group}
                    label="Group by"
                    value={
                      (GROUPINGS.find((o) => o.key === group) ?? GROUPINGS[0])
                        .label
                    }
                    // The bar's last slot, so the fill follows its rounded end.
                    buttonClassName="rounded-r-full"
                  >
                    {(close) => (
                      <div className="py-1">
                        {GROUPINGS.map((option) => (
                          <MenuItem
                            key={option.key}
                            active={option.key === group}
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
                )}
              </Bar>
            </form>

            {hits && (
              <div
                className={`absolute inset-x-0 top-full z-20 mt-2 origin-top overflow-hidden rounded-card border border-line bg-background shadow-2xl motion-safe:transition motion-safe:ease-out ${
                  open
                    ? "translate-y-0 scale-100 opacity-100"
                    : "-translate-y-1 scale-[0.98] opacity-0"
                }`}
                style={{ transitionDuration: `${MOTION_MS}ms` }}
              >
                {hits.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm opacity-50">
                    No results for that search.
                  </p>
                ) : (
                  <ul className="max-h-[26rem] divide-y divide-line overflow-y-auto">
                    {hits.map((hit) => (
                      <li
                        key={hit.id}
                        className="row-enter flex items-center gap-4 px-4 py-3"
                      >
                        <Poster path={hit.posterPath} alt="" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {hit.title}
                            {hit.year && (
                              <span className="ml-1.5 font-normal opacity-40">
                                {hit.year}
                              </span>
                            )}
                          </p>
                          {hit.overview && (
                            <p className="mt-0.5 line-clamp-2 text-xs opacity-50">
                              {hit.overview}
                            </p>
                          )}
                        </div>
                        {/* A circle with a mark rather than a worded button:
                            the row repeats down the panel, and at that count a
                            shape is recognised faster than a label is re-read.
                            The tick is not a control — it only reports that
                            there is nothing left to add: the film is on the
                            list, or already on the drive and so not missing. */}
                        <button
                          type="button"
                          onClick={() => add(hit)}
                          disabled={
                            pending || listed.has(hit.id) || hit.inLibrary
                          }
                          aria-label={
                            hit.inLibrary
                              ? `${hit.title} is already in the library`
                              : listed.has(hit.id)
                                ? `${hit.title} is on the list`
                                : `Add ${hit.title} to the wishlist`
                          }
                          title={
                            hit.inLibrary
                              ? "Already in the library"
                              : listed.has(hit.id)
                                ? "On the list"
                                : "Add to wishlist"
                          }
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line transition-colors hover:border-line-strong hover:bg-surface-strong disabled:cursor-default disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-transparent"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3.5 w-3.5"
                          >
                            {hit.inLibrary || listed.has(hit.id) ? (
                              <path d="m4 12.5 5 5 11-11" />
                            ) : (
                              <path d="M12 5v14M5 12h14" />
                            )}
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </ViewTransition>

        {!canSearch && (
          <p className="text-sm opacity-50">
            Searching needs TMDb — connect it in Settings. Anything already on
            the list below still works without it.
          </p>
        )}

        {error && (
          <p className="font-mono text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </section>

      {entries.length === 0 ? (
        <div className="rounded-card border border-line bg-surface px-4 py-12 text-center">
          <p className="text-sm opacity-50">
            Nothing on the list yet. Search above to add the films you are
            hunting for.
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
                      key={entry.tmdbId}
                      entry={entry}
                      index={n}
                      busy={pending}
                      onFind={() => setFinding(entry)}
                      onRemove={() => remove(entry.tmdbId)}
                    />
                  ))}
                </div>
              </section>
            </Fragment>
          ))}

          <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-4 text-xs opacity-45">
            <p>
              {entries.length} {entries.length === 1 ? "film" : "films"}
            </p>
            {owned > 0 && <p>{owned} now in the library</p>}
          </div>
        </>
      )}

      {/* One dialog for the page, whichever tile or row opened it. A wanted
          film has no copy to improve on, so this is the acquire case: the same
          search, only without a score to beat. */}
      {shown && (
        <ReleaseSearchModal
          open={finding !== null}
          subject={{ kind: "tmdb", tmdbId: shown.tmdbId }}
          title={shown.title}
          subtitle={shown.year ? String(shown.year) : undefined}
          configured={jackettReady}
          onClose={() => setFinding(null)}
        />
      )}
    </div>
  );
}
