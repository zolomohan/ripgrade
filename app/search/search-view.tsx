"use client";

import { useState, useTransition } from "react";

import { searchTorrents, type UpgradeResponse } from "@/app/actions";
import { NotConfigured, Result, SORTS, type Sort } from "@/app/release-search";
import { stagger } from "@/app/stagger";

/**
 * A search that starts from a line of text rather than from the library.
 *
 * Everywhere else in this app the question is already known — this film, that
 * season, the one on the wishlist — and the results are scored against a copy
 * you hold or a disc that exists. Here there is neither, so a release carries
 * only what its own name implies: the resolution, the source, the codec, the
 * audio it claims. That is enough to tell a remux from a scrape, which is what
 * this is for.
 *
 * The rows are the same ones the upgrade dialog uses. A release read one way on
 * one screen and another way on the next would be two rubrics wearing the same
 * clothes.
 */
export function SearchView({ configured }: { configured: boolean }) {
  const [term, setTerm] = useState("");
  const [response, setResponse] = useState<UpgradeResponse | null>(null);
  const [sort, setSort] = useState<Sort>("score");
  const [pending, startTransition] = useTransition();

  function run() {
    const query = term.trim();
    if (!query) return;
    startTransition(async () => setResponse(await searchTorrents(query)));
  }

  const search = response?.ok ? response.search : undefined;
  // Sorted before the cut, so "Most seeders" reaches past the fifty best-scored
  // rather than merely rearranging them.
  const results = search ? [...search.results].sort(SORTS[sort]) : [];
  const showing = results.slice(0, 50);

  if (!configured) return <NotConfigured />;

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
        className="flex gap-2"
      >
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Anything — a film, a box set, a series, a name…"
          aria-label="Search every indexer"
          autoFocus
          className="flex-1 rounded-control border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-line-strong"
        />
        <button
          type="submit"
          disabled={pending || !term.trim()}
          className="rounded-control bg-foreground px-4 py-2 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Searching…" : "Search"}
        </button>
      </form>

      {/* The sort only means something once there is something to sort. */}
      {search && !pending && (
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-xs opacity-45">
            {search.results.length} result
            {search.results.length === 1 ? "" : "s"} for “{search.query}” ·
            scored on the name alone
          </p>

          <div className="flex items-center gap-3">
            {results.length > showing.length && (
              <span className="text-[11px] opacity-40">
                top {showing.length} of {results.length}
              </span>
            )}
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              aria-label="Sort results"
              className="cursor-pointer rounded-control border border-line bg-transparent px-2.5 py-1 text-xs outline-none focus:border-line-strong"
            >
              <option value="score">Best score</option>
              <option value="seeders">Most seeders</option>
            </select>
          </div>
        </div>
      )}

      {pending && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton h-14 w-full" />
          ))}
        </div>
      )}

      {!pending && response && !response.ok && (
        <p className="rounded-card border border-line bg-surface px-5 py-10 text-center text-sm text-red-600 dark:text-red-400">
          {response.error}
        </p>
      )}

      {!pending && !response && (
        <p className="rounded-card border border-line bg-surface px-5 py-12 text-center text-sm opacity-50">
          Every indexer Jackett knows, searched by keyword. Nothing here is
          measured against your library — it is read off the release name.
        </p>
      )}

      {!pending && search && (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {showing.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
              <p className="text-sm opacity-55">
                Nothing came back for “{search.query}”.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {showing.map((release, i) => (
                <li
                  key={`${release.title}-${release.infoHash ?? release.indexer}`}
                  style={stagger(i)}
                  className="row-enter"
                >
                  <Result release={release} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
