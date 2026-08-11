"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  beginConvert,
  beginFullDoviScan,
  checkConvertible,
  refreshAfterDoviScan,
} from "@/app/actions";
import { Art } from "@/app/art";
import { EmptyState } from "@/app/empty-state";
import { useJobs } from "@/app/jobs-provider";
import { useClosing, useLingering } from "@/app/modal";
import { rememberListing } from "@/app/return-to";
import { stagger } from "@/app/stagger";
import { BUTTON } from "@/app/controls";
import { ConfirmModal } from "@/app/confirm";
import { languageKey } from "@/lib/audio-plan";
import { languageName } from "@/lib/derive";
import type { AudioTask, DoviTask, TaskFilm } from "@/lib/queue-tasks";
import { movieId, posterName } from "@/lib/routes";
import { Grouped, pickGroup, type GroupOption } from "@/app/grouping";
import { Stat } from "@/app/charts";
import { AudioPicker } from "./audio-picker";
import { Stats } from "./stats";
import { byTitle, pickSort, type SortOption } from "@/app/sorts";

/**
 * The two lists of work the library can do to its own files.
 *
 * A Dolby Vision row opens the film's page, where the console that reads the
 * metadata, explains the enhancement layer and offers the way back lives. What
 * these add is the part a per-film page cannot: the whole library asked at
 * once, and ranked by what the work is worth.
 *
 * An audio row opens a dialog instead, because its work is a question rather
 * than a button — which of these tracks actually go — and the film's page was
 * a walk taken only to answer it. See ./audio-picker.tsx.
 *
 * They are the pending half of the jobs page's first two tabs, under the job
 * running and above the log of the ones that ran. They were the queue's for as
 * long as the queue was "everything outstanding" — but what is outstanding here
 * is a job this app runs and writes down, and the row you act on belongs above
 * the record of what acting on it did.
 *
 * Both jobs can be started from here. Rewriting a film is one decision made the
 * same way whichever page asks it — the same original kept beside it, the same
 * single job at a time — so the list of candidates is where it is offered,
 * rather than sending you into twelve pages to press the same button twelve
 * times.
 *
 * A row whose enhancement layer could still rule the film out offers the check
 * instead, for the same reason the film's own console does: the button says
 * which of the two it is, rather than promising a rewrite and finding out.
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
  onOpen,
}: {
  task: TaskFilm;
  index: number;
  chips: React.ReactNode;
  /** The figure this list is ranked by, or the action offered on it. */
  figure: React.ReactNode;
  /** Shown under the chips while something is happening to this file. */
  progress?: React.ReactNode;
  /**
   * What the row does instead of opening the film.
   *
   * The Dolby Vision list has nothing to ask — a conversion is one decision
   * made by a button — so its rows still go to the page. The audio list's whole
   * question is which tracks, and that is asked here rather than a page away;
   * see ./audio-picker.tsx, which keeps a way through to the film anyway.
   */
  onOpen?: () => void;
}) {
  const router = useRouter();

  function open() {
    if (onOpen) {
      onOpen();
      return;
    }
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
      className="glow row-enter group -mx-4 flex cursor-pointer items-center gap-5 rounded-row px-4 py-4 transition-colors hover:bg-surface"
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

      {/* A column rather than whatever the figure happens to measure, so a
          list reads down its right edge as one. Wide enough for the widest
          thing either list puts in it — a button labelled "Convert", which is
          the one figure here that is a shape as well as a word and so cannot
          be a few pixels narrower than the row above it without showing. */}
      <div className="flex w-28 shrink-0 flex-col items-end gap-0.5 text-right">
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
  "simple-fel":
    "Full enhancement layer, but graded within the base layer's range — what converting drops is refinement, not picture",
  unknown: "No pass has read the enhancement layer yet",
};

/**
 * Biggest first by default. Nothing on this tab saves space — every conversion
 * is the same improvement — so the size of the job is the one thing that
 * separates one row from another.
 */
export const DOVI_SORTS: SortOption<DoviTask>[] = [
  {
    key: "size",
    label: "Largest file",
    compare: (a, b) => b.sizeBytes - a.sizeBytes,
  },
  {
    key: "smallest",
    label: "Smallest file",
    compare: (a, b) => a.sizeBytes - b.sizeBytes,
  },
  {
    // A film whose frames have all been read converts straight away; the rest
    // begin with the pass. Worth being able to see the ready ones together.
    key: "ready",
    label: "Ready to convert",
    compare: (a, b) =>
      Number(b.scanned) - Number(a.scanned) || b.sizeBytes - a.sizeBytes,
  },
  {
    key: "added",
    label: "Recently added",
    compare: (a, b) => b.addedAt - a.addedAt,
  },
  {
    key: "title",
    label: "Title",
    compare: (a, b) => byTitle(a.title, b.title),
  },
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

/**
 * A full pass this page started, and what it started it for: the conversion the
 * pass is the first step of, or the answer the pass was run to get.
 */
type Errand = { path: string; fileName: string; then: "convert" | "report" };

export function DoviTasks({
  tasks: unsorted,
  keepingEl,
  sort,
  group,
}: {
  tasks: DoviTask[];
  /**
   * Whether a conversion keeps the enhancement layer it discards. Not a
   * per-film fact and not something this list can change — it is here so the
   * confirmation says what the job will actually do, since keeping the layer
   * puts a whole extra pass over the film in front of the conversion.
   */
  keepingEl: boolean;
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
   * What a check found, which is not an error even when it rules the film out —
   * the row simply leaves the list, and a row that vanishes without a word is
   * the answer withheld.
   */
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(
    null,
  );

  /**
   * The pass this page is waiting on.
   *
   * Two errands for one job, because on a MEL the pass is a step of converting
   * — nothing it can find changes the verdict — while on a FEL it *is* the
   * verdict, and what follows it is a sentence rather than a rewrite.
   *
   * Held in a ref as well as in state because the job subscription has to see
   * it without resubscribing every time it changes.
   */
  const [pending, setPending] = useState<Errand | null>(null);
  const wants = useRef<Errand | null>(null);
  const intend = (next: Errand | null) => {
    wants.current = next;
    setPending(next);
  };
  /** Only a conversion has a hand-off to narrate; a check ends where it ends. */
  const queued = pending?.then === "convert" ? pending.path : null;

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

        const errand = wants.current;
        const wasReading =
          prev.dovi.status === "running" && prev.dovi.path === errand?.path;
        // Named endings rather than "no longer running": a snapshot already in
        // flight when the pass started says idle, arrives just after the
        // optimistic running one, and would read as the pass stopping.
        const ended =
          next.dovi.status === "done" ||
          next.dovi.status === "error" ||
          next.dovi.status === "cancelled";
        if (!wasReading || !ended) return;

        if (next.dovi.status !== "done" || !errand) {
          // Failed or cancelled: whatever it was the first step of is off.
          intend(null);
          if (next.dovi.status === "error") {
            setError(next.dovi.error ?? "Full pass failed");
          }
          return;
        }

        void refreshAfterDoviScan().then(async () => {
          router.refresh();
          intend(null);

          // A check reports and stops. The verdict it just settled decides
          // whether the row keeps its Convert button or leaves the list, and
          // either way the reader asked a question and is owed the answer.
          if (errand.then === "report") {
            const verdict = await checkConvertible(errand.path);
            setNotice({
              ok: verdict.ok,
              text: verdict.ok
                ? `${errand.fileName} can be converted — its button is ready.`
                : verdict.error,
            });
            return;
          }

          // The server re-checks the verdict against what the pass just wrote,
          // so a film that turns out to be a complex FEL is refused here rather
          // than converted on the strength of a sample.
          const result = await beginConvert(errand.path);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          apply({ convert: result.job });
        });
      }),
    [subscribe, router, apply],
  );

  /**
   * Reads every frame and stops there, so the verdict is settled before
   * anything is offered on the strength of it.
   *
   * Nothing is written, so nothing is confirmed: a check costs time and no
   * film.
   */
  async function check(task: DoviTask) {
    setError(null);
    setNotice(null);

    const started = await beginFullDoviScan(task.path);
    if (!started.ok) {
      setError(started.error);
      return;
    }
    intend({ path: task.path, fileName: task.fileName, then: "report" });
    apply({
      dovi: { status: "running", path: task.path, percent: 0, frames: 0 },
    });
  }

  /**
   * Reads every frame first, when every frame has not been read.
   *
   * The same two-step the console runs, and reachable for the same reason: only
   * on a film whose verdict the pass cannot overturn. Anything a full read
   * could still rule out goes through `check` instead, and comes back here as a
   * separate click.
   */
  async function run(task: DoviTask) {
    setError(null);
    setNotice(null);
    setStarting(true);

    if (!task.scanned) {
      const started = await beginFullDoviScan(task.path);
      setStarting(false);
      setAsking(null);
      if (!started.ok) {
        setError(started.error);
        return;
      }
      intend({ path: task.path, fileName: task.fileName, then: "convert" });
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
    apply({ convert: result.job });
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

      {/* Amber when the check ruled the film out, because that row has just
          left the list and the sentence is all that is left of it. */}
      {notice && (
        <p
          className={`text-sm ${
            notice.ok ? "opacity-60" : "text-amber-600 dark:text-amber-400"
          }`}
        >
          {notice.text}
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
              /**
               * Whether this row offers the question rather than the answer. A MEL
               * has nothing a full read could turn up, so it converts on one click;
               * anything else with unread frames could still be ruled out, and a
               * button labelled Convert on one of those promises a rewrite the
               * server would refuse once the pass came back.
               */
              const checkFirst = !task.scanned && task.el !== "mel";

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
                        <Chip title={EL_TITLE[task.el]}>
                          {EL_LABEL[task.el]}
                        </Chip>
                      )}
                      <span className="text-xs opacity-40">
                        {size(task.sizeBytes)}
                        {task.scanned
                          ? " · every frame read"
                          : task.el === "mel"
                            ? " · converting reads every frame first"
                            : " · a check reads every frame"}
                      </span>
                    </>
                  }
                  progress={
                    active ? (
                      <>
                        {/* The transfer list's own bar, because it answers the
                        same question about the same kind of wait: how far
                        through, read across the row rather than squinted at. */}
                        <div className="bar-track mt-2.5">
                          <div
                            className="bar-fill motion-safe:transition-[width] motion-safe:duration-500"
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
                          // A check writes nothing, so it runs on the click. Only
                          // the rewrite is worth stopping to confirm.
                          if (checkFirst) void check(task);
                          else setAsking(task);
                        }}
                        disabled={busy || task.offline}
                        title={
                          task.offline
                            ? "The drive this file lives on is not connected"
                            : busy
                              ? "Something is already rewriting a file — wait for it"
                              : checkFirst
                                ? "Reads every frame to settle whether converting would clip anything. Nothing is written."
                                : task.scanned
                                  ? "Rewrite as Profile 8.1, keeping the original"
                                  : "Read every frame, then rewrite as Profile 8.1"
                        }
                        // Bordered rather than filled: twelve filled buttons down a
                        // list is a column of black blobs, and the emphasis the
                        // console's own button earns comes from being the one
                        // thing on that page.
                        //
                        // The width comes from the column and not from the word
                        // in it: a list where some rows say Check and some say
                        // Convert was a ragged left edge of pills down the side
                        // of the page, each one a different size for a reason
                        // nobody reading a column of them can see.
                        className={`${BUTTON.secondary} w-full`}
                      >
                        {checkFirst ? "Check" : "Convert"}
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
          {keepingEl &&
            "The enhancement layer is set aside in an archive of its own first, so it survives deleting that original. "}
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
  {
    key: "size",
    label: "Largest file",
    compare: (a, b) => b.sizeBytes - a.sizeBytes,
  },
  {
    key: "added",
    label: "Recently added",
    compare: (a, b) => b.addedAt - a.addedAt,
  },
  {
    key: "title",
    label: "Title",
    compare: (a, b) => byTitle(a.title, b.title),
  },
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

  const { jobs, subscribe } = useJobs();
  const { strip, convert, dovi: pass } = jobs;
  const router = useRouter();

  /** The file whose tracks are being chosen, or none. */
  const [asking, setAsking] = useState<AudioTask | null>(null);
  // Held past the click that closes it, so the dialog plays out rather than
  // blanking a frame before it has finished leaving.
  const held = useLingering(asking);
  const [error, setError] = useState<string | null>(null);

  // Only the edge out of a removal counts, for the reason the conversions give
  // above: the server reports "done" forever after, so a status alone cannot
  // mean "just finished".
  useEffect(
    () =>
      subscribe((next, prev) => {
        if (
          prev.strip.status !== "running" ||
          next.strip.status === "running"
        ) {
          return;
        }
        if (next.strip.status === "error") {
          setError(next.strip.error ?? "Removing the tracks failed");
          return;
        }
        // The job re-probes and re-derives the rewritten file itself, so the
        // list only needs repainting — and the row leaves it, because what it
        // proposed has happened and the original is now the cleanup tab's.
        router.refresh();
      }),
    [subscribe, router],
  );

  // One rewrite at a time, which the server enforces anyway — the dialog says
  // so rather than letting Continue find out.
  const busy =
    strip.status === "running" ||
    convert.status === "running" ||
    pass.status === "running"
      ? "Something is already rewriting a file — wait for it"
      : undefined;

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
      {error && (
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

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
                // The tracks are chosen here rather than on the film's page.
                //
                // No running state on these rows: a file being rewritten is not
                // pending, so the jobs page takes it out of this list for as
                // long as the removal lasts and draws it under Running instead.
                // See `inFlight` in ./jobs-view.tsx.
                onOpen={() => setAsking(task)}
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

      {/* Keyed by the file, so choosing on one row and then another does not
          hand the second film the first one's ticks. */}
      {held && (
        <AudioPicker
          key={held.path}
          task={held}
          open={asking !== null}
          onClose={() => setAsking(null)}
          blocked={busy}
        />
      )}
    </section>
  );
}
