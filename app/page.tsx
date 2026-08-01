import Link from "next/link";

import { getLibraryRoot, scanStatus } from "./actions";
import { FolderSection } from "./folder-section";
import { LibraryView } from "./library-view";
import { ScanButton } from "./scan-button";
import { DEFAULT_ROOT } from "@/lib/browse";
import { duplicateGroups, getLibrary } from "@/lib/library";
import { movieId } from "@/lib/routes";

// Every render reads the local database, so there is nothing worth prerendering.
export const dynamic = "force-dynamic";

export default async function Page() {
  const root = await getLibraryRoot();
  const scan = await scanStatus();
  const movies = getLibrary();
  const duplicates = duplicateGroups(movies);

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 border-b border-black/10 bg-background/80 backdrop-blur dark:border-white/10">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4 sm:px-8">
          <h1 className="text-lg font-semibold tracking-tight">RipGrade</h1>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/how-it-works"
              className="rounded-lg border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              How it works
            </Link>
            {root && <ScanButton initialState={scan} />}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 sm:px-8">
        {movies.length > 0 && <LibraryView movies={movies} />}

        {duplicates.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-[11px] font-medium uppercase tracking-widest opacity-45">
              Duplicates
            </h2>
            {duplicates.map((group) => (
              <div
                key={group[0].path}
                className="rounded-xl border border-black/10 px-4 py-3 dark:border-white/10"
              >
                <p className="font-medium">
                  {group[0].title}
                  {group[0].year && (
                    <span className="ml-1.5 font-normal opacity-40">
                      {group[0].year}
                    </span>
                  )}
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {group.map((m, i) => (
                    <li
                      key={m.path}
                      className="flex items-center gap-2.5 text-sm"
                    >
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          i === 0
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "bg-red-500/10 text-red-700 dark:text-red-300"
                        }`}
                      >
                        {i === 0 ? "keep" : "drop"}
                      </span>
                      <Link
                        href={`/movie/${movieId(m.path)}`}
                        className="min-w-0 flex-1 truncate opacity-70 hover:opacity-100"
                      >
                        {m.resolution} {m.releaseType} · {m.fileName}
                      </Link>
                      <span className="shrink-0 tabular-nums opacity-50">
                        {m.scores.overall}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        <FolderSection
          initialPath={root ?? DEFAULT_ROOT}
          hasRoot={Boolean(root)}
        />
      </main>
    </div>
  );
}
