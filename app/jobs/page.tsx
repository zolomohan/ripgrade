import { getStripJob } from "@/lib/audio-strip";
import { getConvertJob, keepsEnhancementLayer } from "@/lib/convert";
import { getDoviJob } from "@/lib/dovi";
import { getJobRuns } from "@/lib/job-history";
import { getLibrary } from "@/lib/library";
import { cleanupFiles, filmsByPath, libraryTasks } from "@/lib/queue-tasks";
import { JobsView } from "./jobs-view";

export const metadata = { title: "Jobs — RipGrade" };

// The log is read on every request, like the library itself: a job that ended
// while this page was open has already written its row.
export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const runs = getJobRuns();

  /*
   * The library, read once and handed to everything below it: the three lists
   * of outstanding work are three questions about the same four hundred films,
   * and the posters on the log are a fourth.
   */
  const library = getLibrary();

  /*
   * What is still to do, on every request rather than only for the tab being
   * shown — the whole page is one request, and a tab that had to fetch its own
   * list would be a tab that arrives empty and fills in.
   *
   * These came from the queue, which is where they were reachable from until
   * the work and the record of the work were put on one page. Neither list
   * touches anything but the database and a stat per candidate; the cleanup
   * scan is one directory read per folder the library lives in.
   */
  const { dovi, audio } = libraryTasks(library);
  const cleanup = cleanupFiles(library);

  /**
   * The film each of the three film-shaped jobs is working on, asked of the
   * server because the job stream carries a path and not a poster.
   *
   * Read here rather than sent down the stream for the reason the log's are
   * resolved here: the artwork is the library's to answer, it changes without
   * the job changing, and a snapshot pushed to every open tab several times a
   * second is the last place to put a picture. The page re-renders when a job
   * starts, which is when this answer changes — see `JobsView`.
   */
  const running = [getConvertJob(), getDoviJob(), getStripJob()]
    .filter((job) => job.status === "running")
    .map((job) => job.path);

  // Resolved here rather than stored on the row: a poster that was not on disk
  // when the job ran is on disk now, and a log that kept its own copy of the
  // artwork would still be showing the gap.
  const films = filmsByPath(
    [...runs.map((run) => run.path), ...running].filter(
      (path): path is string => Boolean(path),
    ),
    library,
  );

  return (
    // min-h-dvh so an empty state can centre itself; see the upgrades page.
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-6 py-8 sm:px-8">
      <JobsView
        runs={runs.map((run) => ({
          ...run,
          film: run.path ? films.get(run.path) : undefined,
        }))}
        // A plain object rather than the Map itself: this crosses to a client
        // component, and the running rows only ever look one path up at a time.
        films={Object.fromEntries(films)}
        dovi={dovi}
        // Not a per-film fact and not something the list can change: it is here
        // so the confirmation says what the job will actually do.
        keepingEl={keepsEnhancementLayer()}
        audio={audio}
        cleanup={cleanup}
      />
    </main>
  );
}
