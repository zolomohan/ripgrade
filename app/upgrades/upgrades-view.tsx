"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { startUpgradeSweep } from "@/app/actions";
import { Art } from "@/app/art";
import { EmptyState } from "@/app/empty-state";
import { useJobs } from "@/app/jobs-provider";
import { MagnetAction } from "@/app/magnet-action";
import { useLingering } from "@/app/modal";
import { ReleaseSearchModal } from "@/app/release-search";
import { rememberListing } from "@/app/return-to";
import { ScoreDial } from "@/app/score-circle";
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

/** The release-search modal's own chip, so a fact reads the same here. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap opacity-70 ring-1 ring-line-strong ring-inset">
      {children}
    </span>
  );
}

/** A shelf-style section head, for the two bands the sort already makes. */
function SectionHead({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {label}
      </h2>
      <div aria-hidden className="rule-head" />
    </div>
  );
}

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

        {/* What the name claims, in the modal's own chips; the plainer facts
            follow as text. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {pills.map((pill) => (
            <Chip key={pill}>{pill}</Chip>
          ))}
          <span className="text-xs opacity-40">
            {[
              gigabytes(hit.sizeBytes),
              hit.seeders !== undefined ? `${hit.seeders} seeders` : undefined,
              hit.indexer,
              `checked ${ago(item.checkedAt)}`,
            ]
              .filter(Boolean)
              .join(" \u00b7 ")}
          </span>
        </div>
      </div>

      {/* The verdict, in the release modal's own dial: the predicted score in
          the library's verdict colours, the gain beneath it — which is what
          the list is ranked by. */}
      <div className="flex w-14 shrink-0 flex-col items-center gap-1">
        <ScoreDial
          score={hit.score}
          size={48}
          title={`Predicted ${hit.score}, from ${item.currentScore} now`}
          srLabel={`Predicted score ${hit.score}, up from ${item.currentScore}`}
        />
        <span className="text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
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
          // A handover when qBittorrent is connected, the plain magnet link
          // otherwise; it stops the row's own click itself.
          <MagnetAction
            magnet={hit.magnet}
            film={{ title: item.title, posterPath: item.posterRemote }}
            size="md"
          />
        ) : (
          <span
            className="grid h-9 w-9 place-items-center rounded-full text-[10px] opacity-25"
            title="This indexer publishes no magnet - open the details page for it."
          >
            \u2014
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * The sweep trigger, floating bottom-right — the one action this page is
 * for, reachable from anywhere in a long queue. Its icon is the mirror of
 * the download arrow on every release row: up, to the line. Progress lives
 * in the rail, which is on every screen anyway.
 */
function SweepFab({
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
      aria-label={sweeping ? "Sweeping" : "Run sweep"}
      title={
        sweeping
          ? "Sweeping - progress is in the rail"
          : jackettReady
            ? `Search the ${candidates} films below their best, one by one`
            : "Connect Jackett on the Settings page to search"
      }
      className="fixed right-6 bottom-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-foreground text-background shadow-2xl transition-opacity hover:opacity-90 disabled:opacity-40"
    >
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
        <path d="M12 20V9" />
        <path d="m7.5 13.5 4.5-4.5 4.5 4.5" />
        <path d="M5 5h14" />
      </svg>
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

  const finishers = queue.filter((item) => item.hit.score >= 100);
  const improvements = queue.filter((item) => item.hit.score < 100);

  const fab = (
    <SweepFab
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
      {sweep.status === "error" && sweep.error && (
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {sweep.error}
        </p>
      )}


      {queue.length > 0 ? (
        <>
          {/* The sort's two bands, made visible: a release that reaches 100
              takes the film off the hunt for good, which deserves more than
              being first in an undifferentiated list. One flat run when
              nothing finishes anything. */}
          {finishers.length > 0 && (
            <section className="flex flex-col gap-1">
              <SectionHead label="Finishes the film" />
              <ul className="ruled flex flex-col">
                {finishers.map((item, i) => (
                  <Row
                    key={item.path}
                    item={item}
                    index={i}
                    onMore={() => setFinding(item)}
                  />
                ))}
              </ul>
            </section>
          )}

          {improvements.length > 0 && (
            <section className="flex flex-col gap-1">
              <SectionHead label="Improvements" />
              <ul className="ruled flex flex-col">
                {improvements.map((item, i) => (
                  <Row
                    key={item.path}
                    item={item}
                    index={finishers.length + i}
                    onMore={() => setFinding(item)}
                  />
                ))}
              </ul>
            </section>
          )}

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
        >
          Every film short of its best was checked against the indexers. Sweep
          again once the trackers have had time to change.
        </EmptyState>
      )}

      {/* One dialog for the page: the row shows the sweep's single best find,
          and this is the way to the rest of the field. */}
      {fab}

      {shown && (
        <ReleaseSearchModal
          open={finding !== null}
          subject={{ kind: "movie", path: shown.path }}
          title={shown.title}
          subtitle={shown.year ? String(shown.year) : undefined}
          posterPath={shown.posterRemote}
          configured={jackettReady}
          onClose={() => setFinding(null)}
        />
      )}
    </div>
  );
}
