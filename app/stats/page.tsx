import { enteredDiscIds } from "@/lib/disc";
import { getMovies } from "@/lib/library";
import { getShows } from "@/lib/shows";
import { computeShowStats, computeStats } from "@/lib/stats";
import { EmptyState } from "@/app/empty-state";
import { StatsView } from "./stats-view";

export const metadata = { title: "Stats — RipGrade" };

// Recomputed per request from the derived rows; there is nothing to cache.
export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const stats = computeStats(getMovies(), enteredDiscIds());
  const shows = computeShowStats(getShows());

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 sm:px-8">
      {stats.totals.films === 0 && shows.totals.shows === 0 ? (
        // The app's own empty state rather than a bordered box holding one grey
        // sentence — see app/empty-state.tsx. Bars, because that is what this
        // page is when it has something to draw.
        <EmptyState
          icon={<path d="M5 20v-8M12 20V4M19 20v-5" />}
          title="Nothing to count yet"
        >
          The census is drawn from what a scan finds. Run one and the numbers
          appear here.
        </EmptyState>
      ) : (
        <StatsView stats={stats} shows={shows} />
      )}
    </main>
  );
}
