"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  beginConvertBatch,
  beginStripBatch,
  stopConvert,
  stopFullDoviScan,
} from "@/app/actions";
import { Art } from "@/app/art";
import { EmptyState } from "@/app/empty-state";
import { useJobs } from "@/app/jobs-provider";
import type { Layout } from "@/app/listing";
import { useClosing, useLingering } from "@/app/modal";
import {
  PosterTile,
  TILE_GRID_RULED,
  TILE_NOTE,
  TILE_READING,
} from "@/app/poster-tile";
import { rememberListing } from "@/app/return-to";
import { SCORE_PLATE_ROOMY } from "@/app/score-circle";
import { Spinner } from "@/app/spinner";
import { stagger } from "@/app/stagger";
import { Tick, TickColumn } from "@/app/tick";
import { TILE_MARK } from "@/app/tile-button";
import { BUTTON, CONTROL_H } from "@/app/controls";
import { ConfirmModal } from "@/app/confirm";
import {
  checksFirst,
  doviRefusal,
  DoviConvertConfirm,
  DoviNotices,
  EL_LABEL,
  EL_TITLE,
  useDoviConvert,
} from "@/app/dovi-convert";
import { languageKey } from "@/lib/audio-plan";
import { languageName } from "@/lib/derive";
import type { AudioTask, DoviTask, TaskFilm } from "@/lib/queue-tasks";
import { movieId, posterName } from "@/lib/routes";
import { tickRows } from "@/lib/selection";
import {
  Grouped,
  orderedBy,
  pickGroup,
  type GroupOption,
} from "@/app/grouping";
import { Stat } from "@/app/charts";
import { TrackPicker } from "./track-picker";
import { DoviDetails } from "./dovi-details";
import { Stats } from "./stats";
import { byTitle, pickSort, type SortOption } from "@/app/sorts";
import { size } from "@/app/format";

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
 * a walk taken only to answer it. See ./track-picker.tsx.
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

/**
 * The two-tier form the rest of the app writes a film's size in, with the two
 * tiers under it that a *track* needs.
 *
 * A film is always gigabytes and this stopped there. A subtitle track is tens
 * of megabytes, so every one of them drew as "0.0 GB" — which does not read as
 * a rounded figure, it reads as a track that costs nothing at all, and it made
 * the subtitle half of a removal look pointless. The same point `format.ts`
 * makes about the thumbnail cache, arriving on a list of tracks: rounding 40 MB
 * to nothing is not a coarser answer, it is a wrong one.
 */

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
  select,
  selecting,
  chosen,
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
   * see ./track-picker.tsx, which keeps a way through to the film anyway.
   */
  onOpen?: (range: boolean) => void;
  /** The box that puts this row in a run of them, on a list that offers one. */
  select?: React.ReactNode;
  /** Whether that box is out, which is a mode the whole list is in or not. */
  selecting?: boolean;
  chosen?: boolean;
}) {
  const router = useRouter();

  function open(range: boolean) {
    if (onOpen) {
      onOpen(range);
      return;
    }
    rememberListing();
    router.push(hrefFor(task));
  }

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={(e) => open(e.shiftKey)}
      // While the boxes are out the row is one of them, so it says so — the
      // whole row answers the click, and the corner box is the mark rather
      // than the control.
      aria-pressed={selecting ? Boolean(chosen) : undefined}
      // Shift-click is also how a browser extends a text selection, so without
      // this a run ticked down the list drags a blue smear across it. Only when
      // shift is held, and only where a run means something — see `Tick`, which
      // refuses the same gesture for the same reason.
      onMouseDown={(e) => {
        if (selecting && e.shiftKey) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open(e.shiftKey);
        }
      }}
      aria-label={task.title}
      style={stagger(index)}
      // A chosen row is not drawn any differently. The box in its corner is
      // filled, and that is the whole of the mark.
      //
      // It held a deeper fill for a while, and before that an outline. Both
      // were the same mistake at different strengths: a row is a line in a
      // ruled list, and a band of colour across it makes it a block sitting on
      // the list rather than part of it — twelve ticked and the page is bars
      // rather than rows. The tick is a small mark because what it marks is
      // small; the count and the total are said in the band above, which is
      // where somebody checking their selection is looking anyway.
      className="glow row-enter group -mx-4 flex cursor-pointer items-center gap-5 rounded-row px-4 py-4 transition-colors hover:bg-surface"
    >
      {/* The box, in the corner of the row and opening out of nothing — see
          `TickColumn`, which both this list and the cleanup list draw it
          with. */}
      {select && <TickColumn open={Boolean(selecting)}>{select}</TickColumn>}

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
          /* No "Drive away" chip here any more. An unplugged drive is not a
             property of the film — it is a reason the one thing this row offers
             cannot be done, and the button already says so, greyed out with the
             sentence on it. Said twice it was a label on a row that reads as a
             judgement about the file. */
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
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

/**
 * The same file as a poster.
 *
 * What a row says down its length, a tile says round its edges — see
 * app/poster-tile.tsx, which owns the four corners and what may be put in them.
 * All this adds is the film: the artwork, the name, the file under it, and the
 * click that opens whatever the list opens.
 */
function TaskTile({
  task,
  index,
  facts,
  factsTitle,
  mark,
  badge,
  note,
  status,
  action,
  onOpen,
  selecting,
  chosen,
}: {
  task: TaskFilm;
  index: number;
  facts?: (string | number | false | null | undefined)[];
  factsTitle?: string;
  mark?: React.ReactNode;
  badge?: React.ReactNode;
  note?: React.ReactNode;
  status?: React.ReactNode;
  action?: React.ReactNode;
  onOpen?: (range: boolean) => void;
  selecting?: boolean;
  chosen?: boolean;
}) {
  const router = useRouter();

  // The row's own default, kept here rather than passed down: a tile with
  // nothing else to do opens the film, and the crumb is left by hand because
  // the delegated listener in return-to.tsx only sees anchors.
  function open(range: boolean) {
    if (onOpen) {
      onOpen(range);
      return;
    }
    rememberListing();
    router.push(hrefFor(task));
  }

  return (
    <PosterTile
      poster={{
        src: task.poster,
        remote: task.posterRemote,
        version: task.artAt,
      }}
      // Named so the tile travels into the page it opens, as the row's poster
      // does — the whole frame, because the whole frame is what you clicked.
      /*
       * The film, what the work is about, and nothing else.
       *
       * The year and the file name came from the rows, where there is a line
       * spare for each. Under a poster they were two more grey lines below a
       * caption that already names the film — and neither is a fact about the
       * *job*: the year does not change what converting costs, and the name on
       * disk is sixty characters cut at the front to fit a tile it cannot fit.
       * Both are still on the row, and the row is a click away on the same
       * page.
       *
       * An episode says which one it is and then which show, on one line
       * instead of two. The number leads because that is what tells eight
       * tiles of the same series apart, and the show's name follows it because
       * a grid of bare codes says nothing about what you are looking at.
       *
       * The episode's own title is not here, and that is the point: it is
       * parsed out of the file name, so on a release that never carried one it
       * is whatever the parser found — "MULTI", on every episode of a
       * multi-language rip. The rows still print it, where a wrong one is a
       * curiosity rather than the caption.
       */
      title={
        task.episodeCode ? `${task.episodeCode} · ${task.title}` : task.title
      }
      facts={facts}
      factsTitle={factsTitle}
      mark={mark}
      badge={badge}
      note={note}
      status={status}
      action={action}
      label={task.title}
      index={index}
      onOpen={open}
      selecting={selecting}
      chosen={chosen}
    />
  );
}

