"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  forgetDownloadEntry,
  listDownloadLog,
  qbPause,
  qbRemove,
  qbResume,
} from "@/app/actions";
import { Art } from "@/app/art";
import { ConfirmModal } from "@/app/confirm";
import { BUTTON, Fact } from "@/app/controls";
import { EmptyState } from "@/app/empty-state";
import { Grouped, pickGroup, type GroupOption } from "@/app/grouping";
import { ListingBar, useListing, type Choice } from "@/app/listing";
import { CloseButton, Modal, useLingering } from "@/app/modal";
import {
  PosterTile,
  TILE_GRID_RULED,
  TILE_PLATE,
  TILE_READING,
} from "@/app/poster-tile";
import { ScoreBadge, STATUS_THEME } from "@/app/score-circle";
import { Failure } from "@/app/settings/parts";
import { Spinner } from "@/app/spinner";
import { stagger } from "@/app/stagger";
import { RemoveButton, TILE_MARK } from "@/app/tile-button";
import type { DownloadEntry } from "@/lib/qbittorrent";
import { movieId, posterName } from "@/lib/routes";

/**
 * Everything ever handed to qBittorrent, in two tenses.
 *
 * The top half is now: what is moving, how fast, and the controls that change
 * it. The bottom half is the log — finished downloads still seeding, and
 * releases qBittorrent has long forgotten, which only the app's own record can
 * still show. Polled quickly while anything moves, slowly while anything is
 * merely in the client, and not at all once nothing is.
 *
 * This has been three things. A page of its own, one click along the rail from
 * the list of things to send — which made a fetch something you did on one page
 * and watched on another. Then a list drawn around each of those, so a row left
 * the list at the top of a page and turned up in the list underneath; and
 * because a fetch has to come from somewhere, that meant two of them, one per
 * page, each cut to what had been sent off it.
 *
 * It is a page again, and that is the point of it: a fetch is one thing
 * happening whatever list started it, so there is one place it happens. Cut in
 * two, the same question — is that download finished yet — was asked on
 * whichever page you happened to remember pressing the button on, and neither
 * of them could answer for the other. Nothing about a transfer in flight is a
 * fact about the queue or about the wishlist; where it came from is one line on
 * the row, said here along with everything else known about it.
 *
 * Both halves are read as posters or as rows, and each can be ranked — see
 * `SORTS`, which gives them separate menus because the questions are not the
 * same. Only the record is cut, and only one way: whether the fetch finished,
 * which is the one fact about a past download that is different in kind rather
 * than in degree. What is in flight is never cut, so the bar draws no Group
 * button on that tab at all.
 *
 * The two halves are the two tabs of a switch now rather than two sections
 * stacked down the page. See `TABS` for what that cost and what it bought.
 */
const POLL_MS = 3000;

/**
 * The same read, at the pace a finished row deserves: it is waiting on
 * something a person did in another window, not on a transfer. Slow enough
 * that a page of seeded history is not a torrent of requests, quick enough
 * that "it stopped in qBittorrent" and "it says so here" are the same glance.
 */
const IDLE_POLL_MS = 15_000;

const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/**
 * Which list started this fetch, said in that list's own name.
 *
 * Worth a word now that both arrive in one place. It was a prop while the two
 * pages each drew their own half — the page you were standing on was the
 * answer — and with them together an upgrade and a want are the same row until
 * something says otherwise. See `DownloadEntry.source`.
 */
const SOURCE_LABEL = { upgrade: "Upgrade", wishlist: "Wishlist" } as const;

/**
 * The chip a row wears to say which list sent it — the app's own hairline chip,
 * the one the dashboard's System card and every other standing label use.
 *
 * Over artwork the tiles use `TILE_PLATE` instead, which is the same idea on a
 * filled plate: a hairline ring alone disappears against a photograph.
 */
const CHIP =
  "rounded-chip px-2 text-[11px] leading-[20px] font-medium opacity-60 ring-1 ring-line-strong ring-inset";

const speed = (bps: number) =>
  bps >= 1024 ** 2
    ? `${(bps / 1024 ** 2).toFixed(1)} MB/s`
    : `${Math.round(bps / 1024)} KB/s`;

/**
 * The page's two tenses, as the two tabs of the switch every other list page
 * in this app keeps at the head of its row.
 *
 * They were two stacked sections with the record collapsed under a summary
 * line, which left this page's control row holding one button — the layout
 * toggle, alone inside a `Bar` whose whole job is to draw one frame around
 * several controls and rule them apart. A frame around a single thing, floated
 * against an empty half of the row. Every other page here answers that row the
 * same way and this one could not, because it had nothing to put on the left.
 *
 * It had two things all along; they were stacked rather than switched. What is
 * arriving and what has arrived are exactly the two lists a switch is for, and
 * making them tabs is what lets the row be a row.
 *
 * The cost is real and worth stating: you can no longer see both at once. That
 * was the argument for opening the record rather than shutting it — "is that
 * film here yet" is answered as squarely by what has arrived as by what is
 * still arriving. What buys it back is that the tab is remembered in the
 * address like every other listing here, so the half you were reading is the
 * half you come back to.
 */
const TABS = [
  { key: "active", label: "Downloading" },
  { key: "history", label: "History" },
] as const;

type Tab = (typeof TABS)[number]["key"];

/**
 * How each half can be ranked.
 *
 * Newest leads in both, which is the order the log already arrived in — so the
 * page opens exactly as it did before it could be sorted, and every other
 * option is something you asked for.
 *
 * The two halves do not share a menu, because the questions are not the same.
 * A transfer in flight is ranked by how it is doing — how far along, how fast —
 * and neither means anything to a record of one that finished last March. The
 * record gets the two a log wants instead: the far end of it, and the big ones.
 */
const SORTS: Record<Tab, Choice[]> = {
  active: [
    { key: "added", label: "Newest first" },
    { key: "progress", label: "Furthest along" },
    { key: "speed", label: "Fastest" },
    { key: "largest", label: "Largest" },
    { key: "title", label: "Title A–Z" },
  ],
  history: [
    { key: "added", label: "Newest first" },
    { key: "oldest", label: "Oldest first" },
    { key: "largest", label: "Largest" },
    { key: "title", label: "Title A–Z" },
  ],
};

/**
 * What is in flight is never cut, and the bar is told so by being handed one
 * option: `ListingControls` draws no Group button where there is nothing to
 * choose. A transfer is paused or it is moving, and both are on the row.
 */
const ACTIVE_GROUPS: GroupOption<DownloadEntry>[] = [
  { key: "none", label: "No grouping", of: () => "" },
];

/**
 * The record is cut one way, and it is the only cut it has ever wanted: did
 * this fetch finish.
 *
 * Every other fact about a finished download — which list sent it, what it was
 * called, how big it was — is printed on the row and worth ranking by at most.
 * Whether the file actually arrived is different in kind: it is the difference
 * between a record of something you have and a record of something you tried,
 * and a log that reads them as one list makes you check each row to tell which.
 *
 * `completedAt` is the whole test. It is stamped once, the first time the client
 * reports the payload done, and never unset — so a torrent since deleted from
 * qBittorrent still counts as completed, which is right: the file landed, and
 * what happened to the torrent afterwards is a different subject.
 */
