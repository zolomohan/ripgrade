"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useNow } from "@/app/clock";
import { jobRows, type JobRow } from "@/app/job-rows";
import { useJobs } from "@/app/jobs-provider";
import { ListingBar, useListing, type Choice } from "@/app/listing";
import { ProcessDetails, type ProcessDetail } from "@/app/process-details";
import { CollapsibleSection, SectionHeading } from "@/app/section-heading";
import { stagger } from "@/app/stagger";
import { visibleOutput } from "@/lib/job-output";
import type { JobKind, JobRun } from "@/lib/job-history";
import type {
  AudioTask,
  CleanupFile,
  DoviTask,
  TaskFilm,
} from "@/lib/queue-tasks";
import {
  CLEANUP_GROUPS,
  CLEANUP_SORTS,
  CleanAll,
  CleanupList,
  CleanupStats,
} from "./cleanup-list";
import { Poster } from "./poster";
import {
  AUDIO_GROUPS,
  AUDIO_SORTS,
  AudioStats,
  AudioTasks,
  DOVI_GROUPS,
  DOVI_SORTS,
  DoviStats,
  DoviTasks,
} from "./task-list";

/** A run, with whatever the library still knows about the file it worked on. */
export type LoggedRun = JobRun & { film?: TaskFilm };

/**
 * Three kinds of work the library can do to its own files: what is outstanding,
 * what is happening now, and what happened.
 *
 * Those were two pages. The queue listed the Profile 7 files worth converting,
 * the audio nobody here will ever play and the originals both of those leave
 * behind; this page listed the jobs that did something about them. Which meant
 * the film you converted was on one page as a row to act on and on another as a
 * row that had been acted on, and the question you actually arrive with — is
 * this film done, and did it work — was answered half in each.
 *
 * So a tab is one subject end to end: what is left, then what is running, then
 * what ran. The two lists that are genuinely about somewhere else — a better
 * copy of a film you own, and a film you do not own — stay on the queue, which
 * is now a page about fetching and nothing else.
 *
 * The rail answers "what is running" in the corner of every screen and
 * deliberately answers nothing else — it is a glance, not a record. This is the
 * page you come to on purpose, so it can afford the rest: a conversion that
 * failed at four in the morning is exactly the thing nobody was watching the
 * corner of the screen for.
 *
 * The scan is not here, and neither is the upgrade sweep. Both run on a timer
 * as much as on a click — a sweep starts behind every scan, and a scan runs on
 * every boot — so a page listing them says "scanned 418 files" and "12
 * upgrades found" over and over, with the conversion that failed at four in the
 * morning somewhere underneath. Both are still in the rail while they run,
 * which is the right place for a job nobody asked for.
 *
 * The sweep also has a better record of itself than a row here would be. What
 * it found is the queue, kept until something is done about it; the row only
 * ever said how many.
 *
 * One kind of row was never in the running half at all: an original thrown away
 * is over in the time it takes to unlink it, so there is nothing for the rail to
 * have shown. It is here because this is the page that answers "what happened
 * to that file", and it is the only answer this app cannot give a second time.
 *
 * The running half is drawn from the same `jobRows` the rail uses, so the two
 * cannot end up describing the same job differently.
 */

const TABS = [
  { key: "dovi", label: "Dolby Vision" },
  // Named for what the tab does rather than for what it lists: every other tab
  // here is a job, the dashboard's tile into it already says Strip Audio, and
  // "Audio tracks" was the same words the film page uses for the table that
  // merely names them.
  { key: "audio", label: "Strip Tracks" },
  { key: "cleanup", label: "Cleanup" },
] as const;

type Tab = (typeof TABS)[number]["key"];

/** Each list's own orders and cuts; the first of each is what it opens in. */
const SORTS: Record<Tab, Choice[]> = {
  dovi: DOVI_SORTS,
  audio: AUDIO_SORTS,
  cleanup: CLEANUP_SORTS,
};

const GROUPS: Record<Tab, Choice[]> = {
  dovi: DOVI_GROUPS,
  audio: AUDIO_GROUPS,
  cleanup: CLEANUP_GROUPS,
};

/**
 * Which running job belongs to which tab, by the key `jobRows` gives it.
 *
 * The full Dolby Vision read sits with the conversions because it is the same
 * subject asked one step earlier — it is what a row runs to find out whether it
 * can be converted at all, and it is started from that list.
 *
 * The sweep is in neither, as it is in neither half of this page.
 */
