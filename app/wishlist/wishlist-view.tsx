"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";

import { addWish, removeWish, searchTmdb, type SearchHit } from "@/app/actions";
import { Bar, BarSearch, BarSegments } from "@/app/controls";
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

function Entry({
  entry,
  onRemove,
  onFind,
  busy,
  index,
  ruled,
}: {
  entry: WishlistEntry;
  onRemove: () => void;
  onFind: () => void;
  busy: boolean;
  index: number;
  /** False on the first row, which has nothing above it to be parted from. */
  ruled?: boolean;
}) {
  return (
    <>
      {ruled && (
        <li
          aria-hidden
          className="h-px bg-gradient-to-r from-transparent via-line to-transparent"
        />
      )}

      {/* The row itself is the trigger, so there is no separate button to
          find. A <li> with a button role rather than a real one: it holds a
          remove button and a link of its own, and nesting those inside a
          <button> is invalid and unreachable by keyboard. */}
      <li
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
        style={stagger(index)}
        className="glow row-enter flex cursor-pointer items-start gap-4 rounded-card px-4 py-3 transition-colors hover:bg-surface-strong"
      >
        <Poster path={entry.posterPath} alt="" />

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {entry.title}
            {entry.year && (
              <span className="ml-1.5 font-normal opacity-40">
                {entry.year}
              </span>
            )}
          </p>

          {entry.owned ? (
            <p className="mt-1 text-xs">
              <Link
                href={`/movie/${movieId(entry.owned.path)}`}
                onClick={(e) => e.stopPropagation()}
                className="text-emerald-600 underline underline-offset-4 dark:text-emerald-400"
              >
                In the library
              </Link>
              <span className="opacity-50">
                {" "}
                — {entry.owned.resolution} · {entry.owned.status} ·{" "}
                {entry.owned.score}/100
              </span>
            </p>
          ) : (
            entry.overview && (
              <p className="mt-1 line-clamp-2 text-xs opacity-50">
                {entry.overview}
              </p>
            )
          )}
        </div>

        {/* `self-center` rather than inheriting the row's `items-start`: the text
          block has to begin level with the top of the poster, but a lone button
          sitting up there beside it just looks dropped. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          disabled={busy}
          aria-label={`Remove ${entry.title}`}
          title="Remove from wishlist"
          className="grid h-8 w-8 shrink-0 place-items-center self-center rounded-full border border-line opacity-40 transition-colors hover:border-red-500/40 hover:bg-red-500/[0.08] hover:text-red-700 hover:opacity-100 disabled:opacity-20 dark:hover:text-red-300"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-3.5 w-3.5"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </li>
    </>
  );
}

const VIEWS = [
  { key: "list", label: "List", path: "M4 6h16M4 12h16M4 18h16" },
  {
    key: "grid",
    label: "Grid",
    path: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  },
];

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
            href={`/movie/${movieId(entry.owned.path)}`}
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
  const [view, setView] = useState("grid");
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
   * Grouped by set, but only where a set is more than one film: a heading over
   * a single poster fragments the page without telling you anything the poster
   * did not. Sets come first, alphabetically; everything else falls into one
   * unheaded group at the end, in the order it was added.
   */
  const groups = (() => {
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
    // Newest first within the loose group, which is how the list read before.
    loose.sort((a, b) => b.addedAt - a.addedAt);

    return loose.length ? [...sets, { entries: loose }] : sets;
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

  const run = (action: () => Promise<void>) =>
    startTransition(async () => {
      await action();
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        {/* Everything else recedes while the results are up — including the
            rail, so the effect reads as deliberate rather than as one panel
            that happened to miss it. Dismissal is the same outside-click that
            handles the rest of the page, so this needs no handler of its own. */}
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
            so adding several in a row never moves what you are looking at. */}
        <div ref={searchBox} className="relative z-50">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            {/* The same bar the library is narrowed with: one frame, its parts
                ruled apart. A page that searches in a different-looking field
                reads as a different app. */}
            <Bar>
              <BarSearch
                value={query}
                onChange={setQuery}
                placeholder="Search TMDb for a film to add…"
                disabled={!canSearch}
              />

              <button
                type="submit"
                disabled={pending || !canSearch || !query.trim()}
                className="flex items-center self-stretch px-4 text-sm transition-colors hover:bg-surface-strong disabled:opacity-30"
              >
                {pending ? "…" : "Search"}
              </button>

              {/* On the same line as the search rather than over the list: it
                  is a control, and the list below it has no header of its own
                  to hang controls from. */}
              {entries.length > 0 && (
                <BarSegments
                  value={view}
                  onChange={(next: string) => setView(next)}
                  options={VIEWS}
                />
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
                      <button
                        type="button"
                        onClick={() => run(() => addWish(hit))}
                        disabled={pending || listed.has(hit.id)}
                        className="shrink-0 rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong disabled:opacity-40"
                      >
                        {listed.has(hit.id) ? "✓ On the list" : "Add"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

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
          {groups.map((group, i) => (
            <Fragment key={group.name ?? "loose"}>
              {/* Space alone between the groups: each already has a rule under
                  its own name, and a second one at its foot fenced the films
                  in rather than parting them from what follows. */}
              <section
                className={`flex flex-col gap-7 ${i > 0 ? "pt-14" : "pt-6"}`}
              >
                {group.name && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-4">
                      <h2 className="font-display text-lg font-semibold tracking-tight">
                        {group.name}
                      </h2>
                      <span className="shrink-0 text-xs opacity-45">
                        {group.entries.length} wanted
                      </span>
                    </div>
                    <div aria-hidden className="rule-head" />
                  </div>
                )}

                {view === "grid" ? (
                  <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
                    {group.entries.map((entry, n) => (
                      <Tile
                        key={entry.tmdbId}
                        entry={entry}
                        index={n}
                        busy={pending}
                        onFind={() => setFinding(entry)}
                        onRemove={() => run(() => removeWish(entry.tmdbId))}
                      />
                    ))}
                  </div>
                ) : null}

                {view !== "grid" ? (
                  <ul className="flex flex-col">
                    {group.entries.map((entry, n) => (
                      <Entry
                        key={entry.tmdbId}
                        entry={entry}
                        index={n}
                        ruled={n > 0}
                        busy={pending}
                        onFind={() => setFinding(entry)}
                        onRemove={() => run(() => removeWish(entry.tmdbId))}
                      />
                    ))}
                  </ul>
                ) : null}
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
