"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Art } from "@/app/art";
import { useNow } from "@/app/clock";
import { EmptyState } from "@/app/empty-state";
import { jobRows, type JobRow } from "@/app/job-rows";
import { useJobs } from "@/app/jobs-provider";
import { ProcessDetails, type ProcessDetail } from "@/app/process-details";
import { SectionHeading } from "@/app/section-heading";
import { stagger } from "@/app/stagger";
import { visibleOutput } from "@/lib/job-output";
import type { JobRun } from "@/lib/job-history";
import type { TaskFilm } from "@/lib/queue-tasks";
import { posterName } from "@/lib/routes";

/** A run, with whatever the library still knows about the file it worked on. */
export type LoggedRun = JobRun & { film?: TaskFilm };

/**
 * What the app is doing, and what it has done.
 *
 * The rail answers the first question in the corner of every screen, and
 * deliberately answers nothing else — it is a glance, not a record. This is the
 * page you come to on purpose, so it can afford the second question: a
 * conversion that failed at four in the morning is exactly the thing nobody was
 * watching the corner of the screen for.
 *
 * The scan is not here, and neither is the upgrade sweep. Both run on a timer
 * as much as on a click — a sweep starts behind every scan, and a scan runs on
 * every boot — so a page listing them says "scanned 418 files" and "12
 * upgrades found" over and over, with the conversion that failed at four in the
 * morning somewhere underneath. Both are still in the rail while they run,
 * which is the right place for a job nobody asked for: a glance, not a record.
 *
 * The sweep also has a better record of itself than a row here would be. What
 * it found is the queue, kept until something is done about it; the row only
 * ever said how many.
 *
 * The running half is drawn from the same `jobRows` the rail uses, so the two
 * cannot end up describing the same job differently.
 */

const KIND_LABEL: Record<string, string> = {
  convert: "Dolby Vision conversion",
  strip: "Audio removal",
  dovi: "Dolby Vision read",
  thumbs: "Thumbnails",
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
 * The film's poster, drawn the way every other list in the app draws one — the
 * same component, the same fallback block, so a job about a film is recognised
 * by the same picture the film is recognised by everywhere else.
 *
 * The block stands in for a job with no film as well as for a film with no
 * poster: a sweep is about the whole library and has no picture to show, and a
 * ragged left edge down the list would say something about those rows that is
 * not true of them.
 */
function Poster({ film }: { film?: TaskFilm }) {
  if (film && (film.poster || film.posterRemote)) {
    return (
      <Art
        src={film.poster}
        remote={film.posterRemote}
        version={film.artAt}
        // Named so it travels into the film's page, as the queue's rows do.
        transitionName={posterName(film.path)}
        size="w92"
        loading="lazy"
        className="h-24 w-16 shrink-0 rounded-control object-cover ring-1 ring-line"
      />
    );
  }

  return (
    <div className="h-24 w-16 shrink-0 rounded-control bg-surface-strong" />
  );
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
          <p className="min-w-0 truncate text-sm font-medium">
            {film?.title ?? fileName ?? row.detail.title}
            {film?.year && (
              <span className="ml-2 text-xs opacity-40">{film.year}</span>
            )}
          </p>
          {fileName && (
            <p
              className="min-w-0 truncate font-mono text-xs opacity-55"
              title={row.path}
            >
              {fileName}
            </p>
          )}
          {/* The job's own name, where the finished row names its kind. It is
              the more exact of the two — "Rebuilding Profile 7" and
              "Converting to Profile 8.1" are one kind in the log. */}
          <p className="text-xs opacity-45">
            {row.detail.title}
            {elapsed && ` · ${elapsed}`}
          </p>
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
}: {
  runs: LoggedRun[];
  /** What the library knows about the films the running jobs are working on. */
  films: Record<string, TaskFilm>;
}) {
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

  // Every job the rail draws except the sweep, which this page leaves to the
  // rail in both halves — see the note at the top. Filtered here rather than
  // asked of `jobRows`, because the rail is the one that wants all of them and
  // a shared list with a flag on it is two lists pretending to be one.
  const running = jobRows(jobs, apply).filter((row) => row.key !== "sweep");

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

  if (running.length === 0 && runs.length === 0) {
    return (
      <EmptyState
        icon={
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </>
        }
        title="Nothing has run yet"
      >
        Conversions, audio removals, Dolby Vision reads and thumbnail rebuilds
        are listed here while they run, and kept afterwards. Start one from a
        film&rsquo;s page or the queue.
      </EmptyState>
    );
  }

  return (
    <>
      {/* No page title and no count above the sections, the way the downloads
          log has neither: the rail already says which page this is, and the two
          headings below say what is on it. A section that is not there is the
          emptier answer, and a count in front of both was a third way of
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

      {runs.length > 0 && (
        <section className="flex flex-col gap-1">
          <SectionHeading label="History" />
          <ul className="ruled flex flex-col">
            {runs.map((run, index) => (
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
        </section>
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