/**
 * The two marks a tile wears while there is a job to start or to stop.
 *
 * A word under the poster is what the row uses and what these tiles used: it
 * can say Check or Convert, which are different promises. Over artwork there is
 * no room for either word, and a grid of posters each with a pill under it
 * reads as a form — so the tile says it in the shape every media control has
 * had for fifty years, and keeps the sentence on the mark's own tooltip. What
 * the press actually does is unchanged: a check runs, a rewrite asks first.
 *
 * The downloads page's transfers wear the same pair in the same corner — see
 * app/downloads/downloads-view.tsx — because they answer the same two questions:
 * start this, or stop the one that is going.
 */
function TileMark({
  kind,
  label,
  title,
  disabled,
  busy,
  onPress,
}: {
  kind: "start" | "stop";
  label: string;
  title?: string;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        // The tile navigates to the film; this does not.
        event.stopPropagation();
        onPress();
      }}
      disabled={disabled || busy}
      aria-label={label}
      title={title ?? label}
      className={`${TILE_MARK} disabled:opacity-40 ${
        kind === "stop" ? "hover:text-red-400" : ""
      }`}
    >
      {busy ? (
        <Spinner className="h-4 w-4" />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={kind === "stop" ? "2.2" : "2"}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-5 w-5"
        >
          {kind === "stop" ? (
            <path d="M6 6l12 12M18 6L6 18" />
          ) : (
            <path d="M8 5.5v13l11-6.5z" />
          )}
        </svg>
      )}
    </button>
  );
}

/** What a tick on one of these means, before it is drawn either way. */
type TickProps = {
  checked: boolean;
  disabled?: boolean;
  refusal?: string;
  hint?: string;
  onTick: (range: boolean) => void;
  label: string;
};

/**
 * One task, drawn the way the page is being read.
 *
 * The branch is here rather than at each list so that a row and a tile of the
 * same film cannot drift apart in what they *do* — one click handler, one
 * selection mode, one set of refusals. What differs is only where each fact
 * goes, and that is what the two sets of slots below are: `chips` and `figure`
 * are the row's, `badge`, `note`, `status` and `action` are the tile's, and
 * every list fills both because the same fact belongs in different places
 * depending on how much room there is for it.
 *
 * The box is the one thing built here rather than passed in, because it is the
 * one thing that is drawn differently in each: a plate in the corner of a row,
 * and a ring over the artwork on a tile — see `Tick`'s `art`.
 */
function TaskItem({
  layout,
  task,
  index,
  tick,
  chips,
  figure,
  progress,
  facts,
  factsTitle,
  badge,
  note,
  status,
  action,
  onOpen,
  selecting,
  chosen,
}: {
  layout: Layout;
  task: TaskFilm;
  index: number;
  /** The box, where this list offers one. */
  tick?: TickProps;
  /** Rows: the chip line under the file name. */
  chips: React.ReactNode;
  /** Rows: the right-hand column, which is what the list is ranked by. */
  figure: React.ReactNode;
  /** Rows: what replaces the chips while something is happening to this file. */
  progress?: React.ReactNode;
  /** Tiles: the muted line under the name — see `PosterTile`. */
  facts?: (string | number | false | null | undefined)[];
  /** And what a word in it means, where one is an abbreviation. */
  factsTitle?: string;
  /** Tiles: the reading, top right. */
  badge?: React.ReactNode;
  /** Tiles: a word about where this one is, bottom left. */
  note?: React.ReactNode;
  /** Tiles: the strip along the foot, while something is happening. */
  status?: React.ReactNode;
  /** Tiles: what will not fit on a poster, under the caption. */
  action?: React.ReactNode;
  onOpen?: (range: boolean) => void;
  selecting?: boolean;
  chosen?: boolean;
}) {
  const select = tick && (
    <Tick
      {...tick}
      art={layout === "grid"}
      // Small in both. In a row it sits in a corner rather than filling a
      // column of its own, and on a tile every pixel of padding is a pixel of
      // the poster it stands on.
      pad="p-1"
    />
  );

  if (layout === "rows") {
    return (
      <TaskRow
        task={task}
        index={index}
        chips={chips}
        figure={figure}
        progress={progress}
        onOpen={onOpen}
        select={select}
        selecting={selecting}
        chosen={chosen}
      />
    );
  }

  return (
    <TaskTile
      task={task}
      index={index}
      facts={facts}
      factsTitle={factsTitle}
      mark={select}
      badge={badge}
      note={note}
      status={status}
      action={action}
      onOpen={onOpen}
      selecting={selecting}
      chosen={chosen}
    />
  );
}

/**
 * The container a list of tasks is laid out in, either way.
 *
 * A `ul.ruled` is what parts rows — see the rule in globals.css — and a grid
 * parts its tiles by the space between them, so the two want different elements
 * rather than one element with different classes.
 */
function TaskList({
  layout,
  children,
}: {
  layout: Layout;
  children: React.ReactNode;
}) {
  return layout === "rows" ? (
    <ul className="ruled flex flex-col">{children}</ul>
  ) : (
    <div className={TILE_GRID_RULED}>{children}</div>
  );
}

/** Both lists can be cut the same way: what is a film, and what is television. */
const kindOf = (task: TaskFilm) => (task.kind === "movie" ? "Films" : "Shows");
const KIND_ORDER = ["Films", "Shows"];

/**
 * Films together, and every show apart.
 *
 * The plain two-bucket cut puts a season of one series and a season of another
 * in a single section called "Shows", which is the one grouping nobody wants:
 * what you do about a show is done a season at a time, and a hundred episodes
 * of four series interleaved by size is a list you have to read to find the
 * ones that belong together. Films are the opposite case — each is its own
 * decision, and a section per film is a heading over every row.
 *
 * So the films keep one bucket and each show gets its own, named after it.
 * `order` names only "Films": everything else is a show's title, and titles
 * sort themselves.
 */
const filmsOrShow = (task: TaskFilm) =>
  task.kind === "movie" ? "Films" : task.title;

const FILMS_FIRST = ["Films"];

/** The count and total beside a group's name. */
const filmsNote = (tasks: TaskFilm[]) =>
  `${tasks.length} · ${size(tasks.reduce((n, t) => n + t.sizeBytes, 0))}`;