const HISTORY_GROUPS: GroupOption<DownloadEntry>[] = [
  { key: "none", label: "No grouping", of: () => "" },
  {
    key: "outcome",
    label: "Outcome",
    of: (entry) => (entry.completedAt ? "Completed" : "Cancelled"),
    // Completed first: it is the larger half of any working setup and the one
    // you came to check. A cancelled fetch is a thing you go looking for.
    order: ["Completed", "Cancelled"],
  },
];

const GROUPS: Record<Tab, GroupOption<DownloadEntry>[]> = {
  active: ACTIVE_GROUPS,
  history: HISTORY_GROUPS,
};

/**
 * The comparators, by the key the menu above names them with.
 *
 * `live` is absent on a row qBittorrent has forgotten, which is most of an old
 * record — so size and progress fall back to nothing and those rows gather at
 * the bottom of the orders that ask about them. That is the honest place for
 * them: the client is the only thing that knew, and it no longer does.
 */
const COMPARE: Record<string, (a: DownloadEntry, b: DownloadEntry) => number> =
  {
    added: (a, b) => b.addedAt - a.addedAt,
    oldest: (a, b) => a.addedAt - b.addedAt,
    largest: (a, b) => (b.live?.sizeBytes ?? 0) - (a.live?.sizeBytes ?? 0),
    progress: (a, b) => (b.live?.progress ?? 0) - (a.live?.progress ?? 0),
    speed: (a, b) => (b.live?.speedBps ?? 0) - (a.live?.speedBps ?? 0),
    title: (a, b) =>
      (a.filmTitle ?? a.title).localeCompare(b.filmTitle ?? b.title),
  };

const eta = (sec?: number) => {
  if (sec === undefined) return undefined;
  if (sec < 90) return `${sec}s left`;
  if (sec < 5400) return `${Math.round(sec / 60)} min left`;
  return `${(sec / 3600).toFixed(1)} h left`;
};

const day = (ts: number) =>
  new Date(ts).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * qBittorrent's state strings, said like a person would.
 *
 * Both halves of the client's vocabulary now. The download states were all a
 * transfer in flight could be, and all this page ever printed — but the record
 * dialog states every fetch it can show, and most of what it shows has finished
 * downloading and is somewhere in the client's *upload* half. "stoppedUP" in a
 * table of facts is the app handing you an enum and asking you to look it up.
 *
 * Anything unlisted falls through to the client's own word, which is the honest
 * answer for a state this app has never met: a wrong plain-English guess would
 * be worse than an odd-looking string you can search for.
 */
const STATE_LABEL: Record<string, string> = {
  stalledDL: "stalled — no peers answering",
  metaDL: "fetching metadata",
  pausedDL: "paused",
  stoppedDL: "paused",
  queuedDL: "queued",
  checkingDL: "checking",
  allocating: "allocating",
  error: "error",
  missingFiles: "files missing",
  uploading: "seeding",
  stalledUP: "seeding — nobody pulling",
  queuedUP: "queued to seed",
  forcedUP: "seeding — forced",
  checkingUP: "checking",
  pausedUP: "finished, seeding stopped",
  stoppedUP: "finished, seeding stopped",
  moving: "moving files",
  checkingResumeData: "checking",
};

const PAUSED_STATES = new Set(["pausedDL", "stoppedDL"]);

/**
 * Listed, but not arriving and not going to without a person.
 *
 * A finished torrent whose files have since been moved or deleted reads as
 * `missingFiles` with its progress back at zero, which is the client saying
 * something about the drive rather than about a download. Under "Downloading"
 * that row is a fetch starting over — it is not one, and nothing is coming. It
 * belongs in history, where the record of it already is.
 */
const LOST_STATES = new Set(["error", "missingFiles"]);

/** Still uploading to peers — the states worth an explicit stop. */
const SEEDING_STATES = new Set([
  "uploading",
  "stalledUP",
  "queuedUP",
  "forcedUP",
  "checkingUP",
]);

/**
 * The film the release was fetched for, when the send knew it.
 *
 * Drawn by `Art` like every other poster in the app rather than by an `<img>`
 * of its own — a broken frame here is the same broken frame it is anywhere
 * else, and one component already knows what to do about it. That is also
 * what lets it be named, and a named poster is one the browser will carry
 * over from the shelf you came from rather than redraw.
 *
 * The file on the drive first and TMDb's path behind it, which is the order
 * every other poster in this app is drawn in — and the whole reason it is
 * given both. A log row used to be handed the path the send recorded and
 * nothing else, so a film whose poster you had replaced arrived here wearing
 * the picture you replaced it with nowhere in sight. The one you chose is the
 * one on the drive; the remote is what is left when the film is a want, or is
 * on a volume that is not plugged in.
 */
function Poster({
  entry,
  name,
  dim,
}: {
  entry: DownloadEntry;
  /** `posterName(…)`, where this row's film is one the library holds. */
  name?: string;
  dim?: boolean;
}) {
  return entry.poster || entry.posterPath ? (
    <Art
      src={entry.poster}
      remote={entry.posterPath}
      version={entry.artAt}
      size="w92"
      transitionName={name}
      loading="lazy"
      className={`h-24 w-16 shrink-0 rounded-control object-cover ring-1 ring-line ${
        dim ? "opacity-60" : ""
      }`}
    />
  ) : (
    <span className="h-24 w-16 shrink-0 rounded-control bg-surface-strong ring-1 ring-line" />
  );
}

/**
 * Everything a row can be asked, in the words each question needs.
 *
 * Three rather than four: "Remove from qBittorrent" has gone, with the menu it
 * lived in. It was the one control here that reached into another application
 * to do something this one has no opinion about — the files were already on the
 * drive, the record was staying either way, and what was left in the client is
 * the client's own housekeeping. qBittorrent has a list and a right-click of
 * its own for that.
 *
 * Stopping the seeding is a stop, so it asks: the app asks before it interrupts
 * anything that is running, whether that is a job in the rail, a download in
 * flight, or an upload other people are pulling from. Pausing a download is the
 * one control on this page that does not ask, because a pause is not a stop —
 * the same mark puts it back, nothing is thrown away, and a confirmation on it
 * would be a dialog in front of a toggle.
 */
const ASK: Record<
  "cancel" | "forget" | "seed",
  { title: string; label: string; body: string }
> = {
  cancel: {
    title: "Cancel this download?",
    label: "Cancel download",
    body: "The download stops and its partial files are deleted — half a file is no use to anyone. The history entry stays, marked as never finished.",
  },
  forget: {
    title: "Clear from history?",
    label: "Clear",
    body: "Only the record is forgotten. Nothing on the drive or in qBittorrent is touched.",
  },
  seed: {
    title: "Stop seeding?",
    label: "Stop seeding",
    body: "The torrent stops uploading and stays in qBittorrent with its files where they are. Resume it from qBittorrent whenever you like.",
  },
};

