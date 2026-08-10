"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  beginConvert,
  beginFullDoviScan,
  refreshAfterDoviScan,
} from "@/app/actions";
import { Art } from "@/app/art";
import { EmptyState } from "@/app/empty-state";
import { useJobs } from "@/app/jobs-provider";
import { useClosing } from "@/app/modal";
import { rememberListing } from "@/app/return-to";
import { stagger } from "@/app/stagger";
import { BUTTON } from "@/app/controls";
import { ConfirmModal } from "@/app/film/[id]/console";
import { languageKey } from "@/lib/audio-plan";
import { languageName } from "@/lib/derive";
import type { AudioTask, DoviTask, TaskFilm } from "@/lib/queue-tasks";
import { movieId, posterName } from "@/lib/routes";
import { Grouped, pickGroup, type GroupOption } from "./grouping";
import { Stat } from "@/app/charts";
import { Stats } from "./stats";
import { byTitle, pickSort, type SortOption } from "./sorts";

/**
 * The two lists of work the library can do to its own files.
 *
 * A row opens the film's page, where the console that reads the metadata,
 * explains the enhancement layer and offers the way back lives. What the queue
 * adds is the part a per-film page cannot: the whole library asked at once,
 * and ranked by what the work is worth.
 *
 * The conversions can also be started from here. Rewriting a film is one
 * decision made the same way whichever page asks it — the same confirmation,
 * the same original kept beside it, the same single job at a time — so the
 * button offers it where the list of candidates already is, rather than sending
 * you into twelve pages to press the same button twelve times.
 */

const size = (bytes: number) =>
  bytes >= 1e12
    ? `${(bytes / 1e12).toFixed(2)} TB`
    : `${(bytes / 1e9).toFixed(1)} GB`;

/** The release modal's chip, so a fact reads the same wherever it appears. */
function Chip({
  children,
  title,
}: {
  children: React.ReactNode;
  /** What an abbreviation stands for, for whoever does not already know. */
  title?: string;
}) {
  return (
    <span
      title={title}
      className="rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap opacity-70 ring-1 ring-line-strong ring-inset"
    >
      {children}
    </span>
  );
}

/** Where the film behind a row lives. Episodes have a page of their own. */
const hrefFor = (task: TaskFilm) =>
  `/${task.kind === "movie" ? "film" : "episode"}/${movieId(task.path)}`;

/**
 * The half of a row that is the same in both lists: which file this is.
 *
 * The right-hand figure is what differs, and it is what each list is about —
 * so it is passed in rather than branched on here.
 *
 * A role rather than a link, because a row can hold a button of its own and an
 * anchor cannot: the row navigates from a handler and the button stops the
 * click on its way up. Which is also why the crumb is left by hand — the
 * delegated listener in return-to.tsx only sees anchors.
 */
function TaskRow({
  task,
  index,
  chips,
  figure,
  progress,
}: {
  task: TaskFilm;
  index: number;
  chips: React.ReactNode;
  /** The figure this list is ranked by, or the action offered on it. */
  figure: React.ReactNode;
  /** Shown under the chips while something is happening to this file. */
  progress?: React.ReactNode;
}) {
  const router = useRouter();

  function open() {
    rememberListing();
    router.push(hrefFor(task));
  }

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      aria-label={task.title}
      style={stagger(index)}
      className="glow row-enter group -mx-4 flex cursor-pointer items-center gap-5 rounded-card px-4 py-4 transition-colors hover:bg-surface"
    >
      {task.poster || task.posterRemote ? (
        <Art
          src={task.poster}
          remote={task.posterRemote}
          version={task.artAt}
          // Named so it travels into the page this row opens.
          transitionName={posterName(task.path)}
          size="w92"
          loading="lazy"
          className="h-24 w-16 shrink-0 rounded-control object-cover ring-1 ring-line"
        />
      ) : (
        <div className="h-24 w-16 shrink-0 rounded-control bg-surface-strong" />
      )}

      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-base font-medium">
            {task.title}
          </span>
          {task.year && (
            <span className="shrink-0 text-sm opacity-40">{task.year}</span>
          )}
          {task.episode && (
            <span className="min-w-0 truncate text-sm opacity-40">
              {task.episode}
            </span>
          )}
        </p>

        <p className="mt-1.5 truncate font-mono text-xs opacity-55">
          {task.fileName}
        </p>

        {progress ?? (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/* Both lists want this and it says the same thing in each, so it
                is drawn here rather than passed in twice. First, because it is
                the fact that decides whether the rest of the row can be acted
                on at all. */}
            {task.offline && (
              <Chip title="The drive this file lives on is not connected, so nothing can be rewritten on it yet">
                Drive away
              </Chip>
            )}
            {chips}
          </div>
        )}
      </div>

      <div className="flex w-24 shrink-0 flex-col items-end gap-0.5 text-right">
        {figure}
      </div>
    </li>
  );
}