// ---------------------------------------------------------------------------
// Dolby Vision
// ---------------------------------------------------------------------------

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
 * What this tab adds up to.
 *
 * No total size, which the other two bands lead with and which means nothing
 * here: a conversion rewrites a file into the same picture at very nearly the
 * same size, so the figure was neither a saving nor a cost — just the sum of a
 * column already on every row.
 *
 * What varies between these files is the enhancement layer, which is why it is
 * also what the tab can be cut by: a MEL loses nothing at all in the rewrite,
 * and a simple FEL loses refinement rather than picture. Two counts against the
 * total, most-is-nothing-lost first.
 *
 * There was a third — the files whose layer no pass has read yet — and it was
 * the remainder rather than a reading: whatever the first number is, less the
 * two after it. Grouping the list by layer answers the same question about the
 * films it is actually about, and each row says what its own layer is.
 *
 * Both are drawn at zero rather than dropped, unlike the counts on the cleanup
 * band. A zero here is an answer and often the best one: no FELs at all means
 * every conversion on this tab loses nothing whatsoever. Dropped, that reads as
 * the app having nothing to say about the layer — and a band whose columns come
 * and go is one you have to re-read each visit to see what it is showing.
 *
 * How many have been read end to end is not up here. It is a fact about how
 * long a click takes rather than about the backlog, it is said on every row
 * that has it — and the rows can be ranked and cut by it, which is where a
 * question about which files answers better than a single number ever did.
 */
export function DoviStats({
  tasks,
  action,
}: {
  tasks: DoviTask[];
  /** What to do with them, while a selection is being made — see `DoviRun`. */
  action?: React.ReactNode;
}) {
  // Zero chosen is a reading rather than an absence, the way it is on the audio
  // band: it is what pressing Start right now would come to.
  if (tasks.length === 0 && !action) return null;

  const mel = tasks.filter((task) => task.el === "mel").length;
  const fel = tasks.filter((task) => task.el === "simple-fel").length;

  return (
    <Stats action={action}>
      <Stat label="Files" value={tasks.length.toLocaleString("en-GB")} />
      {/* The tools' own names, as on the chips down the rows, with the gloss in
          the tooltip both places take from the same table. */}
      <Stat
        label="MEL"
        value={mel.toLocaleString("en-GB")}
        title={EL_TITLE.mel}
      />
      <Stat
        label="FEL"
        value={fel.toLocaleString("en-GB")}
        title={EL_TITLE["simple-fel"]}
      />
      {/* No "Layer unread" fourth. It was the remainder of the two above it —
          the files whose enhancement layer nothing has looked at yet — and a
          total that is only ever "the rest" says less than subtracting two
          numbers from the first one does. What it stood for is still asked
          where it can be acted on: the grouping cuts the list along it, and
          each row says what its own layer is. */}
    </Stats>
  );
}

/**
 * Start the conversion of every film ticked, one after another.
 *
 * The one control on this page that starts work it cannot describe in advance.
 * Half these films have never been read end to end, and for those a conversion
 * is two jobs — the full pass that settles whether converting would clip
 * anything, then the rewrite — with the first able to rule the second out. So
 * the dialog says what a run actually is rather than promising twelve
 * conversions: some of these are checks, and a check that says no is the run
 * doing its job.
 *
 * Everything is decided film by film as the run reaches it, with the reading in
 * hand. See lib/dovi-run.ts, which is where the run lives — on the server,
 * because twelve conversions is a day of disk and the tab that asked for them
 * will have been closed long before the end.
 */
export function DoviRun({
  tasks,
  all,
  keepingEl,
  onChoose,
  onDone,
}: {
  /** The films ticked, in the order the list draws them and will run them. */
  tasks: DoviTask[];
  /** Everything that could be ticked, for the button that ticks the lot. */
  all: DoviTask[];
  /** Whether a conversion keeps the enhancement layer it discards. */
  keepingEl: boolean;
  onChoose: (next: ReadonlySet<string>) => void;
  onDone: () => void;
}) {
  const { jobs, apply } = useJobs();
  const { dovi: pass, convert, strip } = jobs;
  const [asking, setAsking] = useState(false);
  const shown = useClosing(asking);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One rewrite at a time, which the server enforces anyway — the button says
  // so rather than letting Start find out. A track removal counts: it is the
  // same drive and the same file being rewritten by a different tool.
  const busy =
    pass.status === "running" ||
    convert.status === "running" ||
    strip.status === "running"
      ? "Something is already rewriting a file — wait for it"
      : undefined;

  /** How many of them begin with a read, which is what makes a run long. */
  const reads = tasks.filter((task) => !task.scanned).length;

  async function start() {
    setError(null);
    setStarting(true);
    const result = await beginConvertBatch(tasks.map((task) => task.path));
    setStarting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    // What the first film is doing, said here so the rows move on the click
    // rather than at the stream's next event. Which of the two jobs that is
    // depends on whether anything has read it — the same question the run
    // itself asks first.
    const [first] = tasks;
    apply(
      first.scanned
        ? {
            convert: {
              status: "running",
              mode: "convert",
              path: first.path,
              step: 1,
              steps: 4,
              percent: 0,
            },
          }
        : {
            dovi: {
              status: "running",
              path: first.path,
              percent: 0,
              frames: 0,
            },
          },
    );
    setAsking(false);
    onDone();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {/* All three stand for as long as the mode does, greyed where they would
          do nothing — a control that moves while you are reaching for it is
          worse than one that is plainly unavailable. */}
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onChoose(new Set(all.map((task) => task.path)))}
          disabled={starting || all.length === 0 || tasks.length === all.length}
          title={
            all.length === 0
              ? "Every film here is on a drive that is not connected"
              : "Tick every film on the list"
          }
          className={BUTTON.secondary}
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => onChoose(new Set())}
          disabled={starting || tasks.length === 0}
          className={BUTTON.secondary}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => setAsking(true)}
          disabled={Boolean(busy) || starting || tasks.length === 0}
          title={busy ?? "Convert these films, one after another"}
          className={BUTTON.primary}
        >
          {starting && <Spinner />}
          Start
        </button>
      </div>

      {error && (
        <p className="max-w-sm text-right text-xs wrap-anywhere text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {shown && (
        <ConfirmModal
          open={asking}
          title={`Convert ${tasks.length} ${
            tasks.length === 1 ? "film" : "films"
          }?`}
          confirmLabel={starting ? "Starting" : "Start the run"}
          busy={starting}
          onConfirm={start}
          onCancel={() => setAsking(false)}
        >
          Each is rewritten in place and its Profile 7 original kept beside it,
          so any of them can be undone from the film&rsquo;s own page.{" "}
          {keepingEl &&
            "Each enhancement layer is set aside in an archive of its own first, so it survives deleting that original. "}
          {reads > 0 &&
            `${
              reads === tasks.length
                ? reads === 1
                  ? "It"
                  : "Every one of them"
                : `${reads} of them`
            } ${
              reads === 1 && reads === tasks.length ? "has" : "have"
            } to be read end to end first, which is the long part — and a read that finds an enhancement layer worth keeping takes that film out of the run rather than converting it. `}
          They run one at a time, in the order they are listed. Leaving this
          page will not stop them.
        </ConfirmModal>
      )}
    </div>
  );
}

