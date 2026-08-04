"use client";

import { useSearchParams } from "next/navigation";

import type { LibraryItem } from "@/lib/library";
import type { Show } from "@/lib/shows";
import { Switch } from "./controls";
import { ScanButton } from "./scan-button";
import { LibraryView } from "./library-view";
import { ShowsView } from "./shows-view";

/**
 * Films and shows are the same library and different work: the filters, sorts
 * and groupings that make sense of a film shelf mean little against a show,
 * which is read season by season. One switch, two shelves.
 *
 * In the URL like every other library control, so opening a show and coming
 * back returns to the tab you were on.
 */
export function LibraryTabs({
  movies,
  shows,
  hasRoot,
}: {
  movies: LibraryItem[];
  shows: Show[];
  /** No folder chosen means nothing to scan, so no trigger. */
  hasRoot: boolean;
}) {
  const searchParams = useSearchParams();
  const tab = searchParams.get("t") === "tv" ? "tv" : "movies";

  function select(next: "movies" | "tv") {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "tv") params.set("t", "tv");
    else params.delete("t");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  const tabs = [
    { key: "movies" as const, label: "Movies" },
    { key: "tv" as const, label: "TV shows" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Scanning is what fills this shelf, so its trigger sits at the head of
          the shelf rather than in the rail beside every other page. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Switch
          value={tab}
          onChange={(next) => select(next as "movies" | "tv")}
          options={tabs}
        />

        {hasRoot && <ScanButton />}
      </div>

      {tab === "movies" ? (
        <LibraryView movies={movies} />
      ) : (
        <ShowsView shows={shows} />
      )}
    </div>
  );
}