const ROW_ACTION =
  "grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line transition-colors hover:border-line-strong hover:bg-surface-strong disabled:opacity-40";

/**
 * Stop it, or start it again — one mark that is whichever the torrent is not.
 *
 * The rows lost their pause button to the menu, and were right to: two live
 * buttons a centimetre from a progress bar, one of which throws the download
 * away, are two buttons pressed by accident. A tile is the other case. There is
 * no room for the words, the corner a poster keeps its reading in is free on a
 * transfer — nothing here is ranked — and a pause is the one control on this
 * page that undoes itself: the same mark puts it back.
 *
 * Drawn like every other mark over artwork, and in the shape a media control
 * has been for fifty years, so it needs no label to be understood.
 */
function TransportIcon({ paused }: { paused: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-5 w-5"
    >
      {paused ? (
        <path d="M8 5.5v13l11-6.5z" />
      ) : (
        <>
          <path d="M9.5 5.5v13" />
          <path d="M14.5 5.5v13" />
        </>
      )}
    </svg>
  );
}

/**
 * And the one that ends it — the app's own cross, at the app's own weight.
 *
 * The same shape and the same stroke as `RemoveButton`, because a cross over
 * artwork should be one cross however many lists draw it: that was the lesson
 * of the two the collections and the wishlist used to keep apart. What it means
 * is left to the button around it — "stop this and throw away what has arrived"
 * on a transfer in flight, "clear this from the record" on a row in the
 * history — and to the dialog each of them opens.
 */
function CrossIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden
      className="h-5 w-5"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/*
 * The only mark a row wears now. There were four here — pause, resume, a cross
 * and this — from when a running row carried its own controls; they went with
 * the buttons that used them.
 */
function MoreIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className="h-4 w-4"
    >
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

/**
 * A row's actions, folded behind one ellipsis.
 *
 * History rows first, where which actions exist depends on the torrent's fate
 * and three conditionally-appearing circles were a row that never looked the
 * same twice. Running rows now too — those had a fixed pair, pause and cancel,
 * so they were never that; what they were was two live buttons sitting a
 * centimetre from a progress bar, one of which throws the download away. Named
 * in a menu, both have to be read before they can be pressed.
 *
 * `busy` is the wait the pause button used to show on its own face: the client
 * is being asked, and the answer arrives on the next poll rather than with the
 * click. The trigger holds that now — the menu it would have been shown in is
 * already closed by then — and refuses a second press while it turns.
 *
 * Rows only. A tile carries its two controls as marks in the corner instead —
 * there are two of them, both are shapes rather than sentences, and a menu on a
 * poster has nowhere to unroll: the frame clips what it holds, which is what
 * gives it its rounded corners. See `DownloadTile`.
 */
