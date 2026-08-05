"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { stopConvert, stopFullDoviScan } from "@/app/actions";
import { useJobs } from "@/app/jobs-provider";
import { useScan } from "@/app/scan-provider";

/**
 * What is happening right now, at the foot of the rail.
 *
 * The three long jobs used to report in three places — the scan in a floating
 * toast, the Dolby Vision pass and the conversion on a page of their own — so
 * seeing whether anything was running meant being on the right screen, or
 * catching a toast before it went. The rail is on every screen and never
 * unmounts, which makes it the one place that can answer the question at any
 * moment. Nothing shows when nothing is running.
 *
 * Progress arrives over the job stream, including a job started from
 * somewhere else — the old idle poll existed only to notice those.
 *
 * There is no history here on purpose. A list of what finished told you what
 * you already watched finish.
 */

const count = (n: number) => n.toLocaleString("en-GB");

const fileOf = (path?: string) => path?.split("/").pop() ?? "";

function Bar({ percent }: { percent: number }) {
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-strong">
      <div
        className="h-full rounded-full bg-foreground/70 motion-safe:transition-[width] motion-safe:duration-300"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function Job({
  name,
  detail,
  percent,
  onCancel,
  busy,
}: {
  name: string;
  detail?: string;
  percent?: number;
  onCancel?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {name}
        </p>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="shrink-0 text-[10px] opacity-40 transition-opacity hover:opacity-100 disabled:opacity-20"
          >
            Stop
          </button>
        )}
      </div>

      {percent !== undefined && <Bar percent={percent} />}

      {detail && (
        <p className="mt-1 truncate text-[10px] opacity-40" title={detail}>
          {detail}
        </p>
      )}
    </div>
  );
}

export function SidebarProcesses() {
  const { state: scan, busy: scanning, result, dismiss } = useScan();
  const { jobs, apply } = useJobs();
  const { dovi, convert } = jobs;
  const [stopping, setStopping] = useState(false);
  const router = useRouter();

  const reading = dovi.status === "running";
  const converting = convert.status === "running";
  const anyRunning = scanning || reading || converting;

  // A job that finished changed the library underneath whatever is open.
  useEffect(() => {
    if (!anyRunning) router.refresh();
  }, [anyRunning, router]);

  if (!anyRunning && !result) return null;

  const handled = scan.probed + scan.cached + scan.failed;
  const scanPhase =
    scan.status === "scanning"
      ? {
          name: `Scanning · ${count(handled)} of ${count(scan.discovered)}`,
          percent: scan.discovered ? (handled / scan.discovered) * 100 : 0,
          detail: fileOf(scan.current),
        }
      : scan.status === "dovi"
        ? {
            name: `Dolby Vision · ${scan.doviDone} of ${scan.doviTotal}`,
            percent: scan.doviTotal ? (scan.doviDone / scan.doviTotal) * 100 : 0,
            detail: scan.current,
          }
        : scan.status === "matching"
          ? {
              name: `Matching · ${scan.matchDone} of ${scan.matchTotal}`,
              percent: scan.matchTotal
                ? (scan.matchDone / scan.matchTotal) * 100
                : 0,
              detail: scan.current,
            }
          : scan.status === "artwork"
            ? {
                name: `Artwork · ${scan.artDone} of ${scan.artTotal}`,
                percent: scan.artTotal
                  ? (scan.artDone / scan.artTotal) * 100
                  : 0,
                detail: scan.current,
              }
            : {
                name: `Discs · ${scan.discDone} of ${scan.discTotal}`,
                percent: scan.discTotal
                  ? (scan.discDone / scan.discTotal) * 100
                  : 0,
                detail: scan.current,
              };

  return (
    // Bare rather than boxed: it is part of the rail, not a panel visiting it.
    // `px-3` puts the labels on the same vertical line as the links above.
    <div className="flex w-full min-w-0 flex-col gap-3 px-3 py-1">
      {scanning && (
        <Job
          name={scanPhase.name}
          detail={scanPhase.detail}
          percent={scanPhase.percent}
        />
      )}

      {reading && (
        <Job
          name={`Reading DV · ${Math.round(dovi.percent)}%`}
          detail={fileOf(dovi.path)}
          percent={dovi.percent}
          busy={stopping}
          onCancel={() => {
            setStopping(true);
            void stopFullDoviScan().then((job) => {
              apply({ dovi: job });
              setStopping(false);
            });
          }}
        />
      )}

      {converting && (
        <Job
          name={`Converting · step ${convert.step} of ${convert.steps}`}
          detail={convert.label ?? fileOf(convert.path)}
          percent={convert.percent}
          busy={stopping}
          onCancel={() => {
            setStopping(true);
            void stopConvert().then((job) => {
              apply({ convert: job });
              setStopping(false);
            });
          }}
        />
      )}

      {/* The one piece of the old toast worth keeping: what the scan actually
          did. It clears itself, and clicking it clears it now. */}
      {!anyRunning && result && (
        <button
          type="button"
          onClick={dismiss}
          className="min-w-0 text-left"
          title={result.text}
        >
          <p
            className={`text-[11px] font-medium ${
              result.kind === "error" ? "text-red-600 dark:text-red-400" : ""
            }`}
          >
            {result.kind === "ok" ? "Scan complete" : "Scan failed"}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[10px] opacity-45">
            {result.text}
          </p>
        </button>
      )}
    </div>
  );
}
