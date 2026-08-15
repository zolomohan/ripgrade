import Link from "next/link";

import { getLibraryFolders } from "@/app/actions";
import { hasJackett } from "@/lib/jackett";
import { getMovies } from "@/lib/library";
import { alreadyFetching } from "@/lib/qbittorrent";
import { getShows } from "@/lib/shows";
import { getUpgradeQueue } from "@/lib/upgrade-sweep";
import { LibraryTabs } from "@/app/library-tabs";
import { BUTTON } from "@/app/controls";
import { EmptyState } from "@/app/empty-state";

// Every render reads the local database, so there is nothing worth prerendering.
export const dynamic = "force-dynamic";

export const metadata = { title: "Library — RipGrade" };

export default async function Page() {
  const roots = await getLibraryFolders();
  const movies = getMovies();
  const shows = getShows();

  /*
   * What the sweep found for the films on this shelf.
   *
   * The read the queue page used to make, against the same list of films —
   * which is why that page has gone: everything on it was about a film already
   * on this shelf, and the shelf can say so on the film itself. A release
   * already in qBittorrent comes off, as it did there: it has stopped being an
   * upgrade to find and become one to watch arrive, on the downloads page.
   *
   * Two local reads: the sweep's own table, and the download log joined to
   * whatever the client says about it. Neither goes near an indexer.
   */
  const fetching = await alreadyFetching();
  const upgrades = getUpgradeQueue(movies).filter(
    (item) => !fetching({ title: item.title, magnet: item.hit.magnet }),
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 sm:px-8">
      {movies.length > 0 || shows.length > 0 ? (
        <LibraryTabs
          movies={movies}
          shows={shows}
          upgrades={upgrades}
          jackettReady={hasJackett()}
        />
      ) : (
        // The folder picker lives in Settings, so an empty library has to say
        // where to go rather than simply being blank. Scanning happens on
        // start-up and is triggered from Settings, so this offers the one
        // thing that is not already under way: somewhere to point it.
        //
        // The app's own empty state, like every other empty page here — a mark
        // that reads before the words do, and the way out as an action rather
        // than a link trailing a paragraph.
        <EmptyState
          icon={
            <>
              <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
            </>
          }
          title={
            roots.length > 0 ? "Nothing scanned yet" : "No library folder yet"
          }
          action={
            <Link href="/settings" className={BUTTON.secondary}>
              {roots.length > 0 ? "Manage folders" : "Choose a folder"}
            </Link>
          }
        >
          {roots.length > 0
            ? "The scan runs when the app starts, or on demand from Settings."
            : "Point the app at where the films are and a scan will read them."}
        </EmptyState>
      )}
    </main>
  );
}
