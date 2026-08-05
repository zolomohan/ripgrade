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
import { queueTheme, ScoreDial } from "@/app/score-circle";
import { stagger } from "@/app/stagger";
import { compareId, movieId, posterName } from "@/lib/routes";
import type { UpgradeQueueItem } from "@/lib/upgrade-sweep";
import type { WishlistFind } from "@/lib/wishlist-search";

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

/** A release that reaches this leaves the film with nothing left to want. */
const TOPS_OUT = 100;

const topsOut = (item: UpgradeQueueItem) => item.hit.score >= TOPS_OUT;

/**
 * Which film the release dialog is open for.
 *
 * One dialog serves the whole page, and the two kinds of row ask it different
 * questions: an upgrade is searched by the path of the copy you have, a want
 * by the TMDb id of the film you do not. Carried as a union rather than two
 * pieces of state, so opening one closes the other by construction.
 */
type Finding =
  | { kind: "upgrade"; item: UpgradeQueueItem }
  | { kind: "want"; find: WishlistFind };

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
          theme={queueTheme(hit.score)}
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
 * A wanted film something was found for.
 *
 * The same row as an upgrade, minus everything that assumes you own a copy:
 * there is no compare page to open, no local poster to morph across to it, and
 * no gain to report — the score is the release's own, absolute. What is left
 * is the part that matters equally either way: what it is, how good it looks,
 * and the two buttons that get it.
 */
function WishRow({
  find,
  index,
  onMore,
}: {
  find: WishlistFind;
  index: number;
  onMore: () => void;
}) {
  const { hit } = find;
  const pills = [hit.resolution, hit.hdr, hit.releaseType].filter(
    Boolean,
  ) as string[];

  return (
    /* Opening the full release list is the only thing this row can do, so it
       is what the row does — where an upgrade's row opens the comparison. */
    <li
      role="button"
      tabIndex={0}
      onClick={onMore}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onMore();
        }
      }}
      aria-label={`All releases for ${find.title}`}
      style={stagger(index)}
      className="glow row-enter group -mx-4 flex cursor-pointer items-center gap-5 rounded-card px-4 py-4 transition-colors hover:bg-surface"
    >
      {/* Remote only: a film you do not have has no poster on the drive. */}
      <Art
        src={undefined}
        remote={find.posterPath}
        size="w92"
        loading="lazy"
        className="h-24 w-16 shrink-0 rounded-control object-cover ring-1 ring-line"
      />

      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-base font-medium">
            {find.title}
          </span>
          {find.year && (
            <span className="shrink-0 text-sm opacity-40">{find.year}</span>
          )}
        </p>

        <p
          className="mt-1.5 truncate font-mono text-xs opacity-55"
          title={hit.title}
        >
          {hit.title}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {pills.map((pill) => (
            <Chip key={pill}>{pill}</Chip>
          ))}
          <span className="text-xs opacity-40">
            {[
              gigabytes(hit.sizeBytes),
              hit.seeders !== undefined ? `${hit.seeders} seeders` : undefined,
              hit.indexer,
              `found ${ago(find.checkedAt)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </div>

      {/* No gain beneath this one. Nothing is being improved on — the number
          is simply how good the release is, which is the whole question when
          the alternative is not having the film at all. */}
      <div className="flex w-14 shrink-0 flex-col items-center gap-1">
        <ScoreDial
          score={hit.score}
          theme={queueTheme(hit.score)}
          size={48}
          title={`Predicted ${hit.score} — you do not have this film`}
          srLabel={`Predicted score ${hit.score}, not in the library`}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
          <MagnetAction
            magnet={hit.magnet}
            film={{ title: find.title, posterPath: find.posterPath }}
            size="md"
          />
        ) : (
          <span
            className="grid h-9 w-9 place-items-center rounded-full text-[10px] opacity-25"
            title="This indexer publishes no magnet - open the details page for it."
          >
            {"—"}
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
            ? `Search for something better than the ${candidates} films below their best, then for the films on your wishlist`
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
  finds,
  candidates,
  checked,
  jackettReady,
}: {
  queue: UpgradeQueueItem[];
  /** What the last scan's wishlist pass turned up, best first. */
  finds: WishlistFind[];
  candidates: number;
  checked: number;
  jackettReady: boolean;
}) {
  const { jobs, apply } = useJobs();
  const sweep = jobs.sweep;
  const sweeping = sweep.status === "running";
  // Which film has its full release list open.
  const [finding, setFinding] = useState<Finding | null>(null);
  const shown = useLingering(finding);

  function run() {
    void startUpgradeSweep().then((job) => apply({ sweep: job }));
  }

  const finals = queue.filter(topsOut);
  const improvements = queue.filter((item) => !topsOut(item));

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


      {queue.length > 0 || finds.length > 0 ? (
        <>
          {/* The sort's two bands, made visible: a release that reaches 100
              takes the film off the hunt for good, which deserves more than
              being first in an undifferentiated list. The heads carry the
              same split the dials do — green above, amber below. One flat run
              when nothing tops anything out. */}
          {finals.length > 0 && (
            <section className="flex flex-col gap-1">
              <SectionHead label="The last upgrade" />
              <ul className="ruled flex flex-col">
                {finals.map((item, i) => (
                  <Row
                    key={item.path}
                    item={item}
                    index={i}
                    onMore={() => setFinding({ kind: "upgrade", item })}
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
                    index={finals.length + i}
                    onMore={() => setFinding({ kind: "upgrade", item })}
                  />
                ))}
              </ul>
            </section>
          )}

          {/* The third band, and the only one about films that are not on the
              drive at all. Last because an upgrade is a decision about a film
              you already chose once, and a want is a decision you have not
              made yet — but the same rows, because by the time something has
              been found the question is identical: is this one worth
              fetching. Filled by the scan, not by the sweep. */}
          {finds.length > 0 && (
            <section className="flex flex-col gap-1">
              <SectionHead label="Wishlist" />
              <ul className="ruled flex flex-col">
                {finds.map((find, i) => (
                  <WishRow
                    key={find.tmdbId}
                    find={find}
                    index={finals.length + improvements.length + i}
                    onMore={() => setFinding({ kind: "want", find })}
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

      {shown &&
        (shown.kind === "upgrade" ? (
          <ReleaseSearchModal
            open={finding !== null}
            subject={{ kind: "movie", path: shown.item.path }}
            title={shown.item.title}
            subtitle={shown.item.year ? String(shown.item.year) : undefined}
            posterPath={shown.item.posterRemote}
            configured={jackettReady}
            onClose={() => setFinding(null)}
          />
        ) : (
          // Searched by TMDb id rather than by path — the wishlist's own way
          // in, since there is no file to search from.
          <ReleaseSearchModal
            open={finding !== null}
            subject={{ kind: "tmdb", tmdbId: shown.find.tmdbId }}
            title={shown.find.title}
            subtitle={shown.find.year ? String(shown.find.year) : undefined}
            posterPath={shown.find.posterPath}
            configured={jackettReady}
            onClose={() => setFinding(null)}
          />
        ))}
    </div>
  );
}