const RUNNING: Record<Tab, string[]> = {
  dovi: ["convert", "dovi"],
  audio: ["strip"],
  cleanup: ["thumbs"],
};

/**
 * And which finished ones, by the kind the log wrote them under.
 *
 * Thumbnails are under Cleanup for want of a truer home: a rebuild is the one
 * job here that is about this app's own cache rather than about the films, and
 * a tab of its own for a job you run twice a year is a tab that is empty every
 * other day of it. Cleanup is where the app's housekeeping already lives.
 */
const LOGGED: Record<Tab, JobKind[]> = {
  dovi: ["convert", "dovi"],
  audio: ["strip"],
  cleanup: ["cleanup", "thumbs"],
};

const KIND_LABEL: Record<string, string> = {
  convert: "Dolby Vision conversion",
  strip: "Audio removal",
  dovi: "Dolby Vision read",
  thumbs: "Thumbnails",
  // The only kind here that never had a running half. It is the name the queue
  // tab that sweeps these files carries, because that is where most of them are
  // deleted from and the word someone would come here looking for.
  cleanup: "Cleanup",
};

/** The outcome, as a word and the colour that word is worth. */
const OUTCOME: Record<string, { label: string; tone: string }> = {
  done: { label: "Done", tone: "text-emerald-600 dark:text-emerald-400" },
  error: { label: "Failed", tone: "text-red-600 dark:text-red-400" },
  cancelled: { label: "Stopped", tone: "opacity-50" },
};

/**
 * 4m 12s, or 1h 22m once it has been going long enough to need the hours.
 *
 * Two ends rather than a run, because a job that is still going has no
 * finishing time to be measured against and the clock stands in for one — the
 * same figure either way, which is the point: a conversion reads as forty
 * minutes in whether it is running or over.
 */
function took(startedAt: number | undefined, endedAt: number) {
  if (startedAt === undefined || !endedAt) return undefined;
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * When it finished, in the terms the answer is wanted in: minutes ago while it
 * is still this hour, then a clock time, then a date. Nobody reading a job log
 * wants "14/08/2026, 04:12" for something that ended while they were reading.
 */
function when(at: number, now: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const day = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });

  // No clock yet — the server, and the first paint after it. The absolute form
  // is true whenever it is read, which is what a server-rendered time has to be.
  if (!now) return `${day}, ${time}`;

  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return time;
  return `${day}, ${time}`;
}

/**
 * The figure a fact leads with, split from the words around it.
 *
 * "6.38 GB discarded" is a number and a caption for it, and the number is the
 * part anyone scanning the list is looking for. A fact with no figure — "runtime
 * matched" — comes back whole and is simply muted.
 */
const FIGURE = /^([\d.,]+(?:\s?[A-Za-z%]+)?)\s+(.+)$/;

/**
 * What the run did.
 *
 * Every job writes its closing facts as one string joined by a middle dot,
 * which is one thing to store and the wrong thing to read: a row of uniform
 * grey where the only parts that matter are the measurements.
 *
 * So the type does the separating rather than a box around each fact — the
 * figures at full strength, the words that caption them dropped back, the dots
 * dropped further still. Nothing is boxed, because none of these are labels;
 * they are readings, and a reading wants weight, not an outline.
 *
 * A failure is left as prose, in red. It is one fact, a sentence rather than a
 * measurement, and it is the row's whole point.
 */
function Detail({ run }: { run: LoggedRun }) {
  if (run.outcome === "error") {
    return (
      <p className="text-xs break-words text-red-600 dark:text-red-400">
        {run.detail}
      </p>
    );
  }

  const facts = run.detail?.split(" · ") ?? [];

  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
      {facts.map((fact, index) => {
        const [, figure, words] = FIGURE.exec(fact) ?? [];

        return (
          <span key={fact} className="flex items-baseline gap-1.5">
            {index > 0 && <span className="opacity-20">·</span>}
            {figure ? (
              <>
                <span className="font-medium tabular-nums">{figure}</span>
                <span className="opacity-45">{words}</span>
              </>
            ) : (
              <span className="opacity-45">{fact}</span>
            )}
          </span>
        );
      })}
    </p>
  );
}

