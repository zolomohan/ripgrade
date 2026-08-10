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
import { EmptyState } from "@/app/empty-state";
import { CloseButton, Modal, useLingering } from "@/app/modal";
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
 * record can still show. Polled while anything moves, still when nothing
 * does.
 */
const POLL_MS = 3000;

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

const ROW_ACTION =
  "grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line transition-colors hover:border-line-strong hover:bg-surface-strong disabled:opacity-40";

const ICON = {
  pause: <path d="M9 5v14M15 5v14" />,
  resume: <path d="M8 5.5v13l10.5-6.5z" />,
  remove: <path d="M6 6l12 12M18 6L6 18" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
};

function ActionIcon({ kind }: { kind: keyof typeof ICON }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4"
    >
      {ICON[kind]}
    </svg>
  );
}

/**
 * A history row's actions, folded behind one ellipsis: which of them exist
 * depends on the torrent's fate, and three conditionally-appearing circles
 * were a row that never looked the same twice.
 */
function RowMenu({
  items,
}: {
  items: { label: string; onSelect: () => void }[];
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
        aria-label="Actions"
        aria-expanded={open}
        title="Actions"
        className={`${ROW_ACTION} ${open ? "" : "opacity-50 hover:opacity-100"}`}
      >
        <ActionIcon kind="more" />
      </button>

      {open && (
        <div className="row-enter absolute top-full right-0 z-30 mt-2 w-56 overflow-hidden rounded-card border border-line bg-background py-1 shadow-2xl">
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

function Heading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {label}
      </h2>
      <div aria-hidden className="rule-head" />
    </div>
  );
}

export function DownloadsView({
  initial,
  configured,
}: {
  initial: DownloadEntry[];
  configured: boolean;
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
    kind: "cancel" | "remove" | "forget";
    entry: DownloadEntry;
  } | null>(null);
  const confirmShown = useLingering(confirming);

  const activeNow = entries.some((e) => e.live && !e.live.done);

  useEffect(() => {
    if (!activeNow) return;
    const id = setInterval(async () => {
      setEntries(await listDownloadLog());
    }, POLL_MS);
    return () => clearInterval(id);
  }, [activeNow]);

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

  const active = entries.filter((e) => e.live && !e.live.done);
  const past = entries.filter((e) => !e.live || e.live.done);

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

  if (!configured && entries.length === 0) {
    return (
      <EmptyState
        icon={
          <>
            <path d="M12 4v11" />
            <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
            <path d="M5 19h14" />
          </>
        }
        title="No download client connected"
        action={
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-full bg-foreground px-4 py-1.5 text-sm text-background transition-opacity hover:opacity-90"
          >
            Connect qBittorrent
          </Link>
        }
      >
        Connect qBittorrent in Settings and every Download button hands the
        release over — progress, controls and history all land here.
      </EmptyState>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={
          <>
            <path d="M12 4v11" />
            <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
            <path d="M5 19h14" />
          </>
        }
        title="Nothing sent yet"
      >
        Every release sent from a Download button lands here — live progress
        while it fetches, and the record of it afterwards.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-12">
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
          <Heading label="Downloading" />

          <ul className="ruled flex flex-col">
            {active.map((entry, i) => {
              const d = entry.live!;
              const paused = PAUSED_STATES.has(d.state);
              const percent = Math.floor(d.progress * 100);
              return (
                <li
                  key={entry.hash}
                  style={stagger(i)}
                  className="row-enter -mx-4 flex items-center gap-5 rounded-card px-4 py-4"
                >
                  <Poster path={entry.posterPath} name={named.get(entry.hash)} />

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
                        row's whole width, which a dial never quite did. */}
                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-strong">
                      <div
                        className={`h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500 ${
                          paused ? "bg-foreground/30" : "bg-foreground/70"
                        }`}
                        style={{ width: `${Math.min(100, percent)}%` }}
                      />
                    </div>

                    <p className="mt-2 text-xs tabular-nums opacity-45">
                      {[
                        `${percent}% of ${gigabytes(d.sizeBytes)}`,
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

                  <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          control(() =>
                            paused ? qbResume(entry.hash) : qbPause(entry.hash),
                          )
                        }
                        disabled={pending}
                        aria-label={paused ? "Resume" : "Pause"}
                        title={paused ? "Resume" : "Pause"}
                        className={ROW_ACTION}
                      >
                        {/* The client is being asked, and the answer arrives
                            on the next poll rather than with the click — so
                            the wheel takes the mark's place until it does. */}
                        {pending ? (
                          <Spinner className="h-3.5 w-3.5" />
                        ) : (
                          <ActionIcon kind={paused ? "resume" : "pause"} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming({ kind: "cancel", entry })}
                        disabled={pending}
                        aria-label="Cancel this download"
                        title="Cancel this download"
                        className={ROW_ACTION}
                      >
                        <ActionIcon kind="remove" />
                      </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <section className="flex flex-col gap-1">
          <Heading label="History" />

          <ul className="ruled flex flex-col">
            {past.map((entry, i) => {
              const d = entry.live;
              const finished = Boolean(entry.completedAt || d?.done);
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

                    {/* Being here says it finished; only the exception — a
                        download that never did — earns a mark. */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {!finished && (
                        <span className="rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap opacity-60 ring-1 ring-line-strong ring-inset">
                          REMOVED
                        </span>
                      )}
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
                                control(() => qbPause(entry.hash)),
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

      {confirmShown && (
        <Modal
          open={confirming !== null}
          onClose={() => setConfirming(null)}
          dismissible={!pending}
          label="Confirm"
          panelClassName="w-full max-w-md overflow-hidden rounded-card border border-line bg-background shadow-2xl"
        >
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight">
                  {confirmShown.kind === "cancel"
                    ? "Cancel this download?"
                    : confirmShown.kind === "remove"
                      ? "Remove from qBittorrent?"
                      : "Clear from history?"}
                </h2>
                <p className="mt-1 truncate font-mono text-xs opacity-45">
                  {confirmShown.entry.filmTitle ?? confirmShown.entry.title}
                </p>
              </div>
              {/* Grey while the request is in flight, for the same reason the
                  backdrop stops dismissing then. */}
              <CloseButton
                onClick={() => setConfirming(null)}
                disabled={pending}
              />
            </div>

            {/* The floor the title stands on, as under every other dialog's. */}
            <div aria-hidden className="rule-head" />

            <p className="text-sm opacity-70">
              {confirmShown.kind === "cancel"
                ? "The download stops and its partial files are deleted — half a file is no use to anyone. The history entry stays, marked as never finished."
                : confirmShown.kind === "remove"
                  ? "The torrent leaves qBittorrent. The downloaded files and this history entry both stay — the files are the point, and the record is the record."
                  : "Only the record is forgotten. Nothing on the drive or in qBittorrent is touched."}
            </p>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={pending}
                className="text-sm opacity-50 transition-opacity hover:opacity-100 disabled:opacity-30"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => {
                  const { kind, entry } = confirmShown;
                  control(async () => {
                    if (kind === "cancel") return qbRemove(entry.hash, true);
                    if (kind === "remove") return qbRemove(entry.hash, false);
                    // The only one that touches nothing but our own table,
                    // and so the only one with no client to refuse it.
                    return forgetDownloadEntry(entry.hash);
                  });
                  setConfirming(null);
                }}
                disabled={pending}
                className={`rounded-full px-4 py-1.5 text-sm transition-opacity hover:opacity-90 disabled:opacity-50 ${
                  confirmShown.kind === "cancel"
                    ? "bg-red-600 text-white"
                    : "bg-foreground text-background"
                }`}
              >
                {confirmShown.kind === "cancel"
                  ? "Cancel download"
                  : confirmShown.kind === "remove"
                    ? "Remove"
                    : "Clear"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
