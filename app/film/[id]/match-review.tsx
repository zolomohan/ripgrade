"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  confirmMatch,
  confirmShowMatch,
  searchTmdb,
  searchTmdbShows,
  type SearchHit,
} from "@/app/actions";
import { Modal } from "@/app/modal";
import { imageUrl } from "@/lib/image-url";

/** A film, identified by its file, or a show, identified by its key. */
type Subject =
  | { moviePath: string; showKey?: never }
  | { showKey: string; moviePath?: never };

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

  function search(term = query) {
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
      <div className="flex flex-wrap items-center gap-2">
        {needsReview && currentId !== undefined && (
          <button
            type="button"
            onClick={() => choose(currentId)}
            disabled={pending}
            className="rounded-control bg-foreground px-3 py-1.5 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            This is correct
          </button>
        )}
        <button
          type="button"
          onClick={begin}
          disabled={pending}
          className="rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong disabled:opacity-40"
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
          have to find the close button in again every time. */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!pending}
        label={`Find this ${subject} on TMDb`}
        panelClassName="flex h-[min(80vh,42rem)] w-full max-w-2xl flex-col overflow-hidden rounded-card border border-line bg-background shadow-2xl"
      >
        <>
          <header className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">
                {currentId === undefined
                  ? `Identify this ${subject}`
                  : `Wrong ${subject}?`}
              </h2>
              <p className="mt-1 text-sm opacity-60">
                Pick the right one and the match is kept by hand — later scans
                will not overwrite it.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 text-sm opacity-50 hover:opacity-100"
            >
              Close
            </button>
          </header>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              search();
            }}
            className="flex shrink-0 gap-2 px-6 pb-4"
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              // The title is usually right; the field is here for when it is
              // not, so it opens selected rather than empty.
              autoFocus
              onFocus={(event) => event.target.select()}
              placeholder="Search TMDb…"
              className="flex-1 rounded-control border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-line-strong"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-control border border-line px-3 py-2 text-sm hover:bg-surface-strong disabled:opacity-40"
            >
              Search
            </button>
          </form>

          <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-6 pb-6">
            {error && (
              <p className="font-mono text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            {!hits && pending && (
              <p className="text-sm opacity-50">Searching TMDb…</p>
            )}

            {hits?.length === 0 && (
              <p className="text-sm opacity-50">No results for that search.</p>
            )}

            {hits && hits.length > 0 && (
              <ul className="flex flex-col gap-1">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => choose(hit.id)}
                      disabled={pending}
                      className={`flex w-full items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-surface-strong disabled:opacity-40 ${
                        hit.id === currentId ? "ring-1 ring-line-strong" : ""
                      }`}
                    >
                      {hit.posterPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageUrl(hit.posterPath, "w92")}
                          alt=""
                          loading="lazy"
                          className="h-16 w-11 shrink-0 rounded-chip object-cover"
                        />
                      ) : (
                        <span className="h-16 w-11 shrink-0 rounded-chip bg-surface-strong" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {hit.title}
                          {hit.year && (
                            <span className="ml-1.5 font-normal opacity-40">
                              {hit.year}
                            </span>
                          )}
                        </span>
                        {hit.overview && (
                          <span className="mt-0.5 line-clamp-2 block text-xs opacity-50">
                            {hit.overview}
                          </span>
                        )}
                      </span>
                      {hit.id === currentId && (
                        <span className="shrink-0 text-[11px] opacity-50">
                          current
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      </Modal>
    </div>
  );
}
