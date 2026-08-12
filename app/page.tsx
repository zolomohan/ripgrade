import Link from "next/link";

import { DashboardView } from "./dashboard-view";
import { EmptyState } from "./empty-state";
import { getDashboard } from "@/lib/dashboard";
import { getLibraryRoots } from "@/lib/roots";

// Every render reads the local database and stats the drive, so there is
// nothing worth prerendering.
export const dynamic = "force-dynamic";

export const metadata = { title: "RipGrade" };

export default async function Page() {
  const roots = getLibraryRoots();
  const data = await getDashboard();

  // Nothing scanned means every figure below would be a zero, and a page of
  // zeroes is not a report on an empty library — it is a report on a library
  // the app has not looked at yet, which is a different thing and has a
  // different answer.
  const empty =
    data.now.lastScanAt === undefined &&
    data.headline.films === 0 &&
    data.headline.shows === 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-6 py-8 sm:px-8">
      {empty ? (
        <EmptyState
          icon={
            <>
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
              <path d="M8 13h8" />
            </>
          }
          title={roots.length > 0 ? "Nothing scanned yet" : "No library folder"}
          action={
            <Link
              href="/settings"
              className="rounded-full bg-foreground px-4 py-2 text-sm text-background transition-opacity hover:opacity-90"
            >
              {roots.length > 0 ? "Manage folders" : "Choose a folder"}
            </Link>
          }
        >
          {roots.length > 0
            ? "The scan runs when the app starts, or on demand from Settings. Once it has read the drive, this page reports what needs doing."
            : "Point RipGrade at the folder your films live in and it will read every file, score it, and say what is worth replacing."}
        </EmptyState>
      ) : (
        <DashboardView data={data} />
      )}
    </main>
  );
}
