"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  convertJobStatus,
  doviJobStatus,
  scanStatus,
  stopConvert,
  stopFullDoviScan,
} from "@/app/actions";
import type { ConvertJob } from "@/lib/convert";
import type { JobRun } from "@/lib/jobs";
import type { DoviJob } from "@/lib/dovi";
import type { ScanState } from "@/lib/scanner";

/**
 * Every long-running job in one place.
 *
 * They were each reporting somewhere different — the scan in a toast, the RPU
 * pass and the conversion on the film's own page — which meant the only way to
 * see whether something was running was to be on the right screen. Polling one
 * page for all three is cheap, and it is also the only place a job that has
 * finished while you were elsewhere leaves a trace.
 */

const POLL_MS = 800;

const count = (n: number) => n.toLocaleString("en-GB");

const fileOf = (p?: string) => p?.split("/").pop() ?? "";

const ago = (at?: number) => {
  if (!at) return "";
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
};

function Bar({ percent }: { percent: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-surface-strong">
      <div
        className="h-full rounded-full bg-foreground/70 motion-safe:transition-[width] motion-safe:duration-300"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function Job({
  name,
  running,
  headline,
  detail,
  percent,
  onCancel,
  busy,
}: {
  name: string;
  running: boolean;
  headline: string;
  detail?: string;
  percent?: number;
  onCancel?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* A dot rather than a spinner: it says running without competing
              with the bar underneath for attention. */}
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${
              running
                ? "bg-emerald-500 motion-safe:animate-pulse"
                : "bg-foreground/20"
            }`}
          />
          <span className="font-display text-lg font-semibold tracking-tight">
            {name}
          </span>
        </div>

        {running && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-control border border-line px-2.5 py-1 text-xs hover:bg-surface-strong disabled:opacity-40"
          >
            Cancel
          </button>
        )}
      </div>

      <p className={`text-sm ${running ? "" : "opacity-45"}`}>{headline}</p>
      {detail && <p className="text-xs opacity-45">{detail}</p>}
      {running && percent !== undefined && <Bar percent={percent} />}
    </div>
  );
}

const KIND_NAMES: Record<JobRun["kind"], string> = {
  scan: "Library scan",
  dovi: "Dolby Vision full pass",
  convert: "Profile 7 → 8.1 conversion",
};

const STATUS_STYLE: Record<JobRun["status"], string> = {
  done: "text-emerald-600 dark:text-emerald-400",
  cancelled: "opacity-45",
  error: "text-red-600 dark:text-red-400",
};

/** Rounded to whatever unit makes the number small. */
function took(run: JobRun) {
  const seconds = Math.max(1, Math.round((run.finishedAt - run.startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

export function ProcessesView({
  initial,
  history,
}: {
  initial: { scan: ScanState; dovi: DoviJob; convert: ConvertJob };
  history: JobRun[];
}) {
  const [scan, setScan] = useState(initial.scan);
  const [dovi, setDovi] = useState(initial.dovi);
  const [convert, setConvert] = useState(initial.convert);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const scanning = ["scanning", "dovi", "matching", "discs"].includes(
    scan.status,
  );
  const reading = dovi.status === "running";
  const converting = convert.status === "running";
  const anyRunning = scanning || reading || converting;

  useEffect(() => {
    const id = setInterval(async () => {
      const [nextScan, nextDovi, nextConvert] = await Promise.all([
        scanStatus(),
        doviJobStatus(),
        convertJobStatus(),
      ]);
      setScan(nextScan);
      setDovi(nextDovi);
      setConvert(nextConvert);
    }, POLL_MS);

    return () => clearInterval(id);
  }, []);

  // A finished job changed the library underneath whatever else is open.
  useEffect(() => {
    if (!anyRunning) router.refresh();
  }, [anyRunning, router]);

  const scanHeadline = (() => {
    const handled = scan.probed + scan.cached + scan.failed;
    switch (scan.status) {
      case "scanning":
        return `Reading files — ${count(handled)} of ${count(scan.discovered)}`;
      case "dovi":
        return `Reading Dolby Vision metadata — ${scan.doviDone} of ${scan.doviTotal}`;
      case "matching":
        return `Matching against TMDb — ${scan.matchDone} of ${scan.matchTotal}`;
      case "discs":
        return `Looking up discs — ${scan.discDone} of ${scan.discTotal}`;
      case "error":
        return scan.error ?? "Failed";
      case "done":
        return `Last scan finished ${ago(scan.finishedAt)}`;
      default:
        return "Not running";
    }
  })();

  const scanPercent = (() => {
    const handled = scan.probed + scan.cached + scan.failed;
    if (scan.status === "scanning" && scan.discovered)
      return (handled / scan.discovered) * 100;
    if (scan.status === "dovi" && scan.doviTotal)
      return (scan.doviDone / scan.doviTotal) * 100;
    if (scan.status === "matching" && scan.matchTotal)
      return (scan.matchDone / scan.matchTotal) * 100;
    if (scan.status === "discs" && scan.discTotal)
      return (scan.discDone / scan.discTotal) * 100;
    return 0;
  })();

  return (
    <div className="flex flex-col gap-8">
      {/* Only what is actually happening. Three idle cards saying "not running"
          said less than the history below, which already records what each of
          them last did. */}
      {anyRunning && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            Running now
          </h2>

          {scanning && (
            <Job
              name="Library scan"
              running
              headline={scanHeadline}
              detail={
                scan.current
                  ? scan.status === "scanning"
                    ? fileOf(scan.current)
                    : scan.current
                  : undefined
              }
              percent={scanPercent}
            />
          )}

          {reading && (
            <Job
              name="Dolby Vision full pass"
              running
              headline={`Reading every frame of ${fileOf(dovi.path)}`}
              detail={`${Math.round(dovi.percent)}% · ${count(dovi.frames)} frames read`}
              percent={dovi.percent}
              busy={busy}
              onCancel={() => {
                setBusy(true);
                void stopFullDoviScan().then((j) => {
                  setDovi(j);
                  setBusy(false);
                });
              }}
            />
          )}

          {converting && (
            <Job
              name="Profile 7 → 8.1 conversion"
              running
              headline={`Converting ${fileOf(convert.path)}`}
              detail={`${convert.label ?? "Working"} — step ${convert.step} of ${convert.steps}`}
              percent={convert.percent}
              busy={busy}
              onCancel={() => {
                setBusy(true);
                void stopConvert().then((j) => {
                  setConvert(j);
                  setBusy(false);
                });
              }}
            />
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            History
          </h2>
          {history.length > 0 && (
            <span className="text-xs opacity-40">last {history.length}</span>
          )}
        </div>

        {history.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-10 text-center text-sm opacity-45">
            {anyRunning
              ? "Nothing has finished yet."
              : "Nothing has run yet. Scan the library to get started."}
          </p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {history.map((run) => (
              <div key={run.id} className="flex items-start gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {KIND_NAMES[run.kind]}
                    {run.label && (
                      <span className="ml-2 opacity-50">{run.label}</span>
                    )}
                  </p>
                  {run.detail && (
                    <p className="mt-0.5 truncate text-xs opacity-45">
                      {run.detail}
                    </p>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  <p className={`text-xs ${STATUS_STYLE[run.status]}`}>
                    {run.status === "done"
                      ? "Finished"
                      : run.status === "cancelled"
                        ? "Cancelled"
                        : "Failed"}
                  </p>
                  <p className="mt-0.5 text-[11px] opacity-35 tabular-nums">
                    {ago(run.finishedAt)} · {took(run)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
