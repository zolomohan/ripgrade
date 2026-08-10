import { getJobRuns } from "@/lib/job-history";
import { filmsByPath } from "@/lib/queue-tasks";
import { JobsView } from "./jobs-view";

export const metadata = { title: "Jobs — RipGrade" };

// The log is read on every request, like the library itself: a job that ended
// while this page was open has already written its row.
export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const runs = getJobRuns();

  // Resolved here rather than stored on the row: a poster that was not on disk
  // when the job ran is on disk now, and a log that kept its own copy of the
  // artwork would still be showing the gap.
  const films = filmsByPath(
    runs.map((run) => run.path).filter((path): path is string => Boolean(path)),
  );

  return (
    // min-h-dvh so an empty state can centre itself; see the upgrades page.
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-6 py-8 sm:px-8">
      <JobsView
        runs={runs.map((run) => ({
          ...run,
          film: run.path ? films.get(run.path) : undefined,
        }))}
      />
    </main>
  );
}
