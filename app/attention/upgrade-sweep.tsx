"use client";

import Link from "next/link";
import { useState } from "react";

import { sweepUpgrades, type SweepRow } from "@/app/actions";
import { ScoreDial } from "@/app/score-circle";
import { movieId } from "@/lib/routes";

/**
 * One indexer search per flagged film, run a few at a time.
 *
 * The other tabs on this page list work the app has already worked out. This
 * one has to go and ask, and asking takes a search per film across every
 * tracker Jackett knows — so it runs on a button rather than on load, in small
 * batches, and can be stopped mid-way with everything found so far kept.
 *
 * Batching is what makes it stoppable: each call covers a handful of films and
 * returns, so stopping means declining to make the next call rather than
 * abandoning one long request.
 */

export type SweepTarget = {
  path: string;
  title: string;
  year?: number;
  score: number;
};

const BATCH = 5;

export function UpgradeSweep({
  targets,
  configured,
}: {
  targets: SweepTarget[];
  configured: boolean;
}) {
  const [rows, setRows] = useState<SweepRow[]>([]);
  const [running, setRunning] = useState(false);
  // Read inside the loop, so a click lands on the next batch rather than
  // waiting for a re-render to be noticed.
  const [stopSignal] = useState({ stopped: false });

  const byPath = new Map(targets.map((t) => [t.path, t]));
  const done = rows.length;

  async function start() {
    stopSignal.stopped = false;
    setRunning(true);
    setRows([]);

    const found: SweepRow[] = [];

    for (let i = 0; i < targets.length; i += BATCH) {
      if (stopSignal.stopped) break;

      const batch = targets.slice(i, i + BATCH).map((t) => t.path);
      try {
        found.push(...(await sweepUpgrades(batch)));
      } catch (err) {
        found.push(
          ...batch.map((path) => ({
            path,
            error: err instanceof Error ? err.message : String(err),
          })),
        );
      }
      setRows([...found]);
    }

    setRunning(false);
  }

  if (!configured) {
    return (
      <p className="rounded-card border border-line bg-surface px-4 py-3 text-sm opacity-60">
        Connect Jackett on the{" "}
        <Link href="/settings" className="underline underline-offset-2">
          Settings page
        </Link>{" "}
        to sweep these films for better releases.
      </p>
    );
  }

  // Only the ones that beat what is held. A sweep that lists every film again,
  // most of them with nothing better available, is the worklist it replaced.
  const improvements = rows
    .filter((r) => r.best && r.best.delta > 0)
    .sort((a, b) => (b.best?.delta ?? 0) - (a.best?.delta ?? 0));

  const searched = rows.filter((r) => !r.error).length;
  const errors = rows.filter((r) => r.error);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm">
            {running
              ? `Searching — ${done} of ${targets.length}`
              : rows.length === 0
                ? `${targets.length} films are flagged for upgrade`
                : `${improvements.length} of ${searched} have something better`}
          </p>
          <p className="text-xs opacity-45">
            One search per film, scored from the release name. Nothing is
            downloaded.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (running) stopSignal.stopped = true;
            else start();
          }}
          className="shrink-0 rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-strong"
        >
          {running ? "Stop" : rows.length > 0 ? "Sweep again" : "Start sweep"}
        </button>
      </div>

      {improvements.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {improvements.map((row) => {
            const target = byPath.get(row.path);
            const best = row.best!;

            return (
              <li key={row.path} className="flex items-start gap-4 px-4 py-3">
                <div className="flex w-11 shrink-0 flex-col items-center gap-1">
                  {/* Every row here beat the copy held — the list is
                      filtered to improvements — so the ring is green on the
                      same rule the modal uses. */}
                  <ScoreDial
                    score={best.score}
                    theme={{
                      stroke: "stroke-emerald-500",
                      text: "text-emerald-600 dark:text-emerald-400",
                    }}
                    title={`Predicted ${best.score}, ${best.delta} above your copy`}
                    srLabel={`Predicted score ${best.score}, ${best.delta} above your copy`}
                  />
                  <span className="text-[11px] tabular-nums text-emerald-600 dark:text-emerald-400">
                    +{best.delta}
                  </span>
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link
                    href={`/movie/${movieId(row.path)}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {target?.title ?? row.path}
                    {target?.year && (
                      <span className="ml-1.5 font-normal opacity-40">
                        {target.year}
                      </span>
                    )}
                  </Link>
                  <p
                    className="truncate font-mono text-[11px] opacity-45"
                    title={best.title}
                  >
                    {best.title}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3 self-center">
                  {best.seeders !== undefined && (
                    <span className="text-[11px] opacity-40">
                      {best.seeders} seeders
                    </span>
                  )}
                  <Link
                    href={`/movie/${movieId(row.path)}`}
                    className="rounded-control border border-line px-2.5 py-1 text-xs hover:bg-surface-strong"
                  >
                    Open
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!running && rows.length > 0 && improvements.length === 0 && (
        <p className="rounded-card border border-line bg-surface px-4 py-8 text-center text-sm opacity-50">
          Nothing better found for any of the {searched} films searched.
        </p>
      )}

      {errors.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {errors.length} search{errors.length === 1 ? "" : "es"} failed —{" "}
          {errors[0].error}
        </p>
      )}
    </div>
  );
}
