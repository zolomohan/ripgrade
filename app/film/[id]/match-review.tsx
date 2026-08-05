"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  confirmMatch,
  confirmShowMatch,
  searchTmdb,
  searchTmdbShows,
  type SearchHit,
} from "@/app/actions";
import { Bar, BarSearch } from "@/app/controls";
import { Modal } from "@/app/modal";
import { stagger } from "@/app/stagger";
import { imageUrl } from "@/lib/image-url";

/** A film, identified by its file, or a show, identified by its key. */
type Subject =
  | { moviePath: string; showKey?: never }
  | { showKey: string; moviePath?: never };

/** How long a pause in typing counts as "done typing". */
const DEBOUNCE_MS = 300;

export function MatchReview({
  moviePath,
  showKey,
  currentId,
  needsReview,
  defaultQuery,
}: Subject & {
  /** Absent when nothing matched. */
  currentId?: number;
  needsReview: boolean;
  defaultQuery: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(defaultQuery);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  /** The last term actually sent — the debounce never repeats it, and the
      empty state names it. */
  const [searched, setSearched] = useState<string | null>(null);

  function search(term = query) {
    setSearched(term.trim());
    setError(null);
    startTransition(async () => {
      setHits(await (showKey ? searchTmdbShows(term) : searchTmdb(term)));
    });
  }

  /* Opening is itself the request: the title is already known, so making you
     press Search to see the obvious candidates is a click that asks nothing. */
  function begin() {
    setOpen(true);
    setError(null);
    if (!hits) search();
  }

  /* Typing is the request too — the search runs itself once the typing
     pauses, exactly as the wishlist's does. */
  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (!term || term === searched) return;
    const timer = window.setTimeout(() => search(term), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, searched]);

  function choose(tmdbId: number) {
    setError(null);
    startTransition(async () => {
      const result = showKey
        ? await confirmShowMatch(showKey, tmdbId)
        : await confirmMatch(moviePath!, tmdbId);
      if (result.ok) {
        setOpen(false);
        setHits(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const subject = showKey ? "show" : "film";

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        {/* Underlined words rather than boxed buttons: these are quiet,
            occasional corrections, and a frame gave them the weight of a
            primary action they do not have. Confirming keeps its emphasis by
            weight alone. */}
        {needsReview && currentId !== undefined && (
          <button
            type="button"
            onClick={() => choose(currentId)}
            disabled={pending}
            className="text-sm font-medium underline underline-offset-4 transition-opacity hover:opacity-70 disabled:opacity-30"
          >
            This is correct
          </button>
        )}
        <button
          type="button"
          onClick={begin}
          disabled={pending}
          className="text-sm underline underline-offset-4 opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
        >
          {currentId === undefined
            ? "Find on TMDb"
            : showKey
              ? "Wrong show?"
              : "Wrong film?"}
        </button>
        {pending && !open && (
          <span className="text-xs opacity-50">working…</span>
        )}
      </div>

      {needsReview && currentId !== undefined && (
        <p className="mt-2 text-xs opacity-50">
          Confirming locks this match in — later matching runs will leave it
          alone{showKey ? "" : ", and the runtime check starts applying"}.
        </p>
      )}

      {/* The error belongs beside the button when the dialog is shut — a
          failed confirmation happens without one ever being opened. */}
      {error && !open && (
        <p className="mt-2 font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* A fixed height, like every other dialog here: the list is as long as
          TMDb decides it is, and a box that resizes with each search is one you
          have to find the close button in again every time.

          Candidates as a grid of posters rather than rows of text: telling two
          films of the same name apart is done by artwork first, and a poster
          large enough to recognise answers faster than a synopsis. */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!pending}
        label={`Find this ${subject} on TMDb`}
        panelClassName="flex h-[min(85vh,46rem)] w-full max-w-3xl flex-col overflow-hidden rounded-card border border-line bg-background shadow-2xl"
      >
        <>
          <header className="flex shrink-0 items-start gap-4 px-5 pt-5 pb-4">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold tracking-tight">
                {currentId === undefined
                  ? `Identify this ${subject}`
                  : `Wrong ${subject}?`}
              </h2>
              <p className="mt-0.5 text-xs opacity-45">
                Pick the right one — the match is kept by hand, and later scans
                will not overwrite it.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line opacity-50 transition-opacity hover:opacity-100"
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
          </header>

          {/* The same bar every other search in the app runs in — typing
              searches by itself, Enter merely skips the pause. */}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (query.trim()) search();
            }}
            className="shrink-0 px-5 pb-4"
          >
            <Bar>
              <BarSearch
                value={query}
                onChange={setQuery}
                placeholder={`Search TMDb for a ${subject}…`}
              />
            </Bar>
          </form>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {error && (
              <p className="pb-3 font-mono text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            {!hits && pending && (
              <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <div className="skeleton aspect-[2/3] w-full" />
                    <div className="skeleton h-3.5 w-3/4" />
                  </div>
                ))}
              </div>
            )}

            {hits?.length === 0 && (
              <p className="py-10 text-center text-sm opacity-55">
                Nothing on TMDb for “{searched}”.
              </p>
            )}

            {hits && hits.length > 0 && (
              <ul
                className={`grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 ${
                  pending ? "opacity-50" : ""
                }`}
              >
                {hits.map((hit, i) => {
                  const current = hit.id === currentId;
                  return (
                    <li key={hit.id} style={stagger(i)} className="row-enter">
                      <button
                        type="button"
                        onClick={() => choose(hit.id)}
                        disabled={pending}
                        title={hit.overview}
                        className="group flex w-full flex-col gap-2 text-left disabled:opacity-40"
                      >
                        <span
                          className={`glow glow-over tilt relative block aspect-[2/3] w-full overflow-hidden rounded-card bg-surface-strong ${
                            current
                              ? "ring-2 ring-foreground/70"
                              : "ring-1 ring-line"
                          }`}
                        >
                          {hit.posterPath && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={imageUrl(hit.posterPath, "w342")}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          )}
                          {current && (
                            <span className="absolute inset-x-2 bottom-2 rounded-chip bg-background/85 px-1.5 text-center text-[10px] leading-[18px] font-medium backdrop-blur">
                              Current match
                            </span>
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {hit.title}
                          </span>
                          {hit.year && (
                            <span className="block text-[11px] opacity-45">
                              {hit.year}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      </Modal>
    </div>
  );
}
