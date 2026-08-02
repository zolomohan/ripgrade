import Link from "next/link";

import { getLibraryFolders } from "./actions";
import { LibraryView } from "./library-view";
import { getLibrary } from "@/lib/library";

// Every render reads the local database, so there is nothing worth prerendering.
export const dynamic = "force-dynamic";

export default async function Page() {
  const roots = await getLibraryFolders();
  const movies = getLibrary();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 sm:px-8">
      {movies.length > 0 ? (
        <LibraryView movies={movies} />
      ) : (
        // The folder picker lives in Settings now, so an empty library has to
        // say where to go rather than simply being blank.
        <div className="rounded-card border border-line bg-surface px-4 py-12 text-center">
          <p className="text-sm opacity-60">
            {roots.length > 0
              ? "Nothing scanned yet — run a scan from the sidebar."
              : "No library folder chosen yet."}
          </p>
          <Link
            href="/settings"
            className="mt-2 inline-block text-sm underline underline-offset-4 opacity-60 hover:opacity-100"
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