function RowMenu({
  items,
  busy,
}: {
  items: { label: string; onSelect: () => void }[];
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-label="Actions"
        aria-expanded={open}
        title="Actions"
        className={`${ROW_ACTION} ${open ? "" : "opacity-50 hover:opacity-100"}`}
      >
        {busy ? <Spinner className="h-3.5 w-3.5" /> : <MoreIcon />}
      </button>

      {open && (
        <div className="row-enter absolute top-full right-0 z-30 mt-2 w-56 overflow-hidden glass-panel rounded-card border border-line py-1 shadow-2xl">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="glow flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-surface-strong"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A transfer in flight as a poster.
 *
 * The tab is read as posters or as rows — one choice, made once in the listing
 * bar — and a page that answered it on the list above and ignored it on the
 * list below was two lists disagreeing about what the same button meant. So
 * what is moving is drawn either way, like everything else here.
 *
 * A tile has no room to say what a row says down its length, and does not need
 * to: what a fetch in flight is asked is how far along it is, which is the bar,
 * and how fast, which is the one figure worth a plate. Everything else the row
 * prints — the exact percentage, the size, the estimate, the client's own word
 * for a torrent that has stalled — is on the `title` of that plate, where a
 * pointer finds it and a narrow poster is not asked to carry it.
 *
 * The bar goes along the foot of the artwork rather than under the caption,
 * because it is a measurement of the tile rather than a mark on it — which is
 * `PosterTile`'s `status` slot, and why that slot exists.
 */
function DownloadTile({
  entry,
  name,
  index,
  busy,
  onPause,
  onCancel,
}: {
  entry: DownloadEntry;
  /** `posterName(…)`, where this row's film is one the library holds. */
  name?: string;
  index: number;
  busy?: boolean;
  onPause: () => void;
  onCancel: () => void;
}) {
  const d = entry.live!;
  const paused = PAUSED_STATES.has(d.state);
  // Floored, for the reason the row gives: a download at 99.999% is not
  // finished, and the one number on the tile must not say it is.
  const percent = Math.floor(d.progress * 100);

  /*
   * The second half of the plate: whichever of the three is true.
   *
   * A moving download reports its speed, because that is the figure that
   * changes while you watch. One that is not moving reports why not, in the
   * client's own word cut back to it — "stalled — no peers answering" is a
   * sentence for a row, and a poster has room for the first word of it.
   */
  const state = STATE_LABEL[d.state]?.split(" — ")[0];
  const detail = paused
    ? "paused"
    : d.speedBps > 0
      ? speed(d.speedBps)
      : (state ?? eta(d.etaSec));

  return (
    <PosterTile
      poster={{
        src: entry.poster,
        remote: entry.posterPath,
        version: entry.artAt,
      }}
      transitionName={name}
      // The film where the send knew it, and the release name where it did
      // not — a tile with no caption at all is a picture of nothing.
      //
      // And the film alone: the release name is sixty characters of group tags,
      // which is the one string here that genuinely needs a line to itself and
      // cannot have one under a poster. The rows print it, and the queue's own
      // tiles gave it up for the same reason — see `ReleaseTile`.
      title={entry.filmTitle ?? d.name}
      // The size, then what the release claims to be, then which list sent it —
      // the same facts in the same order as the history tiles below. A name
      // that stated none of them prints the size and the source alone: absent
      // facts fall away rather than reading as "unknown · SDR".
      facts={[
        gigabytes(d.sizeBytes),
        entry.resolution,
        entry.hdr,
        entry.releaseType,
        SOURCE_LABEL[entry.source],
      ]}
      /*
       * Top right, where every tile in the app keeps the thing its list is
       * about. On a shelf that is a score; on a transfer nothing is ranked, and
       * what belongs in reach is the pair of things you can do to it.
       *
       * A row of marks rather than one, which the queue's own tiles already
       * carry — see `TILE_MARK`. The stop sits in the corner itself, where the
       * pointer lands and where the one control you actually reach for should
       * be; the cancel is the one further in, since it is the press there is
       * no taking back.
       */
      badge={
        <div className="flex items-center">
          {/* Red on the pointer rather than always, which is `RemoveButton`'s
              rule and `BUTTON.danger`'s: a mark announces what it will do at
              the moment you reach for it, not from across the grid.

              It opens the same dialog the rows' menu item opens, so the words
              are still said before anything is thrown away — which is what
              lets this be a shape at all. */}
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancel this download"
            title="Cancel download"
            className={`${TILE_MARK} hover:text-red-400 disabled:opacity-50`}
          >
            <CrossIcon />
          </button>

          <button
            type="button"
            onClick={onPause}
            disabled={busy}
            aria-label={paused ? "Resume this download" : "Pause this download"}
            title={paused ? "Resume" : "Pause"}
            className={`${TILE_MARK} disabled:opacity-50`}
          >
            {busy ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <TransportIcon paused={paused} />
            )}
          </button>
        </div>
      }
      status={
        <>
          {/* The plate has the line to itself now that both controls are in the
              corner above. `self-start` so it is the width of what it says
              rather than the width of the poster — a plate ruled edge to edge
              is a banner. */}
          <span
            className={`${TILE_READING} max-w-full self-start truncate`}
            title={[
              `${(Math.floor(d.progress * 10000) / 100).toFixed(2)}% of ${gigabytes(d.sizeBytes)}`,
              !paused && d.speedBps > 0 ? speed(d.speedBps) : undefined,
              paused ? "paused" : (eta(d.etaSec) ?? STATE_LABEL[d.state]),
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            {[`${percent}%`, detail].filter(Boolean).join(" · ")}
          </span>

          {/* Lit while it is moving and dull while it is not, as in the rows:
              a paused download keeps the channel but throws no light. In
              white, because it is standing on a poster — see `.bar-over`. */}
          <div className="bar-track bar-track-thin bar-over">
            <div
              className={`bar-fill motion-safe:transition-[width] motion-safe:duration-500 ${
                paused ? "bar-fill-idle" : ""
              }`}
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>
        </>
      }
      label={`${entry.filmTitle ?? d.name} — ${percent}% downloaded`}
      index={index}
    />
  );
}

/**
 * What a history row says about a fetch, as one line.
 *
 * The same facts the rows print down their length, in the same order, so
 * switching the page from posters to rows is a change of shape rather than a
 * change of subject: when it was sent, when it finished, how big it turned out
 * to be, and whether the client still has it at all.
 */
const historyLine = (entry: DownloadEntry) =>
  [
    `sent ${day(entry.addedAt)}`,
    entry.completedAt ? `finished ${day(entry.completedAt)}` : undefined,
    entry.live ? gigabytes(entry.live.sizeBytes) : "no longer in qBittorrent",
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * A fetch that has already happened, as a poster.
 *
 * The history was rows and only rows for as long as it was the foot of somebody
 * else's page — a log, and a log is rows. On a page about downloads it is half
 * the subject rather than an appendix to one, and half a page that ignored the
 * only button the page has would be the grid stopping partway down.
 *
 * What a poster cannot carry is the release name, which is sixty characters of
 * group tags; the rows keep it, and this says which film it was and leaves the
 * rest to the line under the caption.
 *
 * It carried a menu under the caption once, for the three things that could be
 * done to a finished fetch. Two of them have gone — removing the torrent from
 * qBittorrent is qBittorrent's business, and a menu holding one item is a menu
 * you open to find out it was a button — so what is left is the app's own
 * cross, in the corner every list in this app puts it: top left, on hover, the
 * same one that takes a film off the wishlist. See `RemoveButton`.
 */
function HistoryTile({
  entry,
  name,
  index,
  onClear,
  onStopSeeding,
  onOpen,
}: {
  entry: DownloadEntry;
  /** `posterName(…)`, where this row's film is one the library holds. */
  name?: string;
  index: number;
  /** Absent while qBittorrent still holds this one — see `clearable`. */
  onClear?: () => void;
  /** And present only while it is still uploading to somebody. */
  onStopSeeding?: () => void;
  /** The whole record, which is more than a tile can hold. */
  onOpen: () => void;
}) {
  const d = entry.live;
  const seeding = d && SEEDING_STATES.has(d.state);

  return (
    <PosterTile
      poster={{
        src: entry.poster,
        remote: entry.posterPath,
        version: entry.artAt,
      }}
      transitionName={name}
      title={entry.filmTitle ?? entry.title}
      /*
       * How big it was and when it landed, on one line.
       *
       * These were two: the size on this line and "sent 12 Aug" on a line of
       * its own under the caption, which made a tile three rows of text deep to
       * say two things. The date is the finish rather than the send, because
       * this is the log of what arrived — when you pressed the button matters
       * to nobody once it has, and a fetch that never finished has no date to
       * give, which the section it is filed under says better than a blank.
       *
       * What the release *claims* to be — `resolution`, `hdr`, `releaseType` —
       * has gone with them. Those are read off the name, which is the same
       * name the score above is read off, so printing both was the tile making
       * its own working out. The record dialog still lists them.
       */
      facts={[
        d && gigabytes(d.sizeBytes),
        entry.completedAt && `finished ${day(entry.completedAt)}`,
      ]}
      /*
       * What the library makes of what landed, in the corner every shelf in the
       * app keeps its reading in — the same badge, the same colours, the same
       * verdict behind them as the film shelf.
       *
       * Absent until there is a film to read: a want still arriving, or a fetch
       * whose film has since left the drive, matches nothing in the library and
       * gets no badge rather than a nought. See `FilmContext.score`.
       */
      badge={
        entry.score !== undefined && (
          <ScoreBadge
            score={entry.score}
            theme={entry.status ? STATUS_THEME[entry.status] : undefined}
            title={
              entry.status
                ? `${entry.status} · ${entry.score} of 100`
                : `${entry.score} of 100`
            }
          />
        )
      }
      /*
       * Which list sent it, and — where it applies — that it is still
       * uploading. Bottom left, which is where this app puts what a tile *is*
       * as opposed to what can be done to it.
       *
       * The source was the first word of the small print under the artwork,
       * where you look last. An upgrade and a want are the two kinds of thing
       * on this page and they answer different questions — was the copy worth
       * replacing, did the film ever turn up — so which one a tile is should be
       * legible without reading. It is drawn on `TILE_PLATE` so it stands
       * exactly as tall as the score across the tile from it: two plates on one
       * line at two heights read as a mistake before they read as two facts.
       */
      note={
        <span className="flex items-center gap-1">
          <span className={TILE_PLATE}>{SOURCE_LABEL[entry.source]}</span>
          {seeding && (
            <span
              className={`${TILE_PLATE} text-emerald-600 dark:text-emerald-400`}
            >
              seeding
            </span>
          )}
        </span>
      }
      /*
       * Clearing the record, in the corner every list in this app keeps the
       * mark that takes a tile out of the list it is in — and wearing a bin
       * rather than a cross, because this one does not merely un-list it. The
       * log entry is the only thing that remembers a fetch happened; a cross
       * would promise the reversibility the wishlist's has. See `RemoveButton`.
       *
       * Only once qBittorrent has let go of it. While the client still holds a
       * torrent the record is not the last copy of anything, and the offer is
       * the one below instead.
       */
      remove={
        onClear && (
          <RemoveButton
            icon="bin"
            label={`Clear ${entry.filmTitle ?? entry.title} from history`}
            title="Clear from history"
            onClick={onClear}
          />
        )
      }
      /* And the one thing a finished fetch is still doing, in the corner a tile
         keeps what can be done about it. Never on the same tile as the bin —
         stopping the seeding needs the torrent still in the client, and
         clearing the record exists only once it is not. */
      actions={
        onStopSeeding && (
          <button
            type="button"
            onClick={onStopSeeding}
            aria-label="Stop seeding"
            title="Stop seeding"
            className={TILE_MARK}
          >
            <TransportIcon paused={false} />
          </button>
        )
      }
      label={`${entry.filmTitle ?? entry.title} — ${historyLine(entry)}`}
      index={index}
      // The poster opens the record rather than going anywhere: a fetch is not
      // a place, and the film it was for is a click further on, inside.
      onOpen={onOpen}
    />
  );
}

/**
 * One fetch, with everything the page had no room for.
 *
 * The tiles and the rows are both edited down — a poster carries four facts and
 * a row nine, out of a dozen the log actually holds — and what got left out is
 * exactly what you go looking for when a row is not what you expected: the
 * release's own sixty-character name, the state qBittorrent last reported, when
 * it was sent against when it landed, the hash. Reading a record should not
 * require going to another application to finish the sentence.
 *
 * Built like the release dialog next door, because it is the same object at the
 * other end of its life: the same panel, the same heading over the same rule,
 * the film as a poster and a name, then one ruled block of labelled facts. See
 * `ReleaseDetails` — that one is the release you are deciding about, this is
 * the release you decided about.
 *
 * The two controls come with it. They are on the tile as marks, which is fine
 * for a grid being skimmed and no good at all as the only place they exist: a
 * mark on hover is a control you have to already know about, and this is the
 * page's one screen that has room to name them.
 */
function DownloadDetails({
  entry,
  open,
  onClose,
  onClear,
  onStopSeeding,
  asking,
}: {
  entry: DownloadEntry;
  open: boolean;
  onClose: () => void;
  onClear?: () => void;
  onStopSeeding?: () => void;
  /** A question is up over this dialog, so it must not answer Escape itself. */
  asking?: boolean;
}) {
  const d = entry.live;
  const film = entry.filmTitle ?? entry.title;
  // Only where the library still holds it — the poster of a want has no page
  // of its own to open, and `filmPath` is the read that says which this is.
  const href = entry.filmPath ? `/film/${movieId(entry.filmPath)}` : undefined;

  const poster = (
    <span className="block h-24 w-16 shrink-0 overflow-hidden rounded-control bg-surface-strong ring-1 ring-line">
      {(entry.poster || entry.posterPath) && (
        <Art
          src={entry.poster}
          remote={entry.posterPath}
          version={entry.artAt}
          size="w92"
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!asking}
      label={`${film} — download details`}
      panelClassName="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto glass-panel rounded-card border border-line p-6 shadow-2xl"
    >
      <>
        {/* Named for what it is rather than for the film, which is the rule the
            conversion and release dialogs settled: every one of these is the
            same record read about a different fetch, so the heading says which
            record and the film sits below with its poster. */}
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="min-w-0 truncate text-base font-semibold">
            This download
          </h2>
          <CloseButton onClick={onClose} />
        </header>

        <div aria-hidden className="rule-head mb-1" />

        {/* Which film, and the way to it. A poster and a name are the handle
            the film already has, so there is no button for it — the same
            argument the release dialog makes about the row it dropped. */}
        <div className="flex items-center gap-4">
          {href ? (
            <Link href={href} className="glow shrink-0 rounded-control">
              {poster}
            </Link>
          ) : (
            poster
          )}

          <div className="min-w-0">
            {href ? (
              <Link href={href} className="glow rounded-control">
                <p className="truncate text-base font-medium">{film}</p>
              </Link>
            ) : (
              <p className="truncate text-base font-medium">{film}</p>
            )}
            {/* What the library can say about it, which for a want is that it
                cannot say anything: the film is not on the drive, and the row
                is the only place this fetch exists. */}
            <p className="mt-0.5 text-xs opacity-45">
              {entry.filmPath ? "In the library" : "Not in the library"}
            </p>
          </div>
        </div>

        {/* Everything the log holds, in the one ruled block this app sets a
            table of facts in. `Fact` draws nothing for a value it does not
            have, so the table can be written out in full and the facts this
            release never stated simply fall away. */}
        <dl className="overflow-hidden rounded-control border border-line">
          <Fact label="Release" value={entry.title} mono />
          <Fact label="Size" value={d && gigabytes(d.sizeBytes)} />
          <Fact label="Resolution" value={entry.resolution} />
          <Fact label="HDR" value={entry.hdr} />
          <Fact label="Release type" value={entry.releaseType} />
          <Fact label="From" value={SOURCE_LABEL[entry.source]} />
          {/* qBittorrent's own word, said the way the rows say it, and the
              plain sentence where there is no client left to ask. */}
          <Fact
            label="State"
            value={
              d ? (STATE_LABEL[d.state] ?? d.state) : "no longer in qBittorrent"
            }
          />
          {/* Only while there is something to be part-way through: a finished
              fetch at 100% is a row saying "done" twice. */}
          <Fact
            label="Progress"
            value={
              d && !d.done ? `${Math.floor(d.progress * 100)}%` : undefined
            }
          />
          <Fact label="Sent" value={day(entry.addedAt)} />
          <Fact
            label="Finished"
            value={
              entry.completedAt ? day(entry.completedAt) : "never finished"
            }
          />
          {/* The one fact here that is of no use inside this app at all, and
              the only one that is any use outside it: it is what identifies
              this torrent to qBittorrent, and to anything else asked about it. */}
          <Fact label="Hash" value={entry.hash} mono />
        </dl>

        {(onStopSeeding || onClear) && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onStopSeeding && (
              <button
                type="button"
                onClick={onStopSeeding}
                className={BUTTON.secondary}
              >
                Stop seeding
              </button>
            )}
            {/* The cross on the tile, in words. Outlined rather than filled:
                it deletes a record and nothing else, and the dialog behind it
                is where the red belongs — see `BUTTON.danger`. */}
            {onClear && (
              <button type="button" onClick={onClear} className={BUTTON.danger}>
                Clear from history
              </button>
            )}
          </div>
        )}
      </>
    </Modal>
  );
}

export function DownloadsView({ initial }: { initial: DownloadEntry[] }) {
  const [entries, setEntries] = useState(initial);

  /*
   * A fresh read from the server replaces what is held.
   *
   * `initial` is not read once: a send calls `refresh()`, and the page comes
   * back with the transfer that was just started in it. Held state ignores a
   * changed prop, which is exactly wrong here — the list would be empty, and
   * with nothing in it the poll below never starts, so the download you just
   * pressed would sit invisible until the page was loaded again. Adjusted
   * during render rather than in an effect, the way the rest of the app
   * follows a prop: an effect would paint the empty frame first.
   */
  const [served, setServed] = useState(initial);
  if (served !== initial) {
    setServed(initial);
    setEntries(initial);
  }

  /**
   * Which half, in what order, drawn how — the three questions every listing
   * page here asks, in the URL like all of them.
   *
   * This was `useLayout`, the one-question slice of the same hook, back when
   * the page's whole control row was a layout toggle.
   */
  const listing = useListing(TABS, SORTS, GROUPS);
  const { tab, layout } = listing;

  const [pending, startTransition] = useTransition();
  /** The last control that came back with a reason, until it is dismissed. */
  const [failure, setFailure] = useState<string | null>(null);
  /*
   * Nothing destructive happens on one click. The x buttons only open this,
   * and the dialog says in words what will happen to the torrent, the files
   * and the history entry before anything does.
   */
  const [confirming, setConfirming] = useState<{
    kind: keyof typeof ASK;
    entry: DownloadEntry;
  } | null>(null);
  const confirmShown = useLingering(confirming);

  /**
   * The fetch whose record is open, held by hash rather than by object.
   *
   * The log is read again every few seconds and comes back as new objects, so
   * a dialog holding the entry it was opened with would go on showing a state
   * the client has since left — a torrent stopped in qBittorrent's own window
   * would still say "seeding" here for as long as the dialog stayed up. The
   * hash is what survives the re-read; the entry is looked up out of whatever
   * the latest one holds.
   */
  const [reading, setReading] = useState<string | null>(null);
  const readingEntry = entries.find((e) => e.hash === reading) ?? null;
  // Cleared from history, or adopted away — either way the record this was
  // opened about is gone, and a dialog about it has nothing left to say.
  // Adjusted during render, the way this file follows `initial` above.
  if (reading && !readingEntry) setReading(null);
  const readShown = useLingering(readingEntry);

  /*
   * Two speeds, because there are two reasons to read again.
   *
   * A download in flight changes every second it runs, and the page is worth
   * a few seconds' latency at most. A row that is only seeding changes almost
   * never — but it does change: stopped from qBittorrent's own window, or by
   * this app the moment a finish is noticed and the stop-seeding setting is
   * on. Gated on downloads alone, as it was, none of that ever reached the
   * page: the interval never started, and a row went on saying "seeding" for
   * as long as the page stayed open.
   */
  const downloadingNow = entries.some((e) => e.live && !e.live.done);
  const liveNow = entries.some((e) => e.live);

  useEffect(() => {
    if (!liveNow) return;
    const id = setInterval(
      async () => {
        setEntries(await listDownloadLog());
      },
      downloadingNow ? POLL_MS : IDLE_POLL_MS,
    );
    return () => clearInterval(id);
  }, [liveNow, downloadingNow]);

  /**
   * Runs a control and re-reads at once, so the row answers the click.
   *
   * Every one of these can fail — the client is a separate program that can be
   * shut, moved or busy — and the result used to be dropped on the floor. A
   * pause that did nothing then looked exactly like a pause that worked until
   * the next poll put the row back, which reads as the app ignoring you rather
   * than as qBittorrent being unreachable. What comes back is said out loud.
   */
  const control = (
    run: () => Promise<{ ok: true } | { ok: false; error: string } | void>,
  ) =>
    startTransition(async () => {
      setFailure(null);
      const result = await run();
      if (result && !result.ok) setFailure(result.error);
      setEntries(await listDownloadLog());
    });

  /**
   * Whether the record is all that is left of this fetch, and so the only
   * thing there is to clear.
   *
   * A row qBittorrent still lists cannot be cleared, and offering it would be a
   * button that appears to do nothing: `getDownloadLog` adopts every torrent in
   * this app's category that it has no row for, so the entry would be written
   * straight back on the next poll — three seconds later, in the same place, as
   * if the cross had missed.
   *
   * Removing it from qBittorrent as well would make the cross work, and that is
   * exactly the offer this page has stopped making: what is in the client is
   * the client's business, and a cross in this app should never be the thing
   * that reaches into another one.
   */
  const clearable = (entry: DownloadEntry) => !entry.live;

  /** And whether it is still uploading, which is the one thing left to stop. */
  const seeding = (entry: DownloadEntry) =>
    Boolean(entry.live && SEEDING_STATES.has(entry.live.state));

  const inFlight = (e: DownloadEntry) =>
    Boolean(e.live && !e.live.done && !LOST_STATES.has(e.live.state));

  /**
   * The two halves, each ranked by whatever its own menu is set to.
   *
   * Sorted on a copy — `filter` already made one, but saying so is what stops
   * the next edit from sorting `entries` itself and quietly reordering the
   * state the poll writes back into.
   */
  const order = COMPARE[listing.current.key] ?? COMPARE.added;
  const active = entries.filter(inFlight).sort(order);
  const past = entries.filter((e) => !inFlight(e)).sort(order);

  /** Whichever half the switch is on, which is the only one drawn. */
  const showing = tab === "active" ? active : past;

  /**
   * How this tab is cut, resolved from the key in the address.
   *
   * `useListing` hands back the chosen key; the option it names lives here with
   * the buckets it sorts into, because the cut is a fact about these rows and
   * not about the bar that offers it.
   */
  const grouping = pickGroup(GROUPS[tab], listing.group);

  /**
   * Which rows name their poster, by hash.
   *
   * A row whose film is in the library names its poster the same thing every
   * shelf in the app names it, so arriving here from one of them carries the
   * picture across instead of drawing a new one. A film the library does not
   * hold — a wishlist send, something fetched and not yet scanned — has no
   * counterpart to travel from, and naming it would cost the browser a
   * snapshot on every transition for nothing.
   *
   * Deduped because a name has to be unique on the page: two rows for one film
   * (fetched twice, or a re-download beside its own history) would name the
   * same poster twice, and the browser answers that by abandoning the
   * transition altogether. The row nearest the top wins.
   */
  const named = new Map<string, string>();
  const taken = new Set<string>();
  for (const entry of [...active, ...past]) {
    if (!entry.filmPath) continue;
    const name = posterName(entry.filmPath);
    if (taken.has(name)) continue;
    taken.add(name);
    named.set(entry.hash, name);
  }

  /*
   * A page with nothing on it has to say so, which is what a section that is
   * simply absent could do while this was drawn under somebody else's list.
   *
   * One state rather than two. There were two before, when this was last a page
   * of its own: one for a client that had never been connected and one for a
   * client that had never been given anything. They read as the same sentence
   * from where you were standing — no downloads — and connecting the client is
   * said where it can be acted on: the Settings page, and the Download button
   * itself, which is a plain magnet link until there is somewhere to hand a
   * release to.
   */
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={
          <>
            <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
            <path d="M4 20h16" />
          </>
        }
        title="Nothing fetched yet"
      >
        Press Download on a better copy in the queue, or on a release found for
        something on your wishlist, and it turns up here on its way in.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* The row every list page in this app keeps: which half on the left, how
          to read it on the right. It brings its own `mb-5`. */}
      <ListingBar listing={listing} />

      <div className="flex flex-1 flex-col gap-14">
        {/* Above both lists rather than against the row that failed: a control
          can be clicked from the row menu, which is gone by the time there is
          anything to report, and a torrent removed from the client takes its
          row with it. It stays until dismissed or until the next control
          works — an error that clears itself on a timer is an error you find
          out about by being lucky. */}
        {failure && (
          <div className="-mb-8 flex items-start justify-between gap-4 rounded-card border border-red-500/40 bg-red-500/[0.06] px-4 py-3">
            <div className="min-w-0">
              <Failure>{failure}</Failure>
              <p className="mt-1.5 text-[11px] opacity-45">
                Nothing changed in qBittorrent. Check it is running, or its
                address on the{" "}
                <Link href="/settings" className="underline underline-offset-2">
                  Settings page
                </Link>
                .
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFailure(null)}
              className="shrink-0 text-xs opacity-50 transition-opacity hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Each half says its own nothing, and says it in that half's terms.
            The page-wide empty state above answers "you have never fetched
            anything"; these two answer "nothing is moving" and "nothing has
            finished", which are different facts and point different ways. */}
        {showing.length === 0 && (
          <EmptyState
            icon={
              tab === "active" ? (
                <>
                  <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
                  <path d="M4 20h16" />
                </>
              ) : (
                <>
                  <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" />
                  <path d="M12 7v5l3.5 2" />
                </>
              )
            }
            title={
              tab === "active" ? "Nothing downloading" : "Nothing finished yet"
            }
          >
            {tab === "active"
              ? "Everything sent to qBittorrent has arrived. What came in is under History."
              : "Nothing has finished downloading yet — what is on its way is under Downloading."}
          </EmptyState>
        )}

        {tab === "active" && active.length > 0 && (
          <section className="flex flex-col gap-5">
            {layout === "grid" ? (
              <div className={TILE_GRID_RULED}>
                {active.map((entry, i) => (
                  <DownloadTile
                    key={entry.hash}
                    entry={entry}
                    name={named.get(entry.hash)}
                    index={i}
                    busy={pending}
                    onPause={() =>
                      control(() =>
                        PAUSED_STATES.has(entry.live!.state)
                          ? qbResume(entry.hash)
                          : qbPause(entry.hash),
                      )
                    }
                    onCancel={() => setConfirming({ kind: "cancel", entry })}
                  />
                ))}
              </div>
            ) : (
              <ul className="ruled flex flex-col">
                {active.map((entry, i) => {
                  const d = entry.live!;
                  const paused = PAUSED_STATES.has(d.state);
                  // Floored to the hundredth, not rounded: a download at 99.999%
                  // is not finished, and the one number the row shows should never
                  // say it is before the file is.
                  const percent = Math.floor(d.progress * 10000) / 100;
                  return (
                    <li
                      key={entry.hash}
                      style={stagger(i)}
                      className="row-enter -mx-4 flex items-center gap-5 rounded-card px-4 py-4"
                    >
                      <Poster entry={entry} name={named.get(entry.hash)} />

                      <div className="min-w-0 flex-1">
                        {entry.filmTitle && (
                          <p className="truncate text-base font-medium">
                            {entry.filmTitle}
                          </p>
                        )}
                        <p
                          className={`truncate font-mono text-xs opacity-55 ${
                            entry.filmTitle ? "mt-1.5" : ""
                          }`}
                          title={d.name}
                        >
                          {d.name}
                        </p>
                        {/* The bar: progress that reads at a glance across the
                          row's whole width, which a dial never quite did. Lit
                          only while it is moving — a paused download keeps the
                          channel but throws no light, so the row that has
                          stopped is the dull one. */}
                        {/* Held back from the right edge of its column, which the
                          title and the file name run to but the bar should not:
                          those stop when the words stop, and a bar stops where
                          it is told, so at full width it was the one thing in
                          the row reaching for the ellipsis. */}
                        <div className="bar-track mt-2.5 mr-10">
                          <div
                            className={`bar-fill motion-safe:transition-[width] motion-safe:duration-500 ${
                              paused ? "bar-fill-idle" : ""
                            }`}
                            style={{ width: `${Math.min(100, percent)}%` }}
                          />
                        </div>

                        <p className="mt-2 text-xs tabular-nums opacity-45">
                          {[
                            `${percent.toFixed(2)}% of ${gigabytes(d.sizeBytes)}`,
                            !paused && d.speedBps > 0
                              ? speed(d.speedBps)
                              : undefined,
                            paused
                              ? "paused"
                              : (eta(d.etaSec) ?? STATE_LABEL[d.state]),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>

                      {/* The same ellipsis the history rows carry, so one column
                        of marks runs down the page whatever state a row is in. */}
                      <RowMenu
                        busy={pending}
                        items={[
                          {
                            label: paused ? "Resume" : "Pause",
                            onSelect: () =>
                              control(() =>
                                paused
                                  ? qbResume(entry.hash)
                                  : qbPause(entry.hash),
                              ),
                          },
                          {
                            label: "Cancel this download",
                            onSelect: () =>
                              setConfirming({ kind: "cancel", entry }),
                          },
                        ]}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {/* The record, on its own tab.

            It has been shut, then open, and is now neither. Shut was the rule
            `CollapsibleSection` was written for — a log is a thing you go
            looking for rather than one you read past — and it earned its keep
            while this list was drawn at the foot of the queue and the wishlist,
            pages you came to for something else. Open was the correction for a
            page called Downloads, where the record is half the subject and
            every visit began with a click to reach the half you came for.

            A tab is what "half the subject" actually asks for. Neither list is
            an appendix to the other, and neither has to be scrolled past to
            reach the other one. What it costs is the glance that took both in
            at once; what it buys is the row at the top of the page, which had
            nothing to hold while these were one column. */}
        {tab === "history" && past.length > 0 && (
          /* Cut into sections where the Outcome menu asks for it, flat where it
             does not — `Grouped` is the same component the jobs page and the
             wishlist part their lists with, headings, rule and all. The offset
             it hands back is what keeps the entrance stagger running down the
             page rather than restarting at every heading. */
          <Grouped
            items={past}
            group={grouping}
            note={(rows) => `${rows.length}`}
          >
            {(rows, offset) =>
              layout === "grid" ? (
                <div className={TILE_GRID_RULED}>
                  {rows.map((entry, i) => (
                    <HistoryTile
                      key={entry.hash}
                      entry={entry}
                      name={named.get(entry.hash)}
                      index={offset + i}
                      onClear={
                        clearable(entry)
                          ? () => setConfirming({ kind: "forget", entry })
                          : undefined
                      }
                      onStopSeeding={
                        seeding(entry)
                          ? () => setConfirming({ kind: "seed", entry })
                          : undefined
                      }
                      onOpen={() => setReading(entry.hash)}
                    />
                  ))}
                </div>
              ) : (
                <ul className="ruled flex flex-col">
                  {rows.map((entry, i) => {
                    const d = entry.live;

                    /*
                     * There were two shouted chips here — REMOVED on a fetch that
                     * never finished, FILES MISSING on one whose payload has since
                     * been moved or deleted. Both were the loudest thing in a list
                     * you open to read what has already happened, and both said
                     * something the quiet line underneath says anyway: whether the
                     * row finished, and whether qBittorrent still has it. A record
                     * does not need to raise its voice.
                     */
                    return (
                      <li
                        key={entry.hash}
                        style={stagger(offset + i)}
                        /* A role rather than a link, because the row holds
                         buttons of its own and an anchor may not: the record
                         opens from a handler and the two marks below stop the
                         click on its way up. The same shape the jobs page's
                         rows take, for the same reason — see `TaskRow`. */
                        role="button"
                        tabIndex={0}
                        onClick={() => setReading(entry.hash)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setReading(entry.hash);
                          }
                        }}
                        aria-label={`${entry.filmTitle ?? entry.title} — ${historyLine(entry)}`}
                        className="row-enter glow -mx-4 flex cursor-pointer items-center gap-5 rounded-card px-4 py-4 transition-colors hover:bg-surface-strong"
                      >
                        <Poster
                          entry={entry}
                          name={named.get(entry.hash)}
                          dim={!d}
                        />
                        <div className="min-w-0 flex-1">
                          {entry.filmTitle && (
                            <p
                              className={`truncate text-base font-medium ${d ? "" : "opacity-60"}`}
                            >
                              {entry.filmTitle}
                            </p>
                          )}
                          <p
                            className={`truncate font-mono text-xs ${d ? "opacity-55" : "opacity-40"} ${
                              entry.filmTitle ? "mt-1.5" : ""
                            }`}
                            title={entry.title}
                          >
                            {entry.title}
                          </p>

                          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            {d && SEEDING_STATES.has(d.state) && (
                              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                seeding
                              </span>
                            )}
                            {/* Which list sent it, as a chip rather than a word
                            in the run — the same fact the tiles now wear in
                            their top corner, and the same reason: it is what
                            the row *is*, not one more detail about it. */}
                            <span className={`${CHIP} shrink-0`}>
                              {SOURCE_LABEL[entry.source]}
                            </span>

                            {/* What the release claimed to be has gone from here
                            for the reason the tiles dropped it: those three are
                            read off the name, the score to the right is read
                            off the file, and a claim printed beside a
                            measurement reads as a second opinion of equal
                            standing. The record dialog still lists them. */}
                            <span className="text-xs opacity-40">
                              {historyLine(entry)}
                            </span>
                          </div>
                        </div>

                        {/* The library's reading of what landed, where the tile
                          puts it in the corner of the artwork: a row is read
                          left to right and the score is the last word on it,
                          which is where the film shelf's rows put theirs too.
                          Absent until the fetch has landed and been scanned. */}
                        {entry.score !== undefined && (
                          <ScoreBadge
                            score={entry.score}
                            theme={
                              entry.status
                                ? STATUS_THEME[entry.status]
                                : undefined
                            }
                            title={
                              entry.status
                                ? `${entry.status} · ${entry.score} of 100`
                                : `${entry.score} of 100`
                            }
                          />
                        )}

                        {/* What the tiles wear in the corner of the artwork, in
                          the place a row keeps its controls. One at most, and
                          usually none: a fetch that finished and was cleaned up
                          after is a record and nothing else — and the two are
                          exact opposites, since stopping the seeding needs
                          qBittorrent to still hold the torrent and clearing the
                          record exists only once it does not.

                          The slot is drawn whether or not it holds anything.
                          Without it the score to its left sat at a different
                          distance from the edge on every row — flush against it
                          where there was no control, a control's width in where
                          there was — and a column of readings that does not
                          line up is a column you cannot run your eye down. */}
                        <div className="flex w-9 shrink-0 justify-end">
                          {seeding(entry) ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirming({ kind: "seed", entry });
                              }}
                              aria-label="Stop seeding"
                              title="Stop seeding"
                              className={`${ROW_ACTION} opacity-50 hover:opacity-100`}
                            >
                              <TransportIcon paused={false} />
                            </button>
                          ) : (
                            clearable(entry) && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirming({ kind: "forget", entry });
                                }}
                                aria-label={`Clear ${entry.filmTitle ?? entry.title} from history`}
                                title="Clear from history"
                                className={`${ROW_ACTION} opacity-50 hover:text-red-400 hover:opacity-100`}
                              >
                                <CrossIcon />
                              </button>
                            )
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            }
          </Grouped>
        )}
      </div>

      {/* The record, over the list it was read on. Mounted beside the question
          below rather than inside itself: a Clear pressed in here opens that
          question over this dialog, and this one stops answering Escape while
          it is up — one press, one answer, which is the rule
          `ProcessDetails` settled for the same pair of dialogs. */}
      {readShown && (
        <DownloadDetails
          entry={readShown}
          open={readingEntry !== null}
          asking={confirming !== null}
          onClose={() => setReading(null)}
          onClear={
            clearable(readShown)
              ? () => setConfirming({ kind: "forget", entry: readShown })
              : undefined
          }
          onStopSeeding={
            seeding(readShown)
              ? () => setConfirming({ kind: "seed", entry: readShown })
              : undefined
          }
        />
      )}

      {/* The app's own confirmation, rather than this list's copy of one.
          It was a dialog of the same parts in a different order — its own
          padding, its own heading size, "Keep it" where every other question
          here says Cancel — and a question you have to read twice because it
          is not shaped like the last one is the opposite of what asking is
          for. What is left is what actually differs: the words. */}
      {confirmShown && (
        <ConfirmModal
          open={confirming !== null}
          title={ASK[confirmShown.kind].title}
          // Red for the one that deletes something. The other two are undoable
          // — a torrent can be sent again, seeding resumed — and clearing the
          // record touches nothing that was downloaded.
          tone={confirmShown.kind === "cancel" ? "danger" : "neutral"}
          confirmLabel={ASK[confirmShown.kind].label}
          busy={pending}
          onConfirm={() => {
            const { kind, entry } = confirmShown;
            control(async () => {
              if (kind === "cancel") return qbRemove(entry.hash, true);
              if (kind === "seed") return qbPause(entry.hash);
              // The only one that touches nothing but our own table, and so
              // the only one with no client to refuse it.
              return forgetDownloadEntry(entry.hash);
            });
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        >
          <p className="mb-2 truncate font-mono text-xs opacity-55">
            {confirmShown.entry.filmTitle ?? confirmShown.entry.title}
          </p>
          {ASK[confirmShown.kind].body}
        </ConfirmModal>
      )}
    </div>
  );
}
