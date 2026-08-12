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
import { SectionHeading } from "@/app/section-heading";
import { useLingering } from "@/app/modal";
import { Failure } from "@/app/settings/parts";
import { Spinner } from "@/app/spinner";
import { stagger } from "@/app/stagger";
import type { DownloadEntry } from "@/lib/qbittorrent";
import { posterName } from "@/lib/routes";

/**
 * Everything ever handed to qBittorrent, in two tenses.
 *
 * The top half is now: what is moving, how fast, and the controls that
 * change it. The bottom half is the log — finished downloads still seeding,
 * and releases qBittorrent has long forgotten, which only the app's own
 * record can still show. Polled quickly while anything moves, slowly while
 * anything is merely in the client, and not at all once nothing is.
 *
 * This was a page of its own, one click along the rail from the list of things
 * to send. Which made a fetch a thing you did on one page and watched on
 * another: you pressed Download on a wishlist find, the row vanished — it is
 * being fetched, so it is no longer something to fetch — and where it went was
 * somewhere else entirely. The two are one tab now, and the row leaves the
 * list above and appears in the list below it.
 *
 * Called `Transfers` because `DownloadsView` was taken, by the list of releases
 * this one receives from — see upgrades-view.tsx. Two things called downloads
 * on one page was already the confusion; naming them apart is the fix.
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

const speed = (bps: number) =>
  bps >= 1024 ** 2
    ? `${(bps / 1024 ** 2).toFixed(1)} MB/s`
    : `${Math.round(bps / 1024)} KB/s`;

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

/** qBittorrent's state strings, said like a person would. */
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
 */
