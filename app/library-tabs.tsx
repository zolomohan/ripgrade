"use client";

import { useSearchParams } from "next/navigation";

import type { LibraryItem } from "@/lib/library";
import type { Show } from "@/lib/shows";
import { Switch } from "./controls";
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
}: {
  movies: LibraryItem[];
  shows: Show[];
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

  const options = [
    { key: "movies" as const, label: "Films" },
    { key: "tv" as const, label: "Shows" },
  ];

  /**
   * The head of whichever shelf is showing, handed to it so the switch and the
   * shelf's own controls can share one line.
   *
   * It belongs to the page rather than to either shelf — it is how you leave
   * one for the other — but the controls beside it belong to the shelf, and a
   * row split across two components is a row that cannot be one line.
   */
  const tabs = (
    <Switch
      value={tab}
      onChange={(next) => select(next as "movies" | "tv")}
      options={options}
      className="-ml-2"
    />
  );

  return tab === "movies" ? (
    <LibraryView movies={movies} tabs={tabs} />
  ) : (
    <ShowsView shows={shows} tabs={tabs} />
  );
}
