import { enteredDiscIds } from "@/lib/disc";
import { getMovies } from "@/lib/library";
import { getShows } from "@/lib/shows";
import { computeShowStats, computeStats } from "@/lib/stats";
import { StatsView } from "./stats-view";

export const metadata = { title: "Stats — RipGrade" };

// Recomputed per request from the derived rows; there is nothing to cache.
export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const stats = computeStats(getMovies(), enteredDiscIds());
  const shows = computeShowStats(getShows());

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 sm:px-8">
      {stats.totals.films === 0 && shows.totals.shows === 0 ? (
        <p className="rounded-card border border-line bg-surface px-4 py-12 text-center text-sm opacity-50">
          Nothing scanned yet — run a scan and the numbers appear here.
        </p>
      ) : (
        <StatsView stats={stats} shows={shows} />
      )}
    </main>
  );
}