/**
 * One job in progress, drawn as the run it is about to become.
 *
 * It used to be a title, a percentage and a bar — which said what was happening
 * but not what it was happening *to*, so the film you started a conversion on
 * was named only in the dialog behind a Details link, and the row above it in
 * the history had its poster. One list, two ways of describing the same film.
 *
 * So the layout is the finished row's, fact for fact: the poster on the left,
 * the film's title and file under it, and what the job is doing where the
 * finished row says what it did. What differs is only what a running job can
 * answer — a percentage rather than an outcome, the time so far rather than the
 * time it took, and a bar under it all.
 */
function Running({
  row,
  film,
  now,
  index,
  onDetails,
}: {
  row: JobRow;
  film?: TaskFilm;
  now: number;
  index: number;
  onDetails: () => void;
}) {
  const elapsed = took(row.detail.startedAt, now);
  // The file's own name, which is what the log shows on the line under the
  // title. A job with no film — a sweep, a thumbnail rebuild — has none, and
  // the layout closes up around it rather than printing an empty line.
  const fileName = row.path?.split("/").pop();

  return (
    // The whole row opens the dialog, drawn the way the queue draws a row that
    // opens something: a Details link beside a poster and a title was a target
    // the size of a word inside a target the size of the row, and only the word
    // did anything.
    <li
      role="button"
      tabIndex={0}
      onClick={onDetails}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDetails();
        }
      }}
      aria-label={`${row.detail.title} — progress`}
      style={stagger(index)}
      className="glow row-enter group -mx-4 flex cursor-pointer items-start gap-4 rounded-row px-4 py-4 transition-colors hover:bg-surface"
    >
      <Poster film={film} />

      <div className="flex min-h-24 min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* The clock rides the title line, at the far end of it. It was a
              line of its own under the file name, behind the job's own name —
              "Converting to Profile 8.1 · 4m 12s" — which put the one figure
              that changes while you watch at the end of a sentence that never
              does. The name went with it: what the job is doing is said twice
              more in this row, by the stage under the bar and by the dialog
              the row opens, and a third telling in smaller type was the row
              explaining itself rather than reporting. */}
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-medium">
              {film?.title ?? fileName ?? row.detail.title}
              {film?.year && (
                <span className="ml-2 text-xs opacity-40">{film.year}</span>
              )}
            </p>
            {elapsed && (
              <span className="shrink-0 text-xs tabular-nums opacity-45">
                {elapsed}
              </span>
            )}
          </div>
          {fileName && (
            <p
              className="min-w-0 truncate font-mono text-xs opacity-55"
              title={row.path}
            >
              {fileName}
            </p>
          )}
        </div>

        {/* Ranged off the bottom, so what the job is doing lands on the
            poster's foot exactly where a finished row's facts do. */}
        <div className="mt-auto flex flex-col gap-1.5">
          {row.detail.stage && (
            <p className="text-xs opacity-45">{row.detail.stage}</p>
          )}

          {/* The figure at the end of the bar rather than up in the corner: it
              is a reading of the bar, and read beside it there is nothing to
              carry across the row. A fixed column for it, so the bar does not
              shorten by a character as the number passes ten and a hundred. */}
          {row.percent !== undefined && (
            <div className="flex items-center gap-3">
              <div className="bar-track bar-track-thin flex-1">
                <div
                  className="bar-fill motion-safe:transition-[width] motion-safe:duration-300"
                  style={{
                    width: `${Math.min(100, Math.max(0, row.percent))}%`,
                  }}
                />
              </div>
              <span className="w-9 shrink-0 text-right text-xs tabular-nums opacity-55">
                {Math.round(row.percent)}%
              </span>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * One finished run, opening onto what it printed.
 *
 * The output used to unfold in place behind a Show output link, which is the
 * same mistake the running rows made with their Details link: a target the size
 * of a word inside a row that was doing nothing, and a log that pushed the rest
 * of the history down the page to be read in a strip four lines high. The row
 * is the target now, and the output is shown in the dialog a running job's is
 * shown in — one panel, whether the job is going or finished.
 *
 * What the dialog holds that the row cannot: the command the run actually was,
 * and the tail of what the tool said. A run with neither stays a row, because a
 * row that opens an empty dialog is worse than a row that does nothing.
 */
function Run({
  run,
  now,
  index,
  onOpen,
}: {
  run: LoggedRun;
  now: number;
  index: number;
  onOpen?: () => void;
}) {
  const outcome = OUTCOME[run.outcome] ?? OUTCOME.done;
  const duration = took(run.startedAt, run.finishedAt);

  return (
    <li
      {...(onOpen && {
        role: "button",
        tabIndex: 0,
        onClick: onOpen,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        },
        "aria-label": `${run.title} — output`,
      })}
      style={stagger(index)}
      className={`row-enter -mx-4 flex items-start gap-4 rounded-row px-4 py-4 ${
        onOpen
          ? "glow group cursor-pointer transition-colors hover:bg-surface"
          : ""
      }`}
    >
      <Poster film={run.film} />

      {/* At least as tall as the poster, so the column has two edges to range
          against rather than one: what the row is starts at the poster's top,
          what the run did sits at its foot, and the space between them is the
          poster rather than a gap. */}
      <div className="flex min-h-24 min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-col gap-0.5">
            {/* The film's name where the library still knows it, and the file's
                own where it does not — a log outlives what it describes. */}
            <p className="min-w-0 truncate text-sm font-medium">
              {run.film?.title ?? run.title}
              {run.film?.year && (
                <span className="ml-2 text-xs opacity-40">{run.film.year}</span>
              )}
            </p>
            <p
              className="min-w-0 truncate font-mono text-xs opacity-55"
              title={run.path}
            >
              {run.title}
            </p>
            <p className="text-xs opacity-45">
              {KIND_LABEL[run.kind] ?? run.kind}
              {duration && ` · ${duration}`}
            </p>
          </div>

          <div className="flex h-fit shrink-0 items-baseline gap-3">
            <span className={`text-xs font-medium ${outcome.tone}`}>
              {outcome.label}
            </span>
            <span className="text-xs tabular-nums opacity-40">
              {when(run.finishedAt, now)}
            </span>
          </div>
        </div>

        {/* `mt-auto` is what ranges this off the bottom: it takes the slack the
            poster's height leaves in the column, so what the run did lands on
            the poster's bottom edge however short the lines above it are. */}
        <div className="mt-auto flex flex-col gap-1.5">
          {run.detail && <Detail run={run} />}
        </div>
      </div>
    </li>
  );
}

/**
 * A finished run, said in the terms the running dialog says a job in.
 *
 * The same panel draws both, so the facts have to arrive in the same shape: the
 * measurements as a table, the output as the block under it. What a run has and
 * a job does not is an ending, so that is what the table leads with — and what
 * it did, which is the row's own line of facts, closes it, since the row it was
 * read on is behind the dialog now.
 */
function finished(run: LoggedRun, now: number): ProcessDetail {
  const duration = took(run.startedAt, run.finishedAt);

  return {
    title: run.film?.title ?? run.title,
    rows: [
      { label: "Job", value: KIND_LABEL[run.kind] ?? run.kind },
      { label: "Outcome", value: (OUTCOME[run.outcome] ?? OUTCOME.done).label },
      { label: "Finished", value: when(run.finishedAt, now) },
      ...(duration ? [{ label: "Took", value: duration }] : []),
      { label: "File", value: run.title, mono: true },
    ],
    // What was run, above what it printed — the same order and the same block
    // the running dialog puts them in, because they are the same two facts.
    // Null on the older rows, which were written before the log kept it.
    command: run.command,
    output: run.output,
    note: run.detail,
  };
}

export function JobsView({
  runs,
  films,
  dovi,
  keepingEl,
  audio,
  cleanup,
}: {
  runs: LoggedRun[];
  /** What the library knows about the films the running jobs are working on. */
  films: Record<string, TaskFilm>;
  /** The three lists of outstanding work, one per tab. */
  dovi: DoviTask[];
  /** Whether a conversion started from here keeps the layer it discards. */
  keepingEl: boolean;
  audio: AudioTask[];
  cleanup: CleanupFile[];
}) {
  const listing = useListing(TABS, SORTS, GROUPS);
  const tab = listing.tab;

  const { jobs, apply, subscribe } = useJobs();
  const router = useRouter();
  const [stopping, setStopping] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // The run whose output is being read, held by id: the log is re-fetched on
  // every refresh, so the object this page was rendered with is not the one it
  // will be holding a moment later.
  const [reading, setReading] = useState<number | null>(null);

  // Zero until the browser has one, which `when` reads as "print a time rather
  // than a distance from now": "3m ago" has no meaning on a server that
  // rendered it some unknown time before it was read.
  const now = useNow();

  // The tab's own job, where it is running. Filtered here rather than asked of
  // `jobRows`, because the rail is the one that wants all of them and a shared
  // list with a flag on it is two lists pretending to be one. The sweep is in
  // no tab's list, which is how this page leaves it to the rail — see the note
  // at the top.
  const jobbing = jobRows(jobs, apply);
  const running = jobbing.filter((row) => RUNNING[tab].includes(row.key));

  // And the tab's own history. A page-wide log would have put an audio removal
  // between two conversions under a heading that says Dolby Vision.
  const logged = runs.filter((run) => LOGGED[tab].includes(run.kind));

  /**
   * The files something is being done to right now.
   *
   * The lists below were rendered by the server out of what the last scan
   * derived, and nothing about a file changes at the moment a job starts on it
   * — so a conversion or a removal left its film sitting in Pending, under a
   * Running section drawing the same film with the same progress bar. Twice on
   * one screen, and the second one saying it had not been started yet.
   *
   * Work that has started is not outstanding, so it leaves the list the instant
   * it starts and comes back only if it fails. Taken from every running job
   * rather than this tab's, because the answer is about the file: one rewrite
   * runs at a time across the whole app, and a film being stripped is not
   * pending anywhere.
   *
   * The gap between a Dolby Vision pass finishing and its conversion starting
   * is deliberately not covered: nothing is running during that round trip, so
   * the row stays where it is and says it is starting — see `DoviTasks`.
   */
  const inFlight = new Set(
    jobbing.map((row) => row.path).filter((path) => path !== undefined),
  );

  const doviPending = dovi.filter((task) => !inFlight.has(task.path));
  const audioPending = audio.filter((task) => !inFlight.has(task.path));

  // How much outstanding work this tab has, which is the same question each
  // list asks itself before deciding to draw its empty state instead. Asked
  // here too so the heading above the list can go when the list does, and so
  // the band of figures over both goes with them.
  const pending =
    tab === "dovi"
      ? doviPending.length
      : tab === "audio"
        ? audioPending.length
        : cleanup.length;

  /**
   * Everything this tab had to do is being done — the list is empty only
   * because the last thing in it started.
   *
   * The section goes entirely rather than falling back to its empty state,
   * which would be a flat lie for as long as the job took: "no tracks worth
   * removing", printed under a row removing some. What would have been listed
   * is on screen one section up.
   */
  const allBusy =
    pending === 0 &&
    (tab === "dovi"
      ? dovi.length > 0
      : tab === "audio"
        ? audio.length > 0
        : false);

  // A run writes its row as it ends, so the log this page was rendered with is
  // one row short the moment anything finishes. Only the edge counts — see
  // `subscribe` for why a status alone cannot mean "just finished".
  //
  // A job *starting* matters for the same reason now: the running rows carry a
  // poster and a title, and those come from the server rather than from the job
  // stream. Without the second edge, a conversion started from a film's page
  // while this one was open would arrive as a row with a grey block where its
  // film should be.
  useEffect(
    () =>
      subscribe((next, prev) => {
        // The sweep is not among them: nothing on this page changes when one
        // starts or ends, and refreshing for it would re-render the log every
        // time a scan finished.
        const turned = (["dovi", "convert", "strip", "thumbs"] as const).some(
          (key) =>
            (prev[key].status === "running") !==
            (next[key].status === "running"),
        );
        if (turned) router.refresh();
      }),
    [subscribe, router],
  );

  // A job that ends takes its dialog with it, the way the rail's does.
  if (open !== null && !running.some((row) => row.key === open)) setOpen(null);
  const shown = running.find((row) => row.key === open) ?? null;

  const read = runs.find((run) => run.id === reading) ?? null;

  return (
    <>
      {/* The cleanup tab is the one that can act on the whole of itself, so it
          is the one that fills the bar's slot. The other two propose a rewrite
          per file, and there is no answering those in one click. */}
      <ListingBar
        listing={listing}
        action={tab === "cleanup" ? <CleanAll files={cleanup} /> : undefined}
      />

      {/* Above the sections rather than inside one: these figures are the
          tab's, and under the "Pending" heading they read as that section's
          own — which is wrong on the cleanup tab in particular, where the total
          counts rows the drive is currently hiding. Each returns nothing on an
          empty tab, where the list's empty state is the whole answer.

          `-mt-5` cancels the space the listing bar keeps under itself, which is
          there so a *list* does not read as a fourth control. This band is not
          a list, and left in place that space put the figures further from the
          bar than from the section under them — a band floating between two
          things it belongs to neither of. Cancelled, its own `py-3` and the
          page's gap fall the same either side of it.

          Emptiness is asked here as well as inside each band, which would
          return nothing either way: the wrapper is a flex child of the page,
          and an empty one still takes a gap. */}
      {pending > 0 && (
        <div className="-mt-5">
          {tab === "dovi" ? (
            <DoviStats tasks={doviPending} />
          ) : tab === "audio" ? (
            <AudioStats tasks={audioPending} />
          ) : (
            <CleanupStats files={cleanup} />
          )}
        </div>
      )}

      {/* No page title and no count above the sections, the way the downloads
          log has neither: the tabs already say which list this is, and the
          headings below say what is on it. A section that is not there is the
          emptier answer, and a count in front of each was a third way of
          saying what they say. */}
      {running.length > 0 && (
        <section className="flex flex-col gap-1">
          <SectionHeading label="Running" />
          <ul className="ruled flex flex-col">
            {running.map((row, index) => (
              <Running
                key={row.key}
                row={row}
                film={row.path ? films[row.path] : undefined}
                now={now}
                index={index}
                onDetails={() => setOpen(row.key)}
              />
            ))}
          </ul>
        </section>
      )}

      {/* What is still to do, under the one running and above the ones that
          ran. Always drawn, even when there is nothing in it: each list has its
          own empty state, and "no tracks worth removing" is an answer — a tab
          that showed only a history would leave you to infer it from the
          absence of a list.

          The heading goes when the list does, though. An empty state names its
          own situation in bigger type than the heading above it, so the two
          together said "Pending" over "Nothing left lying around" — a label for
          a list that is not there, on top of the sentence explaining that it is
          not. And with the heading gone the section can take the page's spare
          height (`flex-1`), which is what the empty state's `my-auto` centres
          itself in — otherwise it hangs under the running rows.

          And the whole section goes when the only reason it is empty is that
          its last row is the one running above — see `allBusy`. */}
      {!allBusy && (
        <section
          className={`flex flex-col gap-1 ${pending === 0 ? "flex-1" : ""}`}
        >
          {pending > 0 && <SectionHeading label="Pending" />}
          {tab === "dovi" ? (
            <DoviTasks
              tasks={doviPending}
              keepingEl={keepingEl}
              sort={listing.sort}
              group={listing.group}
            />
          ) : tab === "audio" ? (
            <AudioTasks
              tasks={audioPending}
              sort={listing.sort}
              group={listing.group}
            />
          ) : (
            <CleanupList
              files={cleanup}
              sort={listing.sort}
              group={listing.group}
            />
          )}
        </section>
      )}

      {/* Shut on arrival, unlike the two sections above it: the running job and
          the work still outstanding are what this page is opened for, and the
          record of what already ran is what you go looking for once — see
          `CollapsibleSection`. */}
      {logged.length > 0 && (
        <CollapsibleSection label="History" count={logged.length}>
          <ul className="ruled flex flex-col">
            {logged.map((run, index) => (
              <Run
                key={run.id}
                run={run}
                now={now}
                index={index}
                // Openable when the dialog would have something the row does
                // not: what was run, or what it printed. A run with neither —
                // a thumbnail rebuild, this app's own work — stays a row.
                onOpen={
                  run.command || visibleOutput(run.output).length > 0
                    ? () => setReading(run.id)
                    : undefined
                }
              />
            ))}
          </ul>
        </CollapsibleSection>
      )}

      <ProcessDetails
        detail={shown?.detail ?? null}
        onClose={() => setOpen(null)}
        busy={stopping}
        onCancel={
          shown?.stop &&
          (() => {
            setStopping(true);
            void shown.stop!().finally(() => {
              setStopping(false);
              setOpen(null);
            });
          })
        }
      />

      {/* The same panel, for a job that is over. Nothing to stop and nothing
          left to count, so it arrives with neither — a table of what happened
          and the log under it. */}
      <ProcessDetails
        detail={read ? finished(read, now) : null}
        onClose={() => setReading(null)}
        label={read ? `${read.title} — output` : undefined}
      />
    </>
  );
}
