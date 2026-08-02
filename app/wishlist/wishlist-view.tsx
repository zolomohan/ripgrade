"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  addWish,
  removeWish,
  searchTmdb,
  type SearchHit,
} from "@/app/actions";
import { imageUrl } from "@/lib/image-url";
import { movieId } from "@/lib/routes";
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
  busy,
}: {
  entry: WishlistEntry;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <li className="row-enter flex items-start gap-4 px-4 py-3">
      <Poster path={entry.posterPath} alt="" />

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {entry.title}
          {entry.year && (
            <span className="ml-1.5 font-normal opacity-40">{entry.year}</span>
          )}
        </p>

        {entry.owned ? (
          <p className="mt-1 text-xs">
            <Link
              href={`/movie/${movieId(entry.owned.path)}`}
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
        onClick={onRemove}
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
  );
}

export function WishlistView({
  entries,
  canSearch,
}: {
  entries: WishlistEntry[];
  canSearch: boolean;
}) {
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
            className="flex gap-2"
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search TMDb for a film to add…"
              disabled={!canSearch}
              className="flex-1 rounded-control border border-line bg-transparent px-3 py-2.5 text-sm outline-none focus:border-line-strong disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={pending || !canSearch || !query.trim()}
              className="rounded-control bg-foreground px-4 py-2.5 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {pending ? "…" : "Search"}
            </button>
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
            Searching needs a TMDb key — set TMDB_API_KEY and restart. Anything
            already on the list below still works without one.
          </p>
        )}

        {error && (
          <p className="font-mono text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[11px] font-medium tracking-widest uppercase opacity-45">
            Wishlist
          </h2>
          {entries.length > 0 && (
            <p className="text-xs opacity-45">
              {entries.length} {entries.length === 1 ? "film" : "films"}
              {owned > 0 && ` · ${owned} now in the library`}
            </p>
          )}
        </div>

        {entries.length === 0 ? (
          <div className="rounded-card border border-line bg-surface px-4 py-12 text-center">
            <p className="text-sm opacity-50">
              Nothing on the list yet. Search above to add the films you are
              hunting for.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {entries.map((entry) => (
              <Entry
                key={entry.tmdbId}
                entry={entry}
                busy={pending}
                onRemove={() => run(() => removeWish(entry.tmdbId))}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
