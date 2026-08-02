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

export function ProcessesView({
  initial,
}: {
  initial: { scan: ScanState; dovi: DoviJob; convert: ConvertJob };
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
    <div className="flex flex-col gap-4">
      {!anyRunning && (
        <p className="text-sm opacity-45">
          Nothing running. What each job last did is below.
        </p>
      )}

      <Job
        name="Library scan"
        running={scanning}
        headline={scanHeadline}
        detail={
          scanning && scan.current
            ? scan.status === "scanning"
              ? fileOf(scan.current)
              : scan.current
            : scan.status === "done"
              ? `${count(scan.probed)} probed · ${count(scan.cached)} unchanged${
                  scan.removed ? ` · ${count(scan.removed)} removed` : ""
                }`
              : undefined
        }
        percent={scanPercent}
      />

      <Job
        name="Dolby Vision full pass"
        running={reading}
        headline={
          reading
            ? `Reading every frame of ${fileOf(dovi.path)}`
            : dovi.status === "done"
              ? `Finished ${ago(dovi.finishedAt)} — ${count(dovi.frames)} frames`
              : dovi.status === "cancelled"
                ? `Cancelled ${ago(dovi.finishedAt)}`
                : dovi.status === "error"
                  ? (dovi.error ?? "Failed")
                  : "Not running"
        }
        detail={
          reading
            ? `${Math.round(dovi.percent)}% · ${count(dovi.frames)} frames read`
            : undefined
        }
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

      <Job
        name="Profile 7 → 8.1 conversion"
        running={converting}
        headline={
          converting
            ? `Converting ${fileOf(convert.path)}`
            : convert.status === "done"
              ? `Finished ${ago(convert.finishedAt)}${convert.check ? ` — ${convert.check}` : ""}`
              : convert.status === "cancelled"
                ? `Cancelled ${ago(convert.finishedAt)}`
                : convert.status === "error"
                  ? (convert.error ?? "Failed")
                  : "Not running"
        }
        detail={
          converting
            ? `${convert.label ?? "Working"} — step ${convert.step} of ${convert.steps}`
            : undefined
        }
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
    </div>
  );
}