function Poster({
  path,
  name,
  dim,
}: {
  path?: string;
  /** `posterName(…)`, where this row's film is one the library holds. */
  name?: string;
  dim?: boolean;
}) {
  return path ? (
    <Art
      remote={path}
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
 * Everything a row can be asked before it is done, in the words each one needs.
 *
 * Four questions rather than three: stopping the seeding is a stop, and the app
 * asks before it interrupts anything that is running — a job in the rail, a
 * download in flight, an upload other people are pulling from. Pausing a
 * download is the one control here that does not ask, because a pause is not a
 * stop: the same menu item resumes it, nothing is thrown away, and a
 * confirmation on it would be a dialog in front of a toggle.
 */
const ASK: Record<
  "cancel" | "remove" | "forget" | "seed",
  { title: string; label: string; body: string }
> = {
  cancel: {
    title: "Cancel this download?",
    label: "Cancel download",
    body: "The download stops and its partial files are deleted — half a file is no use to anyone. The history entry stays, marked as never finished.",
  },
  remove: {
    title: "Remove from qBittorrent?",
    label: "Remove",
    body: "The torrent leaves qBittorrent. The downloaded files and this history entry both stay — the files are the point, and the record is the record.",
  },
  forget: {
    title: "Clear from history?",
    label: "Clear",
    body: "Only the record is forgotten. Nothing on the drive or in qBittorrent is touched.",
  },
  seed: {
    title: "Stop seeding?",
    label: "Stop seeding",
    body: "The torrent stops uploading and stays in qBittorrent with its files where they are. Resume it from this same menu whenever you like.",
  },
};

/** The one-word mark a history row can carry, where it has earned one. */
const CHIP =
  "rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap opacity-60 ring-1 ring-line-strong ring-inset";

const ROW_ACTION =
  "grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line transition-colors hover:border-line-strong hover:bg-surface-strong disabled:opacity-40";

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

export function Transfers({
  initial,
  between,
}: {
  initial: DownloadEntry[];
  /**
   * The tab's own list, drawn between the two halves of this one.
   *
   * Threaded through rather than composed around it, because the order the tab
   * reads in — what is moving, what is still to send, what has been sent —
   * puts a section from outside this component in the middle of two that share
   * one poll, one error banner and one confirmation dialog. Splitting those in
   * half to get a section between them would be three components keeping one
   * conversation with qBittorrent in step.
   *
   * Named for where it goes rather than what it is: `pending` is taken here by
   * the transition flag, and this component has no business knowing that the
   * list handed to it is the wishlist's.
   */
  between?: React.ReactNode;
}) {
  const [entries, setEntries] = useState(initial);
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

  const inFlight = (e: DownloadEntry) =>
    Boolean(e.live && !e.live.done && !LOST_STATES.has(e.live.state));

  const active = entries.filter(inFlight);
  const past = entries.filter((e) => !inFlight(e));

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
   * Nothing sent, nothing drawn — not an empty state.
   *
   * Both halves of this were an empty state while it was a page, because a page
   * cannot be blank: one for a client that was never connected, one for a
   * client that has never been given anything. Under a list of releases to
   * fetch, either would be a second empty state stacked below the first, saying
   * the same thing about the same tab twice. A section that is not there is the
   * emptier answer — the same argument the jobs page's history makes.
   *
   * Connecting the client is still said where it can be acted on: the Settings
   * page, and the Download button itself, which is a plain magnet link until
   * there is somewhere to hand a release to.
   *
   * The tab's own list still is: nothing sent is a fact about this component,
   * not about the page it was handed.
   */
  if (entries.length === 0) return <>{between}</>;

  return (
    <div className="flex flex-1 flex-col gap-12">
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

      {active.length > 0 && (
        <section className="flex flex-col gap-1">
          <SectionHeading label="Downloading" />

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
                  <Poster
                    path={entry.posterPath}
                    name={named.get(entry.hash)}
                  />

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
                            paused ? qbResume(entry.hash) : qbPause(entry.hash),
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
        </section>
      )}

      {between}

      {past.length > 0 && (
        <section className="flex flex-col gap-1">
          <SectionHeading label="History" />

          <ul className="ruled flex flex-col">
            {past.map((entry, i) => {
              const d = entry.live;
              const finished = Boolean(entry.completedAt || d?.done);

              /*
               * What is exceptional about this row, if anything. A torrent
               * qBittorrent has lost the files for says so — otherwise a film
               * that finished, went missing and is quietly no longer offered
               * on the queue is a row that looks perfectly well and a queue
               * that seems to have forgotten it.
               */
              const mark =
                d && LOST_STATES.has(d.state)
                  ? (STATE_LABEL[d.state] ?? d.state).toUpperCase()
                  : finished
                    ? undefined
                    : "REMOVED";

              return (
                <li
                  key={entry.hash}
                  style={stagger(i)}
                  className="row-enter -mx-4 flex items-center gap-5 rounded-card px-4 py-4"
                >
                  <Poster
                    path={entry.posterPath}
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

                    {/* Being here says it finished; only the exceptions earn
                        a mark. */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {mark && <span className={CHIP}>{mark}</span>}
                      {d && SEEDING_STATES.has(d.state) && (
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          seeding
                        </span>
                      )}
                      <span className="text-xs opacity-40">
                        {[
                          `sent ${day(entry.addedAt)}`,
                          entry.completedAt
                            ? `finished ${day(entry.completedAt)}`
                            : undefined,
                          d ? gigabytes(d.sizeBytes) : undefined,
                          !d ? "no longer in qBittorrent" : undefined,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  </div>

                  <RowMenu
                    items={[
                      ...(d && SEEDING_STATES.has(d.state)
                        ? [
                            {
                              label: "Stop seeding",
                              onSelect: () =>
                                setConfirming({ kind: "seed", entry }),
                            },
                          ]
                        : []),
                      ...(d
                        ? [
                            {
                              label: "Remove from qBittorrent",
                              onSelect: () =>
                                setConfirming({ kind: "remove", entry }),
                            },
                          ]
                        : [
                            // A live entry cleared from history would only be
                            // adopted straight back on the next read.
                            {
                              label: "Clear from history",
                              onSelect: () =>
                                setConfirming({ kind: "forget", entry }),
                            },
                          ]),
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        </section>
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
          // Red for the one that deletes something. The other three are all
          // undoable — a torrent can be sent again, seeding resumed, a record
          // re-made by the next fetch.
          tone={confirmShown.kind === "cancel" ? "danger" : "neutral"}
          confirmLabel={ASK[confirmShown.kind].label}
          busy={pending}
          onConfirm={() => {
            const { kind, entry } = confirmShown;
            control(async () => {
              if (kind === "cancel") return qbRemove(entry.hash, true);
              if (kind === "remove") return qbRemove(entry.hash, false);
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
