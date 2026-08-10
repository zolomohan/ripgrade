"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Art } from "@/app/art";
import { useNow } from "@/app/clock";
import { EmptyState } from "@/app/empty-state";
import { jobRows, type JobRow } from "@/app/job-rows";
import { useJobs } from "@/app/jobs-provider";
import { ProcessDetails } from "@/app/process-details";
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
 * The scan is not here. It runs on a timer as much as on a click, and a log
 * whose every other row says "scanned 418 files" is a log with the interesting
 * rows buried in it.
 *
 * The running half is drawn from the same `jobRows` the rail uses, so the two
 * cannot end up describing the same job differently.
 */

const KIND_LABEL: Record<string, string> = {
  convert: "Dolby Vision conversion",
  strip: "Audio removal",
  dovi: "Dolby Vision read",
  sweep: "Upgrade sweep",
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

/** One finished run, with its output folded away until it is asked for. */
function Run({
  run,
  now,
  index,
}: {
  run: LoggedRun;
  now: number;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const lines = visibleOutput(run.output);
  const outcome = OUTCOME[run.outcome] ?? OUTCOME.done;
  const duration = took(run.startedAt, run.finishedAt);

  return (
    <li
      style={stagger(index)}
      className="row-enter -mx-4 flex items-start gap-4 px-4 py-4"
    >
      <Poster film={run.film} />

      {/* At least as tall as the poster, so the column has two edges to range
          against rather than one: what the row is starts at the poster's top,
          what the run did sits at its foot, and the space between them is the
          poster rather than a gap. A row with its output open simply grows past
          it and keeps both. */}
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

          {/* Folded, because the output is the answer on the rare row where the
              answer is not already in the line above it. */}
          {lines.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setOpen((was) => !was)}
                className="self-start text-xs underline underline-offset-4 opacity-45 hover:opacity-100"
              >
                {open ? "Hide output" : "Show output"}
              </button>
              {open && (
                <div className="max-h-56 overflow-y-auto rounded-control border border-line bg-surface-strong">
                  <pre className="p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
                    {lines.join("\n")}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
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

  // Zero until the browser has one, which `when` reads as "print a time rather
  // than a distance from now": "3m ago" has no meaning on a server that
  // rendered it some unknown time before it was read.
  const now = useNow();

  const running = jobRows(jobs, apply);

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
        const turned = (
          ["dovi", "convert", "strip", "sweep", "thumbs"] as const
        ).some(
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
        Conversions, audio removals, Dolby Vision reads, upgrade sweeps and
        thumbnail rebuilds are listed here while they run, and kept afterwards.
        Start one from a film&rsquo;s page or the queue.
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
              <Run key={run.id} run={run} now={now} index={index} />
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
    </>
  );
}
