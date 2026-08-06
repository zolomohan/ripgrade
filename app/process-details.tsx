"use client";

import { useState, useSyncExternalStore } from "react";

import { CloseButton, Modal } from "./modal";

/**
 * Everything a running job knows, for when the rail is not enough.
 *
 * The rail deliberately says only what is running and how far along — a name
 * and a bar. This is where the rest went: the file being read this second, the
 * counters that only matter when you are asking a question about them, how
 * long it has been going. Opened by clicking the job, closed like any other
 * dialog.
 *
 * It reads the same job stream the rail does, so it keeps counting while it is
 * open and empties itself the moment the job ends.
 */

export type ProcessStat = {
  label: string;
  value: string;
  /** Drawn dimmer — a zero that is only present for the sake of the row. */
  quiet?: boolean;
};

export type ProcessDetail = {
  /** The job's plain name, without the counts the rail packs into its label. */
  title: string;
  percent?: number;
  /** The one line that changes: the file, film or step in hand right now. */
  current?: string;
  /** What `current` is — "Reading", "Film", "Folder". */
  currentLabel?: string;
  stats: ProcessStat[];
  startedAt?: number;
  /** A closing word on what the job is for, when it needs one. */
  note?: string;
};

/** 1:04, or 1:22:09 once it has been going long enough to need the hours. */
function elapsedOf(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours
    ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}`
    : `${minutes}:${pad(seconds % 60)}`;
}

/**
 * The wall clock, to the second, as something React can subscribe to.
 *
 * Whole seconds rather than milliseconds because the snapshot has to hold
 * still between reads within one render — `Date.now()` never does, and React
 * reads it more than once.
 */
const clock = {
  subscribe(onTick: () => void) {
    const timer = setInterval(onTick, 1000);
    return () => clearInterval(timer);
  },
  now: () => Math.floor(Date.now() / 1000),
  /** No clock on the server; nothing that depends on one is rendered there. */
  onServer: () => 0,
};

const idle = () => () => {};

/** Ticks once a second while the dialog is up, and not at all when it is not. */
function useElapsed(startedAt?: number): string | null {
  const seconds = useSyncExternalStore(
    startedAt === undefined ? idle : clock.subscribe,
    clock.now,
    clock.onServer,
  );

  if (startedAt === undefined || seconds === 0) return null;
  return elapsedOf(startedAt, seconds * 1000);
}

export function ProcessDetails({
  detail,
  onClose,
  onCancel,
  busy,
}: {
  /** Null once the job ends, which closes the dialog on its own. */
  detail: ProcessDetail | null;
  onClose: () => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  // Held so the contents survive the closing animation; without it the panel
  // blanks out a frame before it has finished leaving.
  const [held, setHeld] = useState(detail);
  if (detail && detail !== held) setHeld(detail);

  const shown = detail ?? held;
  const elapsed = useElapsed(shown?.startedAt);

  if (!shown) return null;

  return (
    <Modal
      open={detail !== null}
      onClose={onClose}
      label={`${shown.title} — progress`}
      panelClassName="flex w-full max-w-md flex-col gap-4 rounded-card border border-line bg-background p-6 shadow-2xl"
    >
      <>
        <header className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 text-base font-semibold">{shown.title}</h2>
          {/* The figure keeps its place beside the title; the circle takes the
              corner, where every other dialog in the app keeps it. */}
          <div className="flex shrink-0 items-center gap-3">
            {shown.percent !== undefined && (
              <p className="text-sm tabular-nums opacity-55">
                {Math.round(shown.percent)}%
              </p>
            )}
            <CloseButton onClick={onClose} />
          </div>
        </header>

        {shown.percent !== undefined && (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-strong">
            <div
              className="h-full rounded-full bg-foreground/70 motion-safe:transition-[width] motion-safe:duration-300"
              style={{
                width: `${Math.min(100, Math.max(0, shown.percent))}%`,
              }}
            />
          </div>
        )}

        {/* The line the rail refuses to draw. It belongs here, where it was
            asked for and where it has room to be read. */}
        {shown.current && (
          <div className="min-w-0 rounded-control border border-line bg-surface px-3 py-2">
            <p className="text-[10px] tracking-wide uppercase opacity-40">
              {shown.currentLabel ?? "Working on"}
            </p>
            <p className="mt-0.5 truncate font-mono text-xs" title={shown.current}>
              {shown.current}
            </p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          {shown.stats.map((stat) => (
            <div
              key={stat.label}
              className="flex items-baseline justify-between gap-2"
            >
              <dt className="truncate text-xs opacity-50">{stat.label}</dt>
              <dd
                className={`shrink-0 text-xs tabular-nums ${
                  stat.quiet ? "opacity-40" : ""
                }`}
              >
                {stat.value}
              </dd>
            </div>
          ))}
          {elapsed && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="truncate text-xs opacity-50">Elapsed</dt>
              <dd className="shrink-0 text-xs tabular-nums">{elapsed}</dd>
            </div>
          )}
        </dl>

        {shown.note && <p className="text-xs opacity-45">{shown.note}</p>}

        {/* Only what this dialog can *do*. Leaving it is the circle in the
            corner now, and a footer button saying the same thing was two ways
            out of a dialog that only needs one. */}
        {onCancel && (
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-control border border-red-500/40 bg-red-500/[0.10] px-3 py-1.5 text-sm text-red-700 hover:bg-red-500/20 disabled:opacity-40 dark:text-red-300"
            >
              Stop
            </button>
          </div>
        )}
      </>
    </Modal>
  );
}
