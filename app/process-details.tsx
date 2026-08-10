"use client";

import { useEffect, useRef, useState } from "react";

import { visibleOutput } from "@/lib/job-output";
import { useNow } from "./clock";
import { BUTTON } from "./controls";
import { CloseButton, Modal } from "./modal";
import { Spinner } from "./spinner";

/**
 * Everything a running job knows, for when the rail is not enough.
 *
 * The rail deliberately says only what is running and how far along — a name
 * and a bar. This is where the rest went: what the job is doing this second,
 * the counters that only matter when you are asking a question about them, how
 * long it has been going, and what the tool behind it is saying.
 *
 * It reads the same job stream the rail does, so it keeps counting while it is
 * open and empties itself the moment the job ends.
 *
 * Three blocks, in the order the questions are asked. How far along — the
 * figure, the stage and the bar, which are one fact and are drawn as one.
 * What it is working on — every fact a labelled row of a single ruled block,
 * because a job's facts are a table and laying them out as loose pairs made
 * them read as decoration. And what the tool said, in the same code block the
 * app prints commands in.
 */

export type ProcessRow = {
  label: string;
  value: string;
  /** Paths and step names: monospace, and cut to one line rather than wrapped. */
  mono?: boolean;
  /** Drawn dimmer — a zero that is only present for the sake of the row. */
  quiet?: boolean;
};

export type ProcessDetail = {
  /** The job's plain name, without the counts the rail packs into its label. */
  title: string;
  percent?: number;
  /**
   * What is happening this second, in a few words — read beside the figure,
   * where the eye already is, rather than filed as another row below.
   */
  stage?: string;
  /** The job's facts, in the order they are worth reading. */
  rows: ProcessRow[];
  startedAt?: number;
  /** A closing word on what the job is for, when it needs one. */
  note?: string;
  /** The tail of what the tool behind this job has printed, newest last. */
  output?: string[];
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

/** Ticks once a second while the dialog is up, and not at all when it is not. */
function useElapsed(startedAt?: number): string | null {
  const now = useNow(startedAt !== undefined);

  if (startedAt === undefined || now === 0) return null;
  return elapsedOf(startedAt, now);
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
  const lines = visibleOutput(shown?.output);
  // The two things that mean "there is something new to see": another line, or
  // the open one being written over — which is how a spinner moves.
  const lineCount = lines.length;
  const lastLine = lines[lineCount - 1] ?? "";

  const log = useRef<HTMLDivElement>(null);
  /**
   * Whether the log is being watched or read. New output follows the bottom
   * only while it is already there — scrolling up to look at something and
   * having the next line yank it away is the one way a log can be worse than
   * no log.
   */
  const pinned = useRef(true);

  useEffect(() => {
    const el = log.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lineCount, lastLine]);

  if (!shown) return null;

  // The clock is a fact about the job like any other, so it is a row like any
  // other — appended here rather than remembered by every caller.
  const rows: ProcessRow[] = elapsed
    ? [...shown.rows, { label: "Elapsed", value: elapsed }]
    : shown.rows;

  return (
    <Modal
      open={detail !== null}
      onClose={onClose}
      label={`${shown.title} — progress`}
      // Capped at the viewport, because the log below can be as tall as it
      // likes and a dialog taller than the screen has no way out of itself.
      panelClassName="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 glass-panel rounded-card border border-line p-6 shadow-2xl"
    >
      <>
        {/* The name and the way out, and nothing else. The figure used to sit
            up here beside the close circle, which read as a pair of controls
            and put the number a column away from the bar it belongs to. */}
        <header className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-base font-semibold">
            {shown.title}
          </h2>
          <CloseButton onClick={onClose} />
        </header>

        {/* The floor the title stands on, as under every other dialog's. */}
        <div aria-hidden className="rule-head" />

        {(shown.percent !== undefined || shown.stage) && (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              {shown.percent !== undefined && (
                <p className="text-2xl leading-none font-semibold tabular-nums">
                  {Math.round(shown.percent)}%
                </p>
              )}
              {shown.stage && (
                <p
                  className="min-w-0 truncate text-xs opacity-55"
                  title={shown.stage}
                >
                  {shown.stage}
                </p>
              )}
            </div>
            {shown.percent !== undefined && (
              <div className="bar-track">
                <div
                  className="bar-fill motion-safe:transition-[width] motion-safe:duration-300"
                  style={{
                    width: `${Math.min(100, Math.max(0, shown.percent))}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* One block, parted by the hairline the app parts every stack of bands
            with. A path is cut to a line and kept on its hover; anything that
            is a sentence rather than a figure wraps instead, which is what used
            to push text out of a half-width cell. */}
        {rows.length > 0 && (
          <dl className="overflow-hidden rounded-control border border-line">
            {rows.map((row) => (
              <div
                key={row.label}
                className="card-band flex items-baseline justify-between gap-4 px-3 py-2"
              >
                <dt className="shrink-0 text-xs opacity-50">{row.label}</dt>
                <dd
                  className={`min-w-0 text-right text-xs ${
                    row.mono ? "truncate font-mono" : "break-words tabular-nums"
                  } ${row.quiet ? "opacity-40" : ""}`}
                  title={row.mono ? row.value : undefined}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {/* What the tool is actually saying, which is where the answer is
            whenever a job stops making sense. The same code block the app
            prints its commands in, and the scrolling element of the dialog —
            so the panel keeps its cap and this takes whatever is left. */}
        {lines.length > 0 && (
          <div className="flex min-h-0 flex-col gap-1.5">
            <p className="text-[10px] tracking-wide uppercase opacity-40">
              Output
            </p>
            <div
              ref={log}
              onScroll={() => {
                const el = log.current;
                if (!el) return;
                // A line of slack, so being a pixel off the bottom does not
                // count as having scrolled away from it.
                pinned.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              }}
              className="max-h-56 min-h-0 overflow-y-auto overscroll-contain rounded-control border border-line bg-surface-strong"
            >
              <pre className="p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
                {lines.join("\n")}
              </pre>
            </div>
          </div>
        )}

        {shown.note && (
          <p className="text-xs break-words opacity-45">{shown.note}</p>
        )}

        {/* Only what this dialog can *do*. Leaving it is the circle in the
            corner now, and a footer button saying the same thing was two ways
            out of a dialog that only needs one. */}
        {onCancel && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              // The dialog's filled red, same as the confirmations on the film
              // page — this is the thing the dialog is for, not one option in
              // a row, so it does not wait for hover to say what it is.
              className={BUTTON.confirm}
            >
              {busy && <Spinner />}
              Stop
            </button>
          </div>
        )}
      </>
    </Modal>
  );
}