/** The rows in the order this list draws them — see `audioOrder`, its twin. */
export const doviOrder = (
  tasks: DoviTask[],
  sort?: string,
  group?: string,
): DoviTask[] =>
  orderedBy(
    [...tasks].sort(pickSort(DOVI_SORTS, sort).compare),
    pickGroup(DOVI_GROUPS, group),
  );

export function DoviTasks({
  tasks: unsorted,
  keepingEl,
  sort,
  group,
  layout,
  selecting = false,
  chosen,
  onChoose,
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
  /** Posters or rows — the fourth thing the listing bar asks. */
  layout: Layout;
  /** Whether the header's Select button is on — see `SelectFilms`. */
  selecting?: boolean;
  /** The films ticked, by path, and the way to change them. */
  chosen: ReadonlySet<string>;
  onChoose: (next: ReadonlySet<string>) => void;
}) {
  const tasks = [...unsorted].sort(pickSort(DOVI_SORTS, sort).compare);
  const grouping = pickGroup(DOVI_GROUPS, group);
  // The rows in the order the page draws them, which is what a shift-held
  // click runs along.
  const order = orderedBy(tasks, grouping);
  const keys = order.map((task) => task.path);
  /** The last row ticked by hand, which is what a shift-click measures from. */
  const anchor = useRef<number | null>(null);

  const { jobs, apply } = useJobs();
  const { dovi: pass, convert } = jobs;

  /**
   * The two calls that start the work, and everything that follows them.
   *
   * Shared with the dashboard's own copy of this queue — see
   * app/dovi-convert.tsx, which is where the check-then-convert hand-off and
   * the single-rewrite-at-a-time rule now live. What is left here is the list:
   * which rows are ticked, which one is being read, and which one a cross is
   * being pressed on.
   */
  const { busy, queued, starting, error, setError, notice, check, run } =
    useDoviConvert();

  /** The film a Convert button is asking about. */
  const [asking, setAsking] = useState<DoviTask | null>(null);
  const shown = useClosing(asking !== null);
  /**
   * And the one a tile's cross is asking about.
   *
   * Its own question rather than a second use of `asking`: that one starts a
   * job and this one ends the job already going, and a dialog that has to work
   * out which of the two it is from the state around it is a dialog that will
   * one day say the wrong thing. The app asks before it interrupts anything
   * running, wherever the press was made — the rail's Stop asks too.
   */
  const [halting, setHalting] = useState<DoviTask | null>(null);
  const haltShown = useClosing(halting !== null);
  const [stopping, setStopping] = useState(false);
  /**
   * And the film whose tile has been opened, read whole.
   *
   * Three dialogs for one list, each asking a different question: this one is
   * "what am I looking at", the next is "are you sure" and the last is "stop
   * it". Pressing through from here closes this one first — a dialog stacked on
   * a dialog is a dialog you cannot see the edge of.
   */
  const [reading, setReading] = useState<DoviTask | null>(null);
  const read = useLingering(reading);
  /**
   * Ends whichever of the two jobs this film is in the middle of.
   *
   * A read and a rewrite are stopped by different calls and neither knows about
   * the other, so which one to end is read off the same state the tile drew
   * itself from. Both leave the file as it was: a read writes nothing, and a
   * conversion keeps the original beside the half-written copy it abandons.
   */
  async function halt(task: DoviTask) {
    setError(null);
    setStopping(true);

    if (convert.status === "running" && convert.path === task.path) {
      await stopConvert().then((job) => apply({ convert: job }));
    } else if (pass.status === "running" && pass.path === task.path) {
      await stopFullDoviScan().then((job) => apply({ dovi: job }));
    }

    setStopping(false);
    setHalting(null);
  }

  const ticked = (task: DoviTask) => selecting && chosen.has(task.path);

  function pick(index: number, range: boolean) {
    const from = anchor.current;
    anchor.current = index;

    const next = tickRows(chosen, keys, index, from, range);
    // A run dragged across an offline row must not take it: the box on that row
    // refuses by hand, and a shift-click is the same decision made faster.
    for (const task of order) if (task.offline) next.delete(task.path);
    onChoose(next);
  }

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
      <DoviNotices error={error} notice={notice} />

      <Grouped items={tasks} group={grouping} note={filmsNote}>
        {(rows, offset) => (
          <TaskList layout={layout}>
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

              /**
               * The one thing this list offers, as the rows draw it.
               *
               * Bordered rather than filled: twelve filled buttons down a list
               * is a column of black blobs, and the emphasis the console's own
               * button earns comes from being the one thing on that page.
               *
               * The width comes from whatever holds it and not from the word in
               * it, because a list where some say Check and some say Convert
               * was a ragged edge of pills, each a different size for a reason
               * nobody reading a column of them can see.
               *
               * Rows only now. The word is worth its line here — Check and
               * Convert are different promises, and a row has room to say which
               * — but under a poster it was a pill in a grid of pictures, and
               * the tile says it as a mark in the corner instead, with the
               * whole sentence on the tooltip. See `TileMark`.
               */
              const convertButton = (
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
                  className={`${BUTTON.secondary} w-full`}
                >
                  {checkFirst ? "Check" : "Convert"}
                </button>
              );

              /** What the job is doing, in the words the row prints under it. */
              const stage = converting
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
                  : "Starting the conversion…";

              return (
                <TaskItem
                  key={task.path}
                  layout={layout}
                  task={task}
                  index={i}
                  /*
                   * In the choosing mode the tile is the box, and the film's
                   * own page is a press of Cancel away. One already being
                   * worked on answers neither: it is not waiting to be chosen.
                   *
                   * Otherwise a poster opens what the tile could not fit — see
                   * `DoviDetails`. Only a poster: a row prints every line that
                   * dialog holds, so its click stays the film's page, which is
                   * where somebody reading the long form was going anyway.
                   */
                  onOpen={
                    selecting && !active
                      ? (range) => pick(i, range)
                      : layout === "grid" && !active
                        ? () => setReading(task)
                        : undefined
                  }
                  chosen={ticked(task)}
                  selecting={selecting && !active}
                  tick={{
                    checked: ticked(task),
                    disabled: task.offline,
                    refusal: task.offline
                      ? "The drive this file lives on is not connected"
                      : undefined,
                    hint: "Shift-click to tick a run of films",
                    onTick: (range) => pick(i, range),
                    label: `Convert ${task.title}`,
                  }}
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
                  // The same facts as the library card's own muted line: what a
                  // file *is*, joined by middle dots. They are chips in a row,
                  // where they stand among prose and have to be picked out of
                  // it; a shelf of posters with two outlined boxes under every
                  // one reads as a form rather than a shelf.
                  //
                  // The sentence about what a click will cost goes with them —
                  // on a tile that is the button's own tooltip, and the one part
                  // of it worth carrying is the plate on the poster instead.
                  // No "Profile 7" among them. Every file on this tab is one —
                  // that is what puts it here — so it was a word printed under
                  // every poster that told you nothing about the one you were
                  // looking at. What differs film to film is the layer and the
                  // size, and those are what is left.
                  facts={[task.el && EL_LABEL[task.el], size(task.sizeBytes)]}
                  factsTitle={task.el ? EL_TITLE[task.el] : undefined}
                  /*
                   * No plate saying "Read".
                   *
                   * It marked the films whose frames have already been read —
                   * the ones that convert without a pass first. But that is a
                   * fact about how long the press will take, not about the
                   * film, and it was drawn as a label on the artwork where it
                   * read as a tag the film wears. The mark that starts the job
                   * says it instead, in its tooltip, at the moment you are
                   * deciding to press it. The row still prints it in words.
                   */
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
                          {stage}
                        </p>
                      </>
                    ) : undefined
                  }
                  /*
                   * Top right, where a tile keeps the one thing it is about:
                   * the job, started or stopped. The word under the poster is
                   * the row's — see `TileMark`.
                   */
                  badge={
                    active ? (
                      <TileMark
                        kind="stop"
                        label={`Stop converting ${task.title}`}
                        title="Stop this — the original is kept either way"
                        onPress={() => setHalting(task)}
                      />
                    ) : (
                      <TileMark
                        kind="start"
                        label={`${checkFirst ? "Check" : "Convert"} ${task.title}`}
                        disabled={busy || task.offline}
                        busy={starting && asking?.path === task.path}
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
                        onPress={() => {
                          // A check writes nothing, so it runs on the click.
                          // Only the rewrite is worth stopping to confirm.
                          if (checkFirst) void check(task);
                          else setAsking(task);
                        }}
                      />
                    )
                  }
                  /*
                   * The foot of the poster, drawn the way a transfer in flight
                   * is drawn — a plate over a white bar. Same question, same
                   * answer: how far through is this, read at a glance across a
                   * shelf. See app/downloads/downloads-view.tsx.
                   *
                   * The plate says the short of it and carries the whole
                   * sentence — which step, which tool, how many frames — on its
                   * tooltip, because a poster is a hundred and eighty pixels
                   * wide and the row already prints the long form.
                   */
                  status={
                    active ? (
                      <>
                        <span
                          className={`${TILE_READING} max-w-full self-start truncate`}
                          title={stage}
                        >
                          {Math.round(percent)}% ·{" "}
                          {converting
                            ? "converting"
                            : reading
                              ? "reading frames"
                              : "starting"}
                        </span>
                        <div className="bar-track bar-track-thin bar-over">
                          <div
                            className="bar-fill motion-safe:transition-[width] motion-safe:duration-500"
                            style={{ width: `${Math.min(100, percent)}%` }}
                          />
                        </div>
                      </>
                    ) : undefined
                  }
                  figure={
                    active ? (
                      <span className="text-sm font-medium tabular-nums">
                        {Math.round(percent)}%
                      </span>
                    ) : (
                      convertButton
                    )
                  }
                />
              );
            })}
          </TaskList>
        )}
      </Grouped>

      {/* What a tile could not fit, and the press it was standing in for. */}
      {read && (
        <DoviDetails
          task={read}
          open={reading !== null}
          layer={read.el ? EL_LABEL[read.el] : undefined}
          layerTitle={read.el ? EL_TITLE[read.el] : undefined}
          size={size(read.sizeBytes)}
          checkFirst={checksFirst(read)}
          refusal={doviRefusal(read, busy)}
          href={hrefFor(read)}
          onStart={() => {
            // The details close on the way through, whichever of the two this
            // is: a check runs here and now, a rewrite hands over to the
            // question below.
            setReading(null);
            if (checksFirst(read)) void check(read);
            else setAsking(read);
          }}
          onClose={() => setReading(null)}
        />
      )}

      {shown && asking && (
        <DoviConvertConfirm
          task={asking}
          open={asking !== null}
          keepingEl={keepingEl}
          busy={starting}
          onConfirm={() => void run(asking).then(() => setAsking(null))}
          onCancel={() => setAsking(null)}
        />
      )}

      {/* The other half of the tile's pair. Worded like the rail's Stop,
          because it ends the same job by the same call — what differs is only
          that you pressed it on the film rather than on the bar. */}
      {haltShown && halting && (
        <ConfirmModal
          open={halting !== null}
          title={
            convert.status === "running" && convert.path === halting.path
              ? "Stop the conversion?"
              : "Stop reading the frames?"
          }
          confirmLabel={stopping ? "Stopping" : "Stop"}
          busy={stopping}
          onConfirm={() => halt(halting)}
          onCancel={() => setHalting(null)}
        >
          <span className="font-mono">{halting.fileName}</span> is left exactly
          as it is — a read writes nothing, and a conversion keeps the Profile 7
          original beside the copy it abandons. Anything a run had not reached
          goes back to the list.
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
    // Both kinds, because both go in the one remux the row starts.
    compare: (a, b) =>
      b.removing + b.removingSubtitles - (a.removing + a.removingSubtitles) ||
      b.freedBytes - a.freedBytes,
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
  /*
   * First, and so the tab's own default — see `pickGroup`.
   *
   * This is the only list of the three whose rows arrive in runs: a series
   * ripped in one go is forty files with the same tracks to lose, and ungrouped
   * they are forty rows scattered through the list by size. Cut this way the
   * page opens as what it actually is — the films, then each show that has
   * something to strip.
   */
  {
    key: "kind",
    label: "Films and shows",
    of: filmsOrShow,
    order: FILMS_FIRST,
  },
  { key: "none", label: "No grouping", of: () => "" },
  { key: "title", label: "Show or film", of: (task) => task.title },
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

/**
 * The rows in the order the audio list draws them: sorted, then cut into the
 * groups the page is showing and read back out flat.
 *
 * Exported because two places need the same answer and it has to be the same
 * answer. The list needs it to know what a shift-held click runs along; the
 * page needs it to know what order a run of removals happens in, which is the
 * order they are read in — a queue that ran the list back to front would be a
 * queue nobody could follow down the page.
 */
export const audioOrder = (
  tasks: AudioTask[],
  sort?: string,
  group?: string,
): AudioTask[] =>
  orderedBy(
    [...tasks].sort(pickSort(AUDIO_SORTS, sort).compare),
    pickGroup(AUDIO_GROUPS, group),
  );

/**
 * What the audio tab adds up to, drawn above the pending list rather than
 * inside it.
 *
 * Split out of `AudioTasks` for where it has to sit: the figures describe the
 * whole tab, and reading them under the heading of one of its sections said
 * they belonged to that section. Its own component rather than a slot, because
 * the page that places it does not otherwise know what an audio task is.
 *
 * Nothing to say about an empty tab — the list's own empty state is the answer
 * there, and a row of zeroes above it would be a second one.
 */
export function AudioStats({
  tasks,
  action,
}: {
  tasks: AudioTask[];
  /**
   * What to do about the figures, where there is something.
   *
   * The band is the one place on this tab that describes a set of films rather
   * than a film, so it is where a button that acts on a set belongs — see
   * `AudioRun`, which fills this while the list is being ticked. It is also
   * what holds the band open on an empty selection: a run about to be started
   * on nothing still has to be able to say so.
   */
  action?: React.ReactNode;
}) {
  // Nothing to say about an empty tab — the list's own empty state is the
  // answer there, and a row of zeroes above it would be a second one.
  //
  // A selection is the other case entirely. Zero chosen is a reading rather
  // than an absence: it is what pressing Start right now would come to, and the
  // figures climbing off it as the ticks land is what makes the band answer the
  // question being asked of it.
  if (tasks.length === 0 && !action) return null;

  const total = tasks.reduce((sum, task) => sum + task.freedBytes, 0);
  const anyEstimated = tasks.some((task) => task.estimated);
  const trackCount = tasks.reduce(
    (sum, task) => sum + task.removing + task.removingSubtitles,
    0,
  );
  // Canonical, so the "fre" on one rip and the "fr" on the next are one
  // language here as they are in the setting that decided both.
  const languages = new Set(
    tasks.flatMap((task) => task.languages.map(languageKey)),
  );

  return (
    <Stats action={action}>
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
        // Nothing chosen yet is nothing to name, and an empty tooltip is a
        // tooltip that opens on a blank box.
        title={
          languages.size
            ? [...new Set([...languages].map(languageName))].sort().join(", ")
            : undefined
        }
      />
    </Stats>
  );
}

/**
 * What to do with the films that have been ticked, beside the figures for them.
 *
 * In the stats band rather than over the list, because the band is now the
 * count: "7 films chosen · frees 63.4 GB" printed on a bar of its own was the
 * same two numbers the tiles were already showing, said again in a smaller
 * voice a few pixels underneath. So the tiles follow the selection and this is
 * only the button — Start reads as the answer to the figures it stands next to,
 * which is what it is.
 *
 * It runs the proposal each row was already showing — every track in a language
 * you do not keep — because that is what the figure on the row is the price of.
 * Disagreeing with one of them is what the dialog is for, and it is a press of
 * Cancel and a click away.
 */
export function AudioRun({
  tasks,
  all,
  onChoose,
  onDone,
}: {
  /** The films ticked, in the order the list draws them and will run them. */
  tasks: AudioTask[];
  /** Everything that could be ticked, for the button that ticks the lot. */
  all: AudioTask[];
  onChoose: (next: ReadonlySet<string>) => void;
  /** Leaves the choosing mode, once a run has been started out of it. */
  onDone: () => void;
}) {
  const { jobs, apply } = useJobs();
  const { strip, convert, dovi: pass } = jobs;
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One rewrite at a time, which the server enforces anyway — the button says
  // so rather than letting Start find out.
  const busy =
    strip.status === "running" ||
    convert.status === "running" ||
    pass.status === "running"
      ? "Something is already rewriting a file — wait for it"
      : undefined;

  async function start() {
    setError(null);
    setStarting(true);

    const result = await beginStripBatch(
      tasks.map((task) => ({
        path: task.path,
        removeOrdinals: [...task.proposed].sort((a, b) => a - b),
        audioCount: task.tracks.length,
        // The Matroska numbers as this list has them, for the server to check
        // against what mkvmerge reports before it rewrites anything — the same
        // guard the single-file dialog sends.
        numbers: task.tracks.map((track) => track.number),
        // Sent whenever the file has text tracks at all, ticked or not: the
        // count is what tells the server the list and the file still agree
        // about this half too.
        ...(task.subtitles.length > 0 && {
          removeSubtitleOrdinals: [...task.proposedSubtitles].sort(
            (a, b) => a - b,
          ),
          subtitleCount: task.subtitles.length,
          subtitleNumbers: task.subtitles.map((track) => track.number),
        }),
        freedBytes: task.freedBytes || undefined,
      })),
    );
    setStarting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.skipped > 0) {
      setError(
        `${result.skipped} of the films chosen could not be started — they have changed since this list was drawn. The rest are running.`,
      );
    }

    // The first one is under way and the others are behind it, said here so the
    // rows move the moment the button is pressed rather than at the stream's
    // next event. See `apply`.
    const [first, ...waiting] = tasks;
    apply({
      strip: {
        status: "running",
        path: first.path,
        percent: 0,
        removed: first.proposed.length,
        kept: first.tracks.length - first.proposed.length,
        removedSubtitles: first.proposedSubtitles.length,
        keptSubtitles: first.subtitles.length - first.proposedSubtitles.length,
        freedBytes: first.freedBytes || undefined,
        ...(waiting.length && {
          batch: { index: 1, total: tasks.length, failed: 0 },
          queue: waiting.map((task) => task.path),
        }),
      },
    });

    // Out of the mode, because what it was for has happened. The rows the ticks
    // were on are under Running and Queued now, and the boxes would be standing
    // open over whatever is left.
    onDone();
  }

  return (
    // Ranged right and off the top, so the buttons stand on the same line the
    // tiles' labels do rather than centring themselves against figures that are
    // twice their height.
    <div className="flex flex-col items-end gap-2">
      {/* All three stand for as long as the mode does, greyed where they would
          do nothing. They were drawn only when they had something to do, which
          meant the row rearranged itself under the pointer as you ticked — and
          Select all vanished on the click that happened to complete the set,
          which on a list with a couple of unreachable drives in it can be the
          first one. A control that moves while you are reaching for it is worse
          than one that is plainly unavailable. */}
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onChoose(new Set(all.map((task) => task.path)))}
          disabled={starting || all.length === 0 || tasks.length === all.length}
          title={
            all.length === 0
              ? "Every film here is on a drive that is not connected"
              : "Tick every film on the list"
          }
          className={BUTTON.secondary}
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => onChoose(new Set())}
          disabled={starting || tasks.length === 0}
          className={BUTTON.secondary}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={start}
          disabled={Boolean(busy) || starting || tasks.length === 0}
          title={
            busy ??
            "Removes the tracks each row proposes, one film at a time. The original of each is kept beside it."
          }
          className={BUTTON.primary}
        >
          {starting && <Spinner />}
          Start
        </button>
      </div>

      {error && (
        <p className="max-w-sm text-right text-xs wrap-anywhere text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The films a run has been started on and has not reached yet.
 *
 * Their own section rather than rows left in the pending list, for the reason
 * the running file leaves that list at all: they have been acted on, and a row
 * offering to start what is already started is a row that would start it twice.
 * Drawn in the order they will run, which is the one thing this list says that
 * the pending list's own order cannot.
 *
 * Nothing to tick and no dialog: what these are going to do was decided when
 * Start was pressed. A click opens the film, which is where anyone wondering
 * what is about to happen to it would go.
 */
export function AudioQueued({
  tasks,
  layout,
}: {
  tasks: AudioTask[];
  layout: Layout;
}) {
  return (
    <TaskList layout={layout}>
      {tasks.map((task, index) => (
        <TaskItem
          key={task.path}
          layout={layout}
          task={task}
          index={index}
          chips={
            <span className="min-w-0 truncate text-xs opacity-40">
              {languageLine(task.languages)} · {size(task.sizeBytes)} file
            </span>
          }
          facts={[languageLine(task.languages), `${size(task.sizeBytes)} file`]}
          figure={
            <>
              <span className="text-sm font-medium tabular-nums opacity-55">
                {task.estimated ? "≈" : "−"}
                {size(task.freedBytes)}
              </span>
              {/* Its place in the run, where the pending row says what the
                  figure above is: a queue is an order, and the only question
                  a row in one raises is when. */}
              <span className="text-xs opacity-40">
                {index === 0 ? "next" : `${index + 1}${ordinal(index + 1)}`}
              </span>
            </>
          }
          // The place leads on a tile, where the row leads with the saving.
          // Nothing here is being offered — what these will do was settled when
          // Start was pressed — so the only live question is when, and that is
          // the corner every other tile in the app puts its reading in.
          badge={
            <span className={TILE_READING}>
              {index === 0 ? "next" : `${index + 1}${ordinal(index + 1)}`}
            </span>
          }
          note={
            <span className={TILE_NOTE}>
              {task.estimated ? "≈" : "−"}
              {size(task.freedBytes)}
            </span>
          }
        />
      ))}
    </TaskList>
  );
}

/**
 * The same section for a run of conversions.
 *
 * The figure says how long rather than how much: nothing on this tab saves
 * space, so the row's own size is what a wait is measured in — and whether the
 * film has been read end to end, which is the difference between one job and
 * two on it.
 */
export function DoviQueued({
  tasks,
  layout,
}: {
  tasks: DoviTask[];
  layout: Layout;
}) {
  return (
    <TaskList layout={layout}>
      {tasks.map((task, index) => (
        <TaskItem
          key={task.path}
          layout={layout}
          task={task}
          index={index}
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
                  : " · every frame is read first"}
              </span>
            </>
          }
          facts={[
            "Profile 7",
            task.el && EL_LABEL[task.el],
            size(task.sizeBytes),
          ]}
          factsTitle={task.el ? EL_TITLE[task.el] : undefined}
          figure={
            <span className="text-xs opacity-40">
              {index === 0 ? "next" : `${index + 1}${ordinal(index + 1)}`}
            </span>
          }
          badge={
            <span className={TILE_READING}>
              {index === 0 ? "next" : `${index + 1}${ordinal(index + 1)}`}
            </span>
          }
          // How long the wait in front of this one is, which on this tab is the
          // only thing that varies: a film already read converts straight away,
          // and one that is not spends the first half of its turn being read.
          note={
            <span
              className={TILE_NOTE}
              title={
                task.scanned
                  ? "Every frame has been read"
                  : "Every frame is read before this one is converted"
              }
            >
              {task.scanned ? "Read" : "Reads first"}
            </span>
          }
        />
      ))}
    </TaskList>
  );
}

/** st, nd, rd, th — for a place in a queue rather than a date. */
function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

/**
 * The button that puts the list into choosing rows rather than reading them.
 *
 * In the bar over the page rather than on the list: it is a statement about the
 * whole tab, and a control that turns forty rows into checkboxes is not
 * something to come across halfway down them.
 *
 * A mode at all — rather than boxes that are simply always there — because
 * ticking films is the rarer of the two things this list is for. Most visits
 * are one film, opened, argued with and started; a box in the corner of every
 * row would be furniture on all of them for the sake of the other visit.
 *
 * A mark rather than a word, and outlined rather than filled: this only opens a
 * way of asking, and a solid button in that slot would have made "select" look
 * like the thing this page is for. It shared the slot with the cleanup tab's
 * Clean all until that went; what it says of itself has not changed.
 *
 * The icon changes rather than a label under it. Off, it is a list with ticks
 * beside it, which is what pressing it produces; on, it is the cross every
 * dialog in the app is left by, because that is now the whole of what it does.
 */
export function SelectFilms({
  selecting,
  onToggle,
  what,
}: {
  selecting: boolean;
  onToggle: () => void;
  /**
   * What a tick means on this list, in a phrase.
   *
   * All three tabs wear this button and none of them mean the same thing by
   * it: one converts, one strips tracks, one deletes. An icon cannot say which,
   * so the sentence it carries has to — and it is the tab's sentence, not this
   * button's.
   */
  what: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selecting}
      aria-label={selecting ? "Stop choosing" : "Choose several"}
      title={selecting ? "Leave the boxes, and what is ticked in them" : what}
      // Written out rather than composed from `BUTTON.secondary` and a width:
      // that one carries its own `px-4`, and two paddings in one class string
      // are settled by Tailwind's emit order rather than by which was written
      // last — the same reason `BUTTON.dangerStanding` is spelled out in full.
      //
      // Square at the bar's own height, for the reason the cleanup tab's button
      // takes it: three controls on one line, one of them eight pixels shorter,
      // reads as something that wandered in.
      className={`grid ${CONTROL_H} w-10 shrink-0 place-items-center rounded-full border border-line transition-colors ${
        // Held down while the mode is on. An icon button that only changes its
        // picture is a button you have to remember the meaning of; one that is
        // visibly pressed says which of the two states you are in.
        selecting ? "bg-surface-strong" : "hover:bg-surface-strong"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="h-4 w-4 opacity-70"
      >
        {selecting ? (
          <path d="M6 6l12 12M18 6L6 18" />
        ) : (
          <>
            <path d="m3 7 2 2 4-4" />
            <path d="M13 8h8" />
            <path d="m3 17 2 2 4-4" />
            <path d="M13 18h8" />
          </>
        )}
      </svg>
    </button>
  );
}

export function AudioTasks({
  tasks: unsorted,
  sort,
  group,
  layout,
  selecting = false,
  chosen,
  onChoose,
}: {
  tasks: AudioTask[];
  sort?: string;
  group?: string;
  /** Posters or rows — the fourth thing the listing bar asks. */
  layout: Layout;
  /** Whether the header's Select button is on — see `SelectFilms`. */
  selecting?: boolean;
  /**
   * The films ticked, by path, and the way to change them.
   *
   * Held by the page rather than here, with the mode it belongs to: the button
   * that turns the boxes off is up in the bar, and it has to be able to drop
   * what they held. By path rather than by index because this list is
   * re-sorted, re-cut and re-rendered from the server every time a job ends —
   * an index survives none of that.
   */
  chosen: ReadonlySet<string>;
  onChoose: (next: ReadonlySet<string>) => void;
}) {
  const tasks = [...unsorted].sort(pickSort(AUDIO_SORTS, sort).compare);
  const grouping = pickGroup(AUDIO_GROUPS, group);
  // The rows in the order the page draws them, which is what a shift-held
  // click runs along — a grouping cuts the sorted list into sections, and the
  // order down the page is no longer the order of the array above. The same
  // answer `audioOrder` gives the page, arrived at the same way.
  const order = orderedBy(tasks, grouping);

  const { jobs, subscribe } = useJobs();
  const { strip, convert, dovi: pass } = jobs;
  const router = useRouter();

  /** The file whose tracks are being chosen, or none. */
  const [asking, setAsking] = useState<AudioTask | null>(null);
  // Held past the click that closes it, so the dialog plays out rather than
  // blanking a frame before it has finished leaving.
  const held = useLingering(asking);
  const [error, setError] = useState<string | null>(null);

  /** The last row ticked by hand, which is what a shift-click measures from. */
  const anchor = useRef<number | null>(null);

  // Only the edge out of a removal counts, for the reason the conversions give
  // above: the server reports "done" forever after, so a status alone cannot
  // mean "just finished".
  //
  // A run of them has a second edge, and it is the one that matters most of the
  // time: the file being worked on changing. The server takes the next film the
  // moment the one before it ends, and the snapshots the two states would have
  // arrived in are coalesced into one — so the status never appears to leave
  // "running" between the first film and the last, and a list waiting on that
  // would repaint once, hours in. The path is what changed.
  useEffect(
    () =>
      subscribe((next, prev) => {
        const ended =
          prev.strip.status === "running" && next.strip.status !== "running";
        const moved =
          next.strip.status === "running" &&
          next.strip.path !== prev.strip.path;

        if (!ended && !moved) return;

        // A failure inside a run is not the end of the run — the server takes
        // the next film regardless — so it is said and the list still repaints
        // around it. The films that did work have left it.
        if (next.strip.status === "error") {
          setError(next.strip.error ?? "Removing the tracks failed");
        }
        // The job re-probes and re-derives the rewritten file itself, so the
        // list only needs repainting — and the row leaves it, because what it
        // proposed has happened and the original is now the cleanup tab's.
        if (next.strip.status !== "error") router.refresh();
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

  /**
   * What is ticked, read back off the list rather than out of the set.
   *
   * A film whose removal has just finished is gone from `tasks` and still in
   * `chosen`, and a count taken from the set would go on including it. Read
   * this way a tick means "this row, while it is here" — which is the only
   * thing it can honestly mean on a list the server keeps replacing.
   *
   * And nothing at all with the boxes away: a tick nobody can see is not a
   * choice anybody is making.
   */
  const ticked = (task: AudioTask) => selecting && chosen.has(task.path);

  const keys = order.map((task) => task.path);

  function pick(index: number, range: boolean) {
    const from = anchor.current;
    anchor.current = index;

    const next = tickRows(chosen, keys, index, from, range);
    // A run dragged across an offline row must not take it: the box on that row
    // refuses by hand, and a shift-click is the same decision made faster.
    for (const task of order) if (task.offline) next.delete(task.path);
    onChoose(next);
  }

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

  return (
    <section className="flex flex-col gap-8">
      {error && (
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <Grouped items={tasks} group={grouping} note={freedNote}>
        {(rows, offset) => (
          <TaskList layout={layout}>
            {rows.map((task, index) => (
              <TaskItem
                key={task.path}
                layout={layout}
                task={task}
                index={offset + index}
                // The tracks are chosen here rather than on the film's page.
                //
                // No running state on these rows: a file being rewritten is not
                // pending, so the jobs page takes it out of this list for as
                // long as the removal lasts and draws it under Running instead.
                // See `inFlight` in ./jobs-view.tsx.
                //
                // In the choosing mode the row is the box: an eighteen-pixel
                // square is a poor target for a gesture whose whole point is
                // doing it a dozen times, and every list that has ever offered
                // this has let the row itself answer. The dialog is a press of
                // Cancel away, which is where somebody wanting one film's
                // tracks rather than all of them was headed anyway.
                //
                // Every row, including the ones that cannot go: `pick` drops a
                // film whose drive is away, so the click simply does not take —
                // which is a truer answer than a dialog opening in the middle
                // of a mode that is not about dialogs. The box on that row
                // carries the reason.
                onOpen={
                  selecting
                    ? (range) => pick(offset + index, range)
                    : () => setAsking(task)
                }
                chosen={ticked(task)}
                selecting={selecting}
                tick={{
                  // The proposal, taken as read. A film ticked here is one
                  // whose figure you agreed with; a film you want to argue with
                  // is the same one opened rather than ticked.
                  checked: ticked(task),
                  disabled: task.offline,
                  refusal: task.offline
                    ? "The drive this file lives on is not connected"
                    : undefined,
                  hint: "Shift-click to tick a run of films",
                  onTick: (range) => pick(offset + index, range),
                  label: `Remove the proposed tracks from ${task.title}`,
                }}
                chips={
                  // No count chip. What is going is named — the languages — and
                  // what it is worth is the figure on the right; "8 of 9 tracks"
                  // sat between them saying neither.
                  <span className="min-w-0 truncate text-xs opacity-40">
                    {languageLine(task.languages)} · {size(task.sizeBytes)} file
                  </span>
                }
                // The languages, and only those. The file's own size was the
                // second half of this line and a size in the corner above it —
                // two figures in gigabytes on one tile, and at a glance the
                // pair read as the same fact said twice. The corner keeps the
                // one this tab is about; the row still prints both.
                facts={[languageLine(task.languages)]}
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
                // What this tab is ranked by, in the corner every tile in the
                // app keeps for its reading. On a plate rather than white over
                // the artwork, because it is a measurement and not a mark: the
                // green is what makes it a saving, and green over a bright
                // poster is the one thing `OVER_ART` cannot carry.
                badge={
                  // No minus and no green. A tab called Strip Tracks, ranked by
                  // what it frees, does not need the one figure on the tile
                  // coloured to say it is a saving — the tab is the context,
                  // and the sign read as part of the number. In the theme's own
                  // ink, which is what the cleanup tab's identical badge has
                  // always used. The `≈` stays: not decoration, but a caveat
                  // about the number itself.
                  <span
                    className={SCORE_PLATE_ROOMY}
                    title={
                      task.estimated
                        ? "Part of this total is worked out from bitrate rather than counted"
                        : "What removing the proposed tracks frees"
                    }
                  >
                    {task.estimated && "≈"}
                    {size(task.freedBytes)}
                  </span>
                }
              />
            ))}
          </TaskList>
        )}
      </Grouped>

      {/* Keyed by the file, so choosing on one row and then another does not
          hand the second film the first one's ticks. */}
      {held && (
        <TrackPicker
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