/** Both lists can be cut the same way: what is a film, and what is television. */
const kindOf = (task: TaskFilm) => (task.kind === "movie" ? "Films" : "Shows");
const KIND_ORDER = ["Films", "Shows"];

/** The count and total beside a group's name. */
const filmsNote = (tasks: TaskFilm[]) =>
  `${tasks.length} · ${size(tasks.reduce((n, t) => n + t.sizeBytes, 0))}`;

// ---------------------------------------------------------------------------
// Dolby Vision
// ---------------------------------------------------------------------------

/**
 * What a read enhancement layer is, in the names the tools use for it.
 *
 * MEL and FEL rather than a plain-English gloss: these are what dovi_tool
 * prints, what the film's own console names in its metadata table, and what
 * anyone reading about Profile 7 has already met. A chip is not the place to
 * teach the term — the tooltip does that, and the console spells it out in
 * full.
 *
 * No complex FEL among them: a file whose grade peaks above what the base layer
 * holds is never in this list, because converting it would clip those
 * highlights.
 */
const EL_LABEL: Record<string, string> = {
  mel: "MEL",
  "simple-fel": "FEL",
  unknown: "Layer unread",
};

const EL_TITLE: Record<string, string> = {
  mel: "Minimum enhancement layer — nothing in it, so converting loses nothing at all",
  "simple-fel": "Full enhancement layer, but graded within the base layer's range — what converting drops is refinement, not picture",
  unknown: "No pass has read the enhancement layer yet",
};

/**
 * Biggest first by default. Nothing on this tab saves space — every conversion
 * is the same improvement — so the size of the job is the one thing that
 * separates one row from another.
 */
export const DOVI_SORTS: SortOption<DoviTask>[] = [
  { key: "size", label: "Largest file", compare: (a, b) => b.sizeBytes - a.sizeBytes },
  { key: "smallest", label: "Smallest file", compare: (a, b) => a.sizeBytes - b.sizeBytes },
  {
    // A film whose frames have all been read converts straight away; the rest
    // begin with the pass. Worth being able to see the ready ones together.
    key: "ready",
    label: "Ready to convert",
    compare: (a, b) =>
      Number(b.scanned) - Number(a.scanned) || b.sizeBytes - a.sizeBytes,
  },
  { key: "added", label: "Recently added", compare: (a, b) => b.addedAt - a.addedAt },
  { key: "title", label: "Title", compare: (a, b) => byTitle(a.title, b.title) },
];

/** The three things that make one of these rows different from another. */
export const DOVI_GROUPS: GroupOption<DoviTask>[] = [
  { key: "none", label: "No grouping", of: () => "" },
  {
    // What converting would cost, which is the only question about these files
    // that has more than one answer.
    key: "layer",
    label: "Enhancement layer",
    of: (task) => (task.el && EL_LABEL[task.el]) || "Layer unread",
    order: ["MEL", "FEL", "Layer unread"],
  },
  {
    key: "ready",
    label: "Whether it has been read",
    of: (task) => (task.scanned ? "Every frame read" : "Not read yet"),
    order: ["Every frame read", "Not read yet"],
  },
  { key: "kind", label: "Films and shows", of: kindOf, order: KIND_ORDER },
];

