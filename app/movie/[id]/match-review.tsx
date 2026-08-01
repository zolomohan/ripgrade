"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { confirmMatch, searchTmdb, type SearchHit } from "@/app/actions";
import { imageUrl } from "@/lib/image-url";

export function MatchReview({
  moviePath,
  currentId,
  needsReview,
  defaultQuery,
}: {
  moviePath: string;
  /** Absent when nothing matched — the search then opens straight away. */
  currentId?: number;
  needsReview: boolean;
  defaultQuery: string;
}) {
  const [open, setOpen] = useState(currentId === undefined);
  const [query, setQuery] = useState(defaultQuery);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function search() {
    setError(null);
    startTransition(async () => {
      setHits(await searchTmdb(query));
    });
  }

  function choose(tmdbId: number) {
    setError(null);
    startTransition(async () => {
      const result = await confirmMatch(moviePath, tmdbId);
      if (result.ok) {
        setOpen(false);
        setHits(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="mt-4 border-t border-black/10 pt-4 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2">
        {needsReview && currentId !== undefined && (
          <button
            type="button"
            onClick={() => choose(currentId)}
            disabled={pending}
            className="rounded-lg bg-foreground px-3 py-1.5 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            This is correct
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          className="rounded-lg border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
        >
          {open ? "Cancel" : currentId === undefined ? "Find on TMDb" : "Wrong film?"}
        </button>
        {pending && <span className="text-xs opacity-50">working…</span>}
      </div>

      {needsReview && currentId !== undefined && !open && (
        <p className="mt-2 text-xs opacity-50">
          Confirming locks this match in — later matching runs will leave it
          alone, and the runtime check starts applying.
        </p>
      )}

      {open && (
        <div className="mt-3 flex flex-col gap-3">
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
              placeholder="Search TMDb…"
              className="flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/10 dark:focus:border-white/30"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg border border-black/10 px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
            >
              Search
            </button>
          </form>

          {hits?.length === 0 && (
            <p className="text-sm opacity-50">No results for that search.</p>
          )}

          {hits && hits.length > 0 && (
            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => choose(hit.id)}
                    disabled={pending}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5 ${
                      hit.id === currentId
                        ? "ring-1 ring-black/15 dark:ring-white/20"
                        : ""
                    }`}
                  >
                    {hit.posterPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl(hit.posterPath, "w92")}
                        alt=""
                        loading="lazy"
                        className="h-16 w-11 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span className="h-16 w-11 shrink-0 rounded bg-black/[0.06] dark:bg-white/[0.08]" />
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
      )}

      {error && (
        <p className="mt-2 font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
