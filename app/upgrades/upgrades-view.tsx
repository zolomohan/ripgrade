"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { startUpgradeSweep } from "@/app/actions";
import { Art } from "@/app/art";
import { EmptyState } from "@/app/empty-state";
import { useJobs } from "@/app/jobs-provider";
import { useLingering } from "@/app/modal";
import { ReleaseSearchModal } from "@/app/release-search";
import { rememberListing } from "@/app/return-to";
import { stagger } from "@/app/stagger";
import { compareId, movieId, posterName } from "@/lib/routes";
import type { UpgradeQueueItem } from "@/lib/upgrade-sweep";

/**
 * The library ranked by what upgrading would gain.
 *
 * Every row is the sweep's one best answer for a film: the release most worth
 * replacing your copy with, and by how much. The searching already happened —
 * this page never touches an indexer, it reads what the sweep wrote. The
 * queue empties itself: replace a file, rescan, and its row falls out because
 * the gain is gone.
 */

const gigabytes = (bytes?: number) =>
  bytes === undefined ? undefined : `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** "3 h ago" — precise enough for "is this listing stale". */
function ago(then: number): string {
  const mins = Math.max(1, Math.round((Date.now() - then) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const ROW_ACTION =
  "grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line transition-colors hover:border-line-strong hover:bg-surface-strong";

function Row({
  item,
  index,
  onMore,
}: {
  item: UpgradeQueueItem;
  index: number;
  onMore: () => void;
}) {
  const { hit } = item;
  const router = useRouter();
  const pills = [hit.resolution, hit.hdr, hit.releaseType].filter(
    Boolean,
  ) as string[];

  // Recorded by hand: the delegated listener in return-to.tsx only sees
  // anchors, and this row navigates from a handler. Without the crumb the
  // compare page's back button has nowhere to morph the poster home to.
  function open() {
    rememberListing();
    router.push(`/compare/${compareId(item.compareKey)}`);
  }

  return (
    /* The row itself opens the film's compare page — the copy's full attribute
       table now, and the moment a replacement lands and is scanned, old and
       new side by side. A role rather than a link, because the row holds links
       and buttons of its own; those stop the click on its way up. */
    <li
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      aria-label={`Compare copies of ${item.title}`}
      style={stagger(index)}
      className="glow row-enter group -mx-4 flex cursor-pointer items-center gap-5 rounded-card px-4 py-4 transition-colors hover:bg-surface"
    >
      <Link
        href={`/film/${movieId(item.path)}`}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0"
        aria-label={item.title}
      >
        <Art
          src={item.poster}
          remote={item.posterRemote}
          version={item.artAt}
          // Named so it travels: the same poster stands in the compare hero
          // this row opens, and on the film page behind the poster link.
          transitionName={posterName(item.path)}
          size="w92"
          loading="lazy"
          className="h-24 w-16 rounded-control object-cover ring-1 ring-line"
        />
      </Link>

      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <Link
            href={`/film/${movieId(item.path)}`}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 truncate text-base font-medium hover:underline hover:underline-offset-4"
          >
            {item.title}
          </Link>
          {item.year && (
            <span className="shrink-0 text-sm opacity-40">{item.year}</span>
          )}
        </p>

        <p
          className="mt-1.5 truncate font-mono text-xs opacity-55"
          title={hit.title}
        >
          {hit.title}
        </p>

        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-40">
          {pills.length > 0 && <span>{pills.join(" · ")}</span>}
          {gigabytes(hit.sizeBytes) && <span>{gigabytes(hit.sizeBytes)}</span>}
          {hit.seeders !== undefined && (
            <span className="tabular-nums">{hit.seeders} seeders</span>
          )}
          {hit.indexer && <span>{hit.indexer}</span>}
          <span>checked {ago(item.checkedAt)}</span>
        </p>
      </div>

      {/* The point of the row: what you have, what you could have, and the
          difference — which is what the list is ranked by. */}
      <div className="flex shrink-0 items-baseline gap-2 font-score font-semibold tabular-nums">
        <span className="text-base opacity-45">{item.currentScore}</span>
        <span aria-hidden className="font-sans text-base font-normal opacity-30">
          →
        </span>
        <span className="text-xl">{hit.score}</span>
        <span className="text-sm text-emerald-600 dark:text-emerald-400">
          +{hit.delta}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMore();
          }}
          aria-label={`All releases for ${item.title}`}
          title="Every release, not just the best one"
          className={ROW_ACTION}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden
            className="h-4 w-4"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </button>

        {hit.detailsUrl && (
          <a
            href={hit.detailsUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            aria-label="Open the indexer's page for this release"
            title="Details on the indexer"
            className={ROW_ACTION}
          >
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
              <path d="M14 5h5v5" />
              <path d="M19 5l-7.5 7.5" />
              <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
            </svg>
          </a>
        )}

        {hit.magnet ? (
          <a
            href={hit.magnet}
            onClick={(e) => e.stopPropagation()}
            aria-label="Download"
            title={hit.magnet}
            className={`${ROW_ACTION} border-line-strong`}
          >
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
              <path d="M12 4v11" />
              <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
              <path d="M5 19h14" />
            </svg>
          </a>
        ) : (
          <span
            className="grid h-9 w-9 place-items-center rounded-full text-[10px] opacity-25"
            title="This indexer publishes no magnet — open the details page for it."
          >
            —
          </span>
        )}
      </div>
    </li>
  );
}

/** The mirror of the download arrow on every release row: up, to the line. */
function SweepButton({
  sweeping,
  jackettReady,
  candidates,
  onRun,
}: {
  sweeping: boolean;
  jackettReady: boolean;
  candidates: number;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={sweeping || !jackettReady}
      title={
        jackettReady
          ? `Search the ${candidates} films below their best, one by one`
          : "Connect Jackett on the Settings page to search"
      }
      className="flex shrink-0 items-center gap-2 rounded-full bg-foreground px-4 py-1.5 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="h-3.5 w-3.5"
      >
        <path d="M12 20V9" />
        <path d="m7.5 13.5 4.5-4.5 4.5 4.5" />
        <path d="M5 5h14" />
      </svg>
      {sweeping ? "Sweeping…" : "Run sweep"}
    </button>
  );
}

export function UpgradesView({
  queue,
  candidates,
  checked,
  jackettReady,
}: {
  queue: UpgradeQueueItem[];
  candidates: number;
  checked: number;
  jackettReady: boolean;
}) {
  const { jobs, apply } = useJobs();
  const sweep = jobs.sweep;
  const sweeping = sweep.status === "running";
  // Which film has its full release list open.
  const [finding, setFinding] = useState<UpgradeQueueItem | null>(null);
  const shown = useLingering(finding);

  function run() {
    void startUpgradeSweep().then((job) => apply({ sweep: job }));
  }

  const button = (
    <SweepButton
      sweeping={sweeping}
      jackettReady={jackettReady}
      candidates={candidates}
      onRun={run}
    />
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* A control row rather than a header, like the library's own: the
          count is the one fact worth stating, and the rail already says what
          page this is. Empty pages carry the button in their empty state,
          where the eye already is. */}
      {queue.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm opacity-55">
            {queue.length} {queue.length === 1 ? "film has" : "films have"} a
            better release on the indexers, best gain first.
          </p>

          <div className="flex items-center gap-3">
            {sweeping && (
              <span className="text-xs opacity-50" role="status">
                {sweep.done} of {sweep.total} checked
              </span>
            )}
            {button}
          </div>
        </div>
      )}

      {sweep.status === "error" && sweep.error && (
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {sweep.error}
        </p>
      )}

      {queue.length > 0 ? (
        <>
          <ul className="ruled flex flex-col">
            {queue.map((item, i) => (
              <Row
                key={item.path}
                item={item}
                index={i}
                onMore={() => setFinding(item)}
              />
            ))}
          </ul>

          <p className="text-xs opacity-45">
            Predicted from release names, not measured — the same reading the
            release search gives. A film falls off this list when a rescan
            shows its copy caught up.
          </p>
        </>
      ) : sweeping ? (
        <EmptyState
          icon={
            <>
              <path d="M12 20V9" />
              <path d="m7.5 13.5 4.5-4.5 4.5 4.5" />
              <path d="M5 5h14" />
            </>
          }
          title="Sweeping the library"
        >
          {sweep.done} of {sweep.total} films checked — anything found lands
          here as it turns up.
        </EmptyState>
      ) : checked === 0 ? (
        <EmptyState
          icon={
            <>
              <path d="M12 20V9" />
              <path d="m7.5 13.5 4.5-4.5 4.5 4.5" />
              <path d="M5 5h14" />
            </>
          }
          title="Nothing swept yet"
          action={button}
        >
          One sweep searches every film short of its best —{" "}
          {candidates.toLocaleString("en-GB")} right now — and queues whatever
          beats your copy.
        </EmptyState>
      ) : (
        <EmptyState
          icon={
            <>
              <circle cx="12" cy="12" r="8.5" />
              <path d="m8.5 12.5 2.5 2.5 4.5-5" />
            </>
          }
          title="Nothing beats what you have"
          action={button}
        >
          Every film short of its best was checked against the indexers. Sweep
          again once the trackers have had time to change.
        </EmptyState>
      )}

      {/* One dialog for the page: the row shows the sweep's single best find,
          and this is the way to the rest of the field. */}
      {shown && (
        <ReleaseSearchModal
          open={finding !== null}
          subject={{ kind: "movie", path: shown.path }}
          title={shown.title}
          subtitle={shown.year ? String(shown.year) : undefined}
          configured={jackettReady}
          onClose={() => setFinding(null)}
        />
      )}
    </div>
  );
}