export function DoviTasks({
  tasks: unsorted,
  sort,
  group,
}: {
  tasks: DoviTask[];
  sort?: string;
  group?: string;
}) {
  const tasks = [...unsorted].sort(pickSort(DOVI_SORTS, sort).compare);
  const grouping = pickGroup(DOVI_GROUPS, group);

  const { jobs, apply, subscribe } = useJobs();
  const { dovi: pass, convert, strip } = jobs;
  const router = useRouter();

  /** The film a Convert button is asking about, and whether it is working. */
  const [asking, setAsking] = useState<DoviTask | null>(null);
  const shown = useClosing(asking !== null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * A conversion that has not reached the conversion yet.
   *
   * A film whose frames have never all been read is converted in two steps —
   * the pass, then the rewrite — and the second is started here when the first
   * lands. Held in a ref as well as in state because the job subscription has
   * to see it without resubscribing every time it changes.
   */
  const [queued, setQueued] = useState<string | null>(null);
  const wants = useRef<string | null>(null);
  const intend = (path: string | null) => {
    wants.current = path;
    setQueued(path);
  };

  // React only to the edge out of a run this page saw, exactly as the film's
  // own console does: the server reports "done" forever after, so a status
  // alone cannot mean "just finished" and a connect-time snapshot would look
  // identical to a fresh one.
  useEffect(
    () =>
      subscribe((next, prev) => {
        const wasConverting = prev.convert.status === "running";
        if (wasConverting && next.convert.status !== "running") {
          if (next.convert.status === "error") {
            setError(next.convert.error ?? "Conversion failed");
          } else {
            // The job re-probes and re-derives the rewritten file itself, so
            // the page only needs repainting — and the row falls out of the
            // list, because the film is not Profile 7 any more.
            void refreshAfterDoviScan().then(() => router.refresh());
          }
        }

        const target = wants.current;
        const wasReading =
          prev.dovi.status === "running" && prev.dovi.path === target;
        if (!wasReading || next.dovi.status === "running") return;

        if (next.dovi.status !== "done" || !target) {
          // Failed or cancelled: the conversion it was the first step of is off.
          intend(null);
          if (next.dovi.status === "error") {
            setError(next.dovi.error ?? "Full pass failed");
          }
          return;
        }

        void refreshAfterDoviScan().then(async () => {
          router.refresh();
          intend(null);
          // The server re-checks the verdict against what the pass just wrote,
          // so a film that turns out to be a complex FEL is refused here rather
          // than converted on the strength of a sample.
          const result = await beginConvert(target);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          apply({
            convert: { status: "running", path: target, step: 1, steps: 3 },
          });
        });
      }),
    [subscribe, router, apply],
  );

  /**
   * Reads every frame first, when every frame has not been read.
   *
   * The same two-step the console runs, and for the same reason: a conversion
   * decided on a sample is a conversion decided on the frames the sample
   * happened to cover.
   */
  async function run(task: DoviTask) {
    setError(null);
    setStarting(true);

    if (!task.scanned) {
      const started = await beginFullDoviScan(task.path);
      setStarting(false);
      setAsking(null);
      if (!started.ok) {
        setError(started.error);
        return;
      }
      intend(task.path);
      apply({
        dovi: { status: "running", path: task.path, percent: 0, frames: 0 },
      });
      return;
    }

    const result = await beginConvert(task.path);
    setStarting(false);
    setAsking(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    apply({
      convert: { status: "running", path: task.path, step: 1, steps: 3 },
    });
  }

  // One rewrite at a time, which the server enforces anyway — the buttons say
  // so rather than letting a click find out. A track removal counts: it is the
  // same drive and the same file being rewritten by a different tool.
  const busy =
    pass.status === "running" ||
    convert.status === "running" ||
    strip.status === "running" ||
    queued !== null;

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={
          <>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M8 9v6h1.5a3 3 0 0 0 0-6H8Z" />
          </>
        }
        title="Nothing to convert"
      >
        Every Profile 7 file in the library has either been converted already or
        holds an enhancement layer worth keeping. Rip another disc and anything
        dual-layer lands here.
      </EmptyState>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      {error && (
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <Grouped items={tasks} group={grouping} note={filmsNote}>
        {(rows, offset) => (
      <ul className="ruled flex flex-col">
        {rows.map((task, index) => {
          const i = offset + index;
          const converting =
            convert.status === "running" && convert.path === task.path;
          const reading =
            pass.status === "running" && pass.path === task.path;
          // The gap between a pass finishing and its conversion starting, which
          // is a round trip long and would otherwise read as the row stopping.
          const handing = queued === task.path && !reading && !converting;
          const active = converting || reading || handing;

          const percent = converting
            ? (convert.percent ?? 0)
            : reading
              ? pass.percent
              : 0;

          return (
            <TaskRow
              key={task.path}
              task={task}
              index={i}
              chips={
                <>
                  <Chip>Profile 7</Chip>
                  {task.el && EL_LABEL[task.el] && (
                    <Chip title={EL_TITLE[task.el]}>{EL_LABEL[task.el]}</Chip>
                  )}
                  <span className="text-xs opacity-40">
                    {size(task.sizeBytes)}
                    {task.scanned
                      ? " · every frame read"
                      : " · converting reads every frame first"}
                  </span>
                </>
              }
              progress={
                active ? (
                  <>
                    {/* The downloads page's own bar, because it answers the
                        same question about the same kind of wait: how far
                        through, read across the row rather than squinted at. */}
                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-strong">
                      <div
                        className="h-full rounded-full bg-foreground/70 motion-safe:transition-[width] motion-safe:duration-500"
                        style={{ width: `${Math.min(100, percent)}%` }}
                      />
                    </div>

                    <p className="mt-2 text-xs tabular-nums opacity-45">
                      {converting
                        ? [
                            `Converting to Profile 8.1 · step ${convert.step} of ${convert.steps}`,
                            convert.label,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : reading
                          ? `Reading every frame · ${Math.round(pass.percent)}%${
                              pass.frames ? ` · ${pass.frames} frames` : ""
                            }`
                          : "Starting the conversion…"}
                    </p>
                  </>
                ) : undefined
              }
              figure={
                active ? (
                  <span className="text-sm font-medium tabular-nums">
                    {Math.round(percent)}%
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      // The row navigates; this does not.
                      e.stopPropagation();
                      setAsking(task);
                    }}
                    disabled={busy || task.offline}
                    title={
                      task.offline
                        ? "The drive this file lives on is not connected"
                        : busy
                          ? "Something is already rewriting a file — wait for it"
                          : task.scanned
                            ? "Rewrite as Profile 8.1, keeping the original"
                            : "Read every frame, then rewrite as Profile 8.1"
                    }
                    // Bordered rather than filled: twelve filled buttons down a
                    // list is a column of black blobs, and the emphasis the
                    // console's own button earns comes from being the one
                    // thing on that page.
                    className={BUTTON.secondary}
                  >
                    Convert
                  </button>
                )
              }
            />
          );
        })}
      </ul>
        )}
      </Grouped>

      {shown && asking && (
        <ConfirmModal
          open={asking !== null}
          title="Convert to Profile 8.1?"
          confirmLabel={asking.scanned ? "Convert" : "Read, then convert"}
          busy={starting}
          onConfirm={() => run(asking)}
          onCancel={() => setAsking(null)}
        >
          <span className="font-mono">{asking.fileName}</span> is rewritten in
          place and the Profile 7 original is kept beside it, so this can be
          undone from the film&rsquo;s own page.{" "}
          {asking.scanned
            ? "It takes a while — the whole file is rewritten."
            : "Every frame is read first, so it takes a while."}{" "}
          Leaving this page will not stop it.
        </ConfirmModal>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Audio tracks
// ---------------------------------------------------------------------------

/** "German, Spanish and 2 more" — the languages, without a wall of them. */
function languageLine(codes: string[]): string {
  const names = [...new Set(codes.map(languageName))];
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** What a removal is worth, first — and then the other ways of asking. */
export const AUDIO_SORTS: SortOption<AudioTask>[] = [
  {
    key: "freed",
    label: "Most freed",
    compare: (a, b) => b.freedBytes - a.freedBytes,
  },
  {
    // What fraction of the file is audio nobody will play. A 12 GB film that
    // is half foreign audio is a better hour's work than a 90 GB one that is
    // a twentieth, and the absolute total never says so.
    key: "share",
    label: "Biggest share of the file",
    compare: (a, b) => b.freedBytes / b.sizeBytes - a.freedBytes / a.sizeBytes,
  },
  {
    key: "tracks",
    label: "Most tracks removed",
    compare: (a, b) => b.removing - a.removing || b.freedBytes - a.freedBytes,
  },
  { key: "size", label: "Largest file", compare: (a, b) => b.sizeBytes - a.sizeBytes },
  { key: "added", label: "Recently added", compare: (a, b) => b.addedAt - a.addedAt },
  { key: "title", label: "Title", compare: (a, b) => byTitle(a.title, b.title) },
];

/**
 * The one grouping this list was always going to want is by show: a hundred
 * episodes of eight series read as a hundred unrelated decisions, and they are
 * eight — a show is ripped the same way throughout, so its episodes carry the
 * same foreign tracks and are worth doing together.
 */
export const AUDIO_GROUPS: GroupOption<AudioTask>[] = [
  { key: "none", label: "No grouping", of: () => "" },
  { key: "title", label: "Show or film", of: (task) => task.title },
  { key: "kind", label: "Films and shows", of: kindOf, order: KIND_ORDER },
  {
    // Which languages a rip carries says who pressed the disc, and a whole
    // region's worth of tracks is one decision rather than forty.
    key: "language",
    label: "Language going",
    of: (task) =>
      task.languages.length === 1
        ? languageName(task.languages[0])
        : `${new Set(task.languages).size} languages`,
  },
];

/** What a group of these is worth, which is not the same as what it weighs. */
const freedNote = (tasks: AudioTask[]) =>
  `${tasks.length} · ${size(tasks.reduce((n, t) => n + t.freedBytes, 0))} freed`;

export function AudioTasks({
  tasks: unsorted,
  sort,
  group,
}: {
  tasks: AudioTask[];
  sort?: string;
  group?: string;
}) {
  const tasks = [...unsorted].sort(pickSort(AUDIO_SORTS, sort).compare);
  const grouping = pickGroup(AUDIO_GROUPS, group);

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={
          <>
            <path d="M11 5 6 9H3v6h3l5 4V5Z" />
            <path d="M16 9.5a4 4 0 0 1 0 5" />
          </>
        }
        title="No tracks worth removing"
      >
        Nothing in the library carries audio in a language other than English —
        or what does is a file whose every track is foreign, which removing
        would leave silent.
      </EmptyState>
    );
  }

  const total = tasks.reduce((sum, task) => sum + task.freedBytes, 0);
  const anyEstimated = tasks.some((task) => task.estimated);
  const trackCount = tasks.reduce((sum, task) => sum + task.removing, 0);
  // Canonical, so the "fre" on one rip and the "fr" on the next are one
  // language here as they are in the setting that decided both.
  const languages = new Set(
    tasks.flatMap((task) => task.languages.map(languageKey)),
  );

  return (
    <section className="flex flex-col gap-8">
      <Stats>
        <Stat
          label="To reclaim"
          gain
          value={`${anyEstimated ? "≈" : ""}${size(total)}`}
          title={
            anyEstimated
              ? "Part of this total is worked out from bitrate rather than counted"
              : undefined
          }
        />
        <Stat label="Files" value={tasks.length.toLocaleString("en-GB")} />
        <Stat label="Tracks" value={trackCount.toLocaleString("en-GB")} />
        <Stat
          label={languages.size === 1 ? "Language" : "Languages"}
          value={languages.size.toLocaleString("en-GB")}
          title={[...new Set([...languages].map(languageName))]
            .sort()
            .join(", ")}
        />
      </Stats>

      <Grouped items={tasks} group={grouping} note={freedNote}>
        {(rows, offset) => (
      <ul className="ruled flex flex-col">
        {rows.map((task, index) => (
          <TaskRow
            key={task.path}
            task={task}
            index={offset + index}
            chips={
              // No count chip. What is going is named — the languages — and
              // what it is worth is the figure on the right; "8 of 9 tracks"
              // sat between them saying neither.
              <span className="min-w-0 truncate text-xs opacity-40">
                {languageLine(task.languages)} · {size(task.sizeBytes)} file
              </span>
            }
            figure={
              <>
                <span
                  className="text-sm font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
                  title={
                    task.estimated
                      ? "Part of this total is worked out from bitrate rather than counted"
                      : undefined
                  }
                >
                  {task.estimated ? "≈" : "−"}
                  {size(task.freedBytes)}
                </span>
                <span className="text-xs opacity-40">freed</span>
              </>
            }
          />
        ))}
      </ul>
        )}
      </Grouped>
    </section>
  );
}
