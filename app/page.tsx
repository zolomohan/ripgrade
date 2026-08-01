import Link from "next/link";

import { getLibraryRoot } from "./actions";
import { FolderSection } from "./folder-section";
import { LibraryView } from "./library-view";
import { ScanButton } from "./scan-button";
import { DEFAULT_ROOT } from "@/lib/browse";
import { getLibrary } from "@/lib/library";

// Every render reads the local database, so there is nothing worth prerendering.
export const dynamic = "force-dynamic";

export default async function Page() {
  const root = await getLibraryRoot();
  const movies = getLibrary();

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4 sm:px-8">
          <h1 className="font-display text-xl font-semibold tracking-tight">
            RipGrade
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/how-it-works"
              aria-label="How it works"
              title="How it works"
              className="grid h-8 w-8 place-items-center rounded-full border border-line text-sm opacity-55 transition-opacity hover:opacity-100"
            >
              ?
            </Link>
            {root && <ScanButton />}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 sm:px-8">
        {movies.length > 0 && <LibraryView movies={movies} />}

        <FolderSection
          initialPath={root ?? DEFAULT_ROOT}
          hasRoot={Boolean(root)}
        />
      </main>
    </div>
  );
}
