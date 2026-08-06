import Link from "next/link";

import { getLibraryFolders } from "./actions";
import { getMovies } from "@/lib/library";
import { getShows } from "@/lib/shows";
import { LibraryTabs } from "./library-tabs";

// Every render reads the local database, so there is nothing worth prerendering.
export const dynamic = "force-dynamic";

export default async function Page() {
  const roots = await getLibraryFolders();
  const movies = getMovies();
  const shows = getShows();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 sm:px-8">
      {movies.length > 0 || shows.length > 0 ? (
        <LibraryTabs movies={movies} shows={shows} />
      ) : (
        // The folder picker lives in Settings, so an empty library has to say
        // where to go rather than simply being blank. Scanning happens on
        // start-up and is triggered from Settings, so this offers the one
        // thing that is not already under way: somewhere to point it.
        <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-4 py-12 text-center">
          <p className="text-sm opacity-60">
            {roots.length > 0
              ? "Nothing scanned yet — the scan runs when the app starts, or on demand from Settings."
              : "No library folder chosen yet."}
          </p>

          <Link
            href="/settings"
            className="text-sm underline underline-offset-4 opacity-60 hover:opacity-100"
          >
            {roots.length > 0
              ? "Manage folders in Settings"
              : "Choose one in Settings"}
          </Link>
        </div>
      )}
    </main>
  );
}
