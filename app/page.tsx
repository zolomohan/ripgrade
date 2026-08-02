import { getLibraryRoot } from "./actions";
import { FolderSection } from "./folder-section";
import { LibraryView } from "./library-view";
import { DEFAULT_ROOT } from "@/lib/browse";
import { getLibrary } from "@/lib/library";

// Every render reads the local database, so there is nothing worth prerendering.
export const dynamic = "force-dynamic";

export default async function Page() {
  const root = await getLibraryRoot();
  const movies = getLibrary();

  return (
    <div className="flex flex-col">
      {/* The name, the navigation and the scan button all live in the rail
          now, so this page opens straight into the library itself. */}
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
