"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Art } from "@/app/art";
import { EmptyState } from "@/app/empty-state";
import { useJobs } from "@/app/jobs-provider";
import type { Layout } from "@/app/listing";
import { MagnetAction } from "@/app/magnet-action";
import { useLingering } from "@/app/modal";
import { PosterTile, TILE_GRID_RULED, TILE_READING } from "@/app/poster-tile";
import { ReleaseSearchModal } from "@/app/release-search";
import { rememberListing } from "@/app/return-to";
import { queueTheme, ScoreDial } from "@/app/score-circle";
import { stagger } from "@/app/stagger";
import { TILE_MARK } from "@/app/tile-button";
import { ReleaseDetails } from "./release-details";
import { compareId, movieId, posterName } from "@/lib/routes";
import type { UpgradeQueueItem } from "@/lib/upgrade-sweep";
import type { WishlistFind } from "@/lib/wishlist-search";
import { Grouped, pickGroup, type GroupOption } from "@/app/grouping";
import { byTitle, pickSort, type SortOption } from "@/app/sorts";

/**
 * What the sweep found, in the two kinds it finds.
 *
 * One pass over the indexers answers two questions — is there a better copy of
 * a film I have, and has anything turned up for a film I want — and this file
 * draws both: `UpgradesView` for the first, `DownloadsView` for the second, one
 * tab each. They shared a list for a while, tagged by kind, which made the sort
 * menu offer a gain to rows that cannot have one and the sections a band that
 * was really a subject of its own.
 *
 * What they still share is everything below the row: the same release facts, the
 * same two buttons, the same dialog to the rest of the field, and the sorts and
 * cuts that read only the release. Those are written once here and typed by
 * whichever tab asks.
 *
 * Neither tab touches an indexer. The searching already happened — a sweep runs
 * at the end of every scan and a scan runs whenever the app is opened, so both
 * lists fill themselves and empty themselves: fetch a film, rescan, and its row
 * falls out because the question it stood for is answered. Neither tab carries a
 * control of the sweep's own — Rescan starts another pass, and how the pass is
 * getting on is the rail's to say.
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

/**
 * The two marks a release row wears beside the magnet.
 *
 * They were written twice — once on an upgrade's row and once on a want's — and
 * the second copy was already a `stopPropagation` away from the first. Once
 * each, here.
 *
 * Rows only. A tile carries the magnet and nothing else: these two are
 * questions rather than answers — show me the rest of the field, show me the
 * indexer's own page — and a grid of posters with a toolbar in the corner of
 * every one is a grid you have to read before you can look at it. Both are
 * offered in the dialog the poster opens instead. See `ReleaseTile`.
 */
function MoreButton({
  title,
  onMore,
}: {
  /** Whose releases these are, for the label. */
  title: string;
  onMore: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onMore();
      }}
      aria-label={`All releases for ${title}`}
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
  );
}

function IndexerLink({ href }: { href: string }) {
  return (
    <a
      href={href}
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
  );
}

/** And the gap left where an indexer publishes no magnet to hand over. */
function NoMagnet({ art = false }: { art?: boolean }) {
  return (
    <span
      className={
        art
          ? `${TILE_MARK} opacity-40`
          : "grid h-9 w-9 place-items-center rounded-full text-[10px] opacity-25"
      }
      title="This indexer publishes no magnet - open the details page for it."
    >
      {"—"}
    </span>
  );
}

/**
 * What the two kinds of row have in common.
 *
 * There was a tagged union here — an upgrade or a want, in one list, because
 * both were drawn in one tab and every sort had to cope with either. Split into
 * two tabs, each list holds one kind and the tag has nothing left to decide:
 * what remains shared is a release, the film's name, and when the indexers were
 * last asked about it, which is all the sorts below ever read.
 */
type Found = { title: string; checkedAt: number; hit: UpgradeQueueItem["hit"] };

/**
 * The orders that mean the same thing on either tab.
 *
 * Declared once and typed by whoever asks for them, rather than written into
 * both lists: a comparator that reads nothing but the release belongs to
 * neither tab. What each tab does own is what comes first — the sweep's own
 * ranking on the upgrades, which is the gain, and the release's own score on
 * the downloads, where there is no copy to gain against.
 *
 * One word differs, so it is a parameter: an upgrade was checked against a copy
 * you have, and a want was either found or not found at all.
 */
function releaseSorts<T extends Found>(checkedLabel: string): SortOption<T>[] {
  return [
    {
      key: "score",
      label: "Best release",
      compare: (a, b) => b.hit.score - a.hit.score,
    },
    {
      key: "size",
      label: "Largest download",
      compare: (a, b) => (b.hit.sizeBytes ?? 0) - (a.hit.sizeBytes ?? 0),
    },
    {
      key: "smallest",
      label: "Smallest download",
      compare: (a, b) => (a.hit.sizeBytes ?? 0) - (b.hit.sizeBytes ?? 0),
    },
    {
      // A well-seeded release is one that will actually finish.
      key: "seeders",
      label: "Most seeders",
      compare: (a, b) => (b.hit.seeders ?? 0) - (a.hit.seeders ?? 0),
    },
    {
      key: "checked",
      label: checkedLabel,
      compare: (a, b) => b.checkedAt - a.checkedAt,
    },
    {
      key: "title",
      label: "Title",
      compare: (a, b) => byTitle(a.title, b.title),
    },
  ];
}

/** How the upgrades are ranked: by what replacing your copy would gain. */
export const UPGRADE_SORTS: SortOption<UpgradeQueueItem>[] = [
  {
    // Falling through to the release's own score keeps two films with the same
    // gain in the order the sweep would have put them in.
    key: "gain",
    label: "Biggest gain",
    compare: (a, b) => b.hit.delta - a.hit.delta || b.hit.score - a.hit.score,
  },
  ...releaseSorts<UpgradeQueueItem>("Recently checked"),
];

/**
 * And the downloads, which have no gain to be ranked by.
 *
 * "Biggest gain" is not merely uninteresting on a want, it is unanswerable:
 * there is no copy on the drive for a release to be better than, so every row
 * would report the same nothing. The release's own score is the whole question
 * when the alternative is not having the film.
 */
export const DOWNLOAD_SORTS: SortOption<WishlistFind>[] =
  releaseSorts<WishlistFind>("Recently found");

/** The release-search modal's own chip, so a fact reads the same here. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap opacity-70 ring-1 ring-line-strong ring-inset">
      {children}
    </span>
  );
}

/**
 * The cuts either tab can be made along — one list, because the cuts that are
 * worth offering read the release and nothing else.
 *
 * "No grouping" leads, which is this app's rule for every ranked list: a ranking
 * cut into sections is no longer a ranking, so a list opens flat and sections
 * are something you ask for.
 *
 * There was one more, first and on by default, cutting the upgrades into "The
 * last upgrade" and "Improvements" by whether the release reached 100. It was
 * the page's oldest opinion and it had stopped earning the room: two headings
 * and two counts over a list already ranked by exactly the thing the bands were
 * standing in for — the top of the list is where the best releases are, which is
 * what "the last upgrade" means. A section head that only repeats the sort is a
 * rule drawn through a ranking for nothing.
 *
 * Typed on the shared shape rather than per tab: a cut that reads only the
 * release is one both lists can be handed, and a comparator or a bucket asked
 * for less than it is given is safe by construction.
 */
export const RELEASE_GROUPS: GroupOption<Found>[] = [
  { key: "none", label: "No grouping", of: () => "" },
  {
    // Which tracker is actually feeding the queue, which is invisible in a
    // list where every row names its indexer in eight-point grey.
    key: "indexer",
    label: "Indexer",
    of: (row) => row.hit.indexer ?? "Unknown indexer",
  },
  {
    key: "resolution",
    label: "Resolution",
    of: (row) => row.hit.resolution ?? "Unknown",
    order: ["2160p", "1080p", "720p"],
  },
  {
    key: "release",
    label: "Release type",
    of: (row) => row.hit.releaseType ?? "Unknown",
    order: ["REMUX", "BluRay", "WEB-DL", "WEBRip", "ENCODE"],
  },
  {
    key: "hdr",
    label: "Dynamic range",
    of: (row) => row.hit.hdr ?? "SDR",
    order: ["Dolby Vision", "HDR10+", "HDR10", "SDR"],
  },
];

/** How many films a section holds — the part both tabs can say. */
const filmsNote = (rows: unknown[]) =>
  `${rows.length} film${rows.length === 1 ? "" : "s"}`;

/**
 * What a section of upgrades holds, said in the terms it is about.
 *
 * A bucket of upgrades is worth the points it would add; a bucket of wants is
 * worth nothing in those terms and would read as "+0 to gain", which is not
 * modesty but nonsense — there is nothing to improve on. So the downloads tab
 * uses the plain count above, and only this one adds the gain.
 */
function gainNote(rows: UpgradeQueueItem[]): string {
  const gain = rows.reduce((total, row) => total + row.hit.delta, 0);
  return gain > 0 ? `${filmsNote(rows)} · +${gain} to gain` : filmsNote(rows);
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
      className="glow row-enter group -mx-4 flex cursor-pointer items-center gap-5 rounded-row px-4 py-4 transition-colors hover:bg-surface"
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
        <MoreButton title={item.title} onMore={onMore} />

        {hit.detailsUrl && <IndexerLink href={hit.detailsUrl} />}

        {hit.magnet ? (
          // A handover when qBittorrent is connected, the plain magnet link
          // otherwise; it stops the row's own click itself.
          <MagnetAction
            magnet={hit.magnet}
            film={{ title: item.title, posterPath: item.posterRemote }}
            size="md"
          />
        ) : (
          <NoMagnet />
        )}
      </div>
    </li>
  );
}

/**
 * The same release as a poster.
 *
 * Both tabs draw this, because the difference between them is two facts and not
 * a layout: an upgrade has a copy on the drive to be better than, so it can
 * report a gain, and a want has neither. Everything else about a release reads
 * the same whether or not you already own the film.
 *
 * A tile says three things and stops: which film this is, what the release
 * claims to be, and how good it would be. Everything a row printed down its
 * length — the release's own name, its size, who is seeding it, which indexer
 * answered — is in the dialog the poster opens; see ./release-details.tsx. The
 * name went first and most gladly: sixty characters of group tags, cut at the
 * front, is a grey smear under the title saying nothing you can act on.
 *
 * One mark over the artwork, and it is the magnet. This is a page about
 * fetching, so the one thing a tile should offer without being asked is the
 * fetch; the rest of the field and the indexer's own page are questions rather
 * than answers, and they are asked in the dialog. Three marks in the corner of
 * a picture was a toolbar over a poster.
 *
 * The dial keeps a plate because it is a figure — the rule this app's tiles have
 * always kept, and a two-digit number at eleven pixels cannot be read off a
 * photograph. The magnet does not, because it is a mark.
 */
function ReleaseTile({
  poster,
  title,
  year,
  hit,
  gain,
  scoreTitle,
  scoreLabel,
  index,
  onOpen,
  magnetPoster,
}: {
  poster: { src?: string; remote?: string; version?: number; name: string };
  title: string;
  year?: number;
  hit: UpgradeQueueItem["hit"];
  /** What replacing your copy would add, where there is a copy to replace. */
  gain?: number;
  scoreTitle: string;
  scoreLabel: string;
  index: number;
  /** Opens everything this tile does not say — see `ReleaseDetails`. */
  onOpen: () => void;
  /** The poster the download log should keep for this fetch. */
  magnetPoster?: string;
}) {
  return (
    <PosterTile
      poster={{
        src: poster.src,
        remote: poster.remote,
        version: poster.version,
      }}
      // The whole tile travels into the page it opens: the frame, the dial on
      // it and the gain with them.
      transitionName={poster.name}
      title={title}
      year={year}
      // The library card's own line, in the library card's own words: the facts
      // that separate one copy of a film from another, set as plain muted text.
      // They were chips, which is right in the release dialog where they stand
      // among prose and wrong in a grid — a shelf of posters with three outlined
      // boxes under every one reads as a form.
      facts={[hit.resolution, hit.hdr, hit.releaseType]}
      badge={
        // The dial on a disc of its own rather than on the artwork: the ring is
        // drawn in the line colour and the number in the verdict's, and neither
        // survives a bright poster underneath them.
        <span className="grid place-items-center rounded-full bg-background/85 p-0.5 backdrop-blur">
          <ScoreDial
            score={hit.score}
            theme={queueTheme(hit.score)}
            size={40}
            title={scoreTitle}
            srLabel={scoreLabel}
          />
        </span>
      }
      note={
        gain !== undefined && gain > 0 ? (
          <span
            className={`${TILE_READING} text-emerald-600 dark:text-emerald-400`}
            title="What replacing your copy would add to its score"
          >
            +{gain}
          </span>
        ) : undefined
      }
      actions={
        hit.magnet ? (
          <MagnetAction
            magnet={hit.magnet}
            film={{ title, posterPath: magnetPoster }}
            size="md"
            art
          />
        ) : (
          <NoMagnet art />
        )
      }
      label={title}
      index={index}
      onOpen={onOpen}
    />
  );
}

/**
 * A wanted film something was found for.
 *
 * The same row as an upgrade, minus everything that assumes you own a copy:
 * there is no compare page to open, no copy on the drive to score against, and
 * no gain to report — the score is the release's own, absolute. Where an
 * upgrade's row opens the comparison, this one opens the want itself on the
 * discover page, and the poster travels with it. What is left is the part that
 * matters equally either way: what it is, how good it looks, and the two
 * buttons that get it.
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
  const router = useRouter();
  const pills = [hit.resolution, hit.hdr, hit.releaseType].filter(
    Boolean,
  ) as string[];

  // The same crumb an upgrade's row leaves, for the same reason: the listener
  // in return-to.tsx only sees anchors, and this navigates from a handler.
  function open() {
    rememberListing();
    // Wishlist finds are films; the sweep only searches for those.
    router.push(`/discover/movie/${find.tmdbId}`);
  }

  return (
    /* The row opens the film's page on TMDb's side of the app — what the want
       actually is, and every release of it — which is the same bargain an
       upgrade's row strikes when it opens the comparison. The full release
       list is still one click away, on the button that says so; it used to be
       what the row itself did, which left no way in to the film at all. */
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
      aria-label={find.title}
      style={stagger(index)}
      className="glow row-enter group -mx-4 flex cursor-pointer items-center gap-5 rounded-row px-4 py-4 transition-colors hover:bg-surface"
    >
      {/* Remote only: a film you do not have has no poster on the drive.
          Named the way the wishlist names it, so the row travels into the
          page it opens rather than being swapped for it. */}
      <Art
        src={undefined}
        remote={find.posterPath}
        size="w92"
        transitionName={posterName(`tmdb-movie-${find.tmdbId}`)}
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
        {/* The same first action an upgrade's row carries, and on a want it is
            the only way to the rest of the field now that the row itself goes
            to the film. */}
        <MoreButton title={find.title} onMore={onMore} />

        {hit.detailsUrl && <IndexerLink href={hit.detailsUrl} />}

        {hit.magnet ? (
          <MagnetAction
            magnet={hit.magnet}
            film={{ title: find.title, posterPath: find.posterPath }}
            size="md"
          />
        ) : (
          <NoMagnet />
        )}
      </div>
    </li>
  );
}

/*
 * There was a failed-sweep notice here, on both tabs: the last error the sweep
 * stopped on, with a Try again beside it.
 *
 * It was the wrong place to say it. A sweep that gave up because Jackett was
 * not running is a fact about a service, and it was being reported at the head
 * of a list of films — where it outlived its own cause, since nothing clears a
 * frozen job but the next pass, and where it was the first thing on a page you
 * came to for the queue. Rescan is still the way to start another pass, and it
 * is already on this page; the rail is where a job says how it is getting on.
 */

/** The sweep's own mark: a file coming up to something better. */
const SWEEP_ICON = (
  <>
    <path d="M12 20V9" />
    <path d="m7.5 13.5 4.5-4.5 4.5 4.5" />
    <path d="M5 5h14" />
  </>
);

/**
 * Better copies of films you already have, ranked by what replacing them gains.
 *
 * Every row is the sweep's one best answer for a film. The searching already
 * happened — this list never touches an indexer, it reads what the sweep wrote,
 * and it empties itself: replace a file, rescan, and the row falls out because
 * the gain is gone.
 *
 * Nothing here starts a sweep. One runs at the end of every scan, and a scan
 * runs whenever the app is opened, so the list fills itself; a button that
 * asked the indexers again on demand sat in this corner for a while and it was
 * the loudest control on a page whose whole job is to be read.
 */
export function UpgradesView({
  queue,
  candidates,
  checked,
  jackettReady,
  sort,
  group,
  layout,
}: {
  queue: UpgradeQueueItem[];
  candidates: number;
  checked: number;
  jackettReady: boolean;
  /** A key from UPGRADE_SORTS; anything else falls back to the sweep's order. */
  sort?: string;
  /** A key from RELEASE_GROUPS; flat unless asked otherwise. */
  group?: string;
  /** Posters or rows — the fourth thing the listing bar asks. */
  layout: Layout;
}) {
  const { jobs } = useJobs();
  const router = useRouter();
  const sweep = jobs.sweep;
  const sweeping = sweep.status === "running";
  // Which film has its full release list open.
  const [finding, setFinding] = useState<UpgradeQueueItem | null>(null);
  const shown = useLingering(finding);
  /**
   * And which has the one release the sweep picked open.
   *
   * Two dialogs about the same film, deliberately: this one is "what did the
   * sweep find", which is one release read whole, and the other is "show me
   * everything", which is a search. Opening the second closes the first — a
   * dialog stacked on a dialog is a dialog you cannot see the edge of.
   */
  const [reading, setReading] = useState<UpgradeQueueItem | null>(null);
  const read = useLingering(reading);

  // Ranked whole, then cut if you asked for it: the sort decides the order and
  // the grouping decides where the rules fall. Neither is the page's own opinion
  // any more — it opens as one ranked list, which is what the sweep produced.
  const order = pickSort(UPGRADE_SORTS, sort);
  const grouping = pickGroup(RELEASE_GROUPS, group);
  const rows = [...queue].sort(order.compare);

  return (
    <div className="flex flex-1 flex-col gap-6">
      {rows.length > 0 ? (
        <Grouped items={rows} group={grouping} note={gainNote}>
          {(bucket, offset) =>
            layout === "grid" ? (
              <div className={TILE_GRID_RULED}>
                {bucket.map((item, index) => (
                  <ReleaseTile
                    key={item.path}
                    poster={{
                      src: item.poster,
                      remote: item.posterRemote,
                      version: item.artAt,
                      // Named so it travels: the same poster stands in the
                      // compare hero this tile opens.
                      name: posterName(item.path),
                    }}
                    title={item.title}
                    year={item.year}
                    hit={item.hit}
                    gain={item.hit.delta}
                    scoreTitle={`Predicted ${item.hit.score}, from ${item.currentScore} now`}
                    scoreLabel={`Predicted score ${item.hit.score}, up from ${item.currentScore}`}
                    magnetPoster={item.posterRemote}
                    index={offset + index}
                    // The tile opens the release rather than the comparison.
                    // A row could show what the sweep found and still leave its
                    // click for the compare page; a tile shows three facts, so
                    // the click has to be the way to the rest of them. The
                    // comparison is one press further in, from the dialog.
                    onOpen={() => setReading(item)}
                  />
                ))}
              </div>
            ) : (
              <ul className="ruled flex flex-col">
                {bucket.map((item, index) => (
                  <Row
                    key={item.path}
                    item={item}
                    index={offset + index}
                    onMore={() => setFinding(item)}
                  />
                ))}
              </ul>
            )
          }
        </Grouped>
      ) : sweeping ? (
        <EmptyState icon={SWEEP_ICON} title="Sweeping the library">
          {sweep.done} of {sweep.total} films checked — anything found lands
          here as it turns up.
        </EmptyState>
      ) : checked === 0 ? (
        <EmptyState icon={SWEEP_ICON} title="Nothing swept yet">
          {jackettReady
            ? `A sweep searches every film short of its best — ${candidates.toLocaleString(
                "en-GB",
              )} right now — and queues whatever beats your copy. One runs after every scan, so opening the app fills this page.`
            : "Connect Jackett on the Settings page, and the sweep that runs after every scan will fill this page."}
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
          Every film short of its best was checked against the indexers. The
          next sweep runs when you next open the app, and asks again about
          anything last checked over a day ago — by which time the trackers will
          have had time to change.
        </EmptyState>
      )}

      {/* What the sweep found, read whole. Only the grid opens it — a row
          already prints everything in here down its own length. */}
      {read && (
        <ReleaseDetails
          open={reading !== null}
          title={read.title}
          year={read.year}
          poster={read.poster}
          posterRemote={read.posterRemote}
          posterVersion={read.artAt}
          hit={read.hit}
          gain={read.hit.delta}
          currentScore={read.currentScore}
          checkedLabel={`Checked ${ago(read.checkedAt)}`}
          onward={{
            label: "Compare copies",
            go: () => {
              // The crumb an upgrade's row leaves, for the same reason: the
              // listener in return-to.tsx only sees anchors.
              rememberListing();
              router.push(`/compare/${compareId(read.compareKey)}`);
            },
          }}
          onMore={() => {
            setReading(null);
            setFinding(read);
          }}
          onClose={() => setReading(null)}
        />
      )}

      {/* One dialog for the tab: the row shows the sweep's single best find,
          and this is the way to the rest of the field. */}
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

/**
 * Films you do not have, that something has turned up for.
 *
 * The other half of the same sweep, and until now the third band of the
 * upgrades list — which put two unlike decisions in one ranking. Replacing a
 * copy is an improvement to a film you already chose; fetching a want is
 * choosing it. They are ranked by different things, they are grouped by
 * different things, and the counts that matter about them are different
 * counts — which is a tab, not a section.
 *
 * Everything a row cannot claim is missing rather than zeroed: no gain, no
 * compare page, no copy on the drive to score against. What is left is the part
 * that reads the same either way — what it is, how good it looks, and the two
 * buttons that get it.
 */
export function DownloadsView({
  finds,
  wants,
  checked,
  jackettReady,
  sort,
  group,
  layout,
}: {
  /** What the last scan's wishlist pass turned up, best first. */
  finds: WishlistFind[];
  /** Wanted films the sweep would search for — everything not already owned. */
  wants: number;
  /** How many wants have been looked up at all. */
  checked: number;
  jackettReady: boolean;
  /** A key from DOWNLOAD_SORTS; anything else falls back to best release. */
  sort?: string;
  /** A key from RELEASE_GROUPS; flat unless asked otherwise. */
  group?: string;
  /** Posters or rows — the fourth thing the listing bar asks. */
  layout: Layout;
}) {
  const { jobs } = useJobs();
  const router = useRouter();
  const sweep = jobs.sweep;
  const sweeping = sweep.status === "running";
  const [finding, setFinding] = useState<WishlistFind | null>(null);
  const shown = useLingering(finding);
  /** And the one release this find is, read whole — see `UpgradesView`. */
  const [reading, setReading] = useState<WishlistFind | null>(null);
  const read = useLingering(reading);

  const order = pickSort(DOWNLOAD_SORTS, sort);
  const grouping = pickGroup(RELEASE_GROUPS, group);
  const rows = [...finds].sort(order.compare);

  return (
    <div className="flex flex-1 flex-col gap-6">
      {rows.length > 0 ? (
        <Grouped items={rows} group={grouping} note={filmsNote}>
          {(bucket, offset) =>
            layout === "grid" ? (
              <div className={TILE_GRID_RULED}>
                {bucket.map((find, index) => (
                  <ReleaseTile
                    key={find.tmdbId}
                    // Remote only: a film you do not have has no poster on the
                    // drive. Named the way the wishlist names it, so the tile
                    // travels into the page it opens.
                    poster={{
                      remote: find.posterPath,
                      name: posterName(`tmdb-movie-${find.tmdbId}`),
                    }}
                    title={find.title}
                    year={find.year}
                    hit={find.hit}
                    // No gain on a want. Nothing is being improved on — the
                    // number in the dial is simply how good the release is,
                    // which is the whole question when the alternative is not
                    // having the film at all.
                    scoreTitle={`Predicted ${find.hit.score} — you do not have this film`}
                    scoreLabel={`Predicted score ${find.hit.score}, not in the library`}
                    magnetPoster={find.posterPath}
                    index={offset + index}
                    onOpen={() => setReading(find)}
                  />
                ))}
              </div>
            ) : (
              <ul className="ruled flex flex-col">
                {bucket.map((find, index) => (
                  <WishRow
                    key={find.tmdbId}
                    find={find}
                    index={offset + index}
                    onMore={() => setFinding(find)}
                  />
                ))}
              </ul>
            )
          }
        </Grouped>
      ) : sweeping ? (
        // The two halves of a sweep run in order, and this tab is the second
        // of them: while the films you own are being checked there is no
        // wishlist progress to report yet, and reporting the other half's
        // numbers here would be this tab counting somebody else's work.
        <EmptyState icon={SWEEP_ICON} title="Sweeping the wishlist">
          {sweep.phase === "wishlist"
            ? `${sweep.wishDone} of ${sweep.wishTotal} wants checked — anything found lands here as it turns up.`
            : "The films you own are being checked first; your wishlist follows in the same pass."}
        </EmptyState>
      ) : wants === 0 ? (
        <EmptyState
          icon={
            <>
              <path d="M12 21s-7.5-4.7-7.5-10A4.5 4.5 0 0 1 12 8a4.5 4.5 0 0 1 7.5 3c0 5.3-7.5 10-7.5 10Z" />
            </>
          }
          title="Nothing on the wishlist"
        >
          {/* Said the way the wishlist page says it, because it is the same
              instruction: there is no page to send you to — wanting a film
              happens wherever you found it. */}
          Search from anywhere — the button in the corner — and heart the films
          you are hunting for. Every sweep then asks the indexers about the ones
          you do not own, and what it finds lands here.
        </EmptyState>
      ) : checked === 0 ? (
        <EmptyState icon={SWEEP_ICON} title="Nothing searched yet">
          {jackettReady
            ? `${wants.toLocaleString("en-GB")} wanted film${
                wants === 1 ? "" : "s"
              } on the list, none of them asked about yet. The sweep that runs after every scan searches them, so opening the app fills this page.`
            : "Connect Jackett on the Settings page, and the sweep that runs after every scan will search for everything on your wishlist."}
        </EmptyState>
      ) : (
        <EmptyState
          icon={
            <>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </>
          }
          title="Nothing found to fetch"
        >
          Every want was searched and nothing came back worth having. The next
          sweep asks again about anything last checked over a day ago, so a
          release that turns up tonight is here tomorrow.
        </EmptyState>
      )}

      {/* No gain and no comparison: nothing is being improved on, so the way
          onward is the film itself, on TMDb's side of the app. */}
      {read && (
        <ReleaseDetails
          open={reading !== null}
          title={read.title}
          year={read.year}
          posterRemote={read.posterPath}
          hit={read.hit}
          checkedLabel={`Found ${ago(read.checkedAt)}`}
          onward={{
            label: "About this film",
            go: () => {
              rememberListing();
              // Wishlist finds are films; the sweep only searches those.
              router.push(`/discover/movie/${read.tmdbId}`);
            },
          }}
          onMore={() => {
            setReading(null);
            setFinding(read);
          }}
          onClose={() => setReading(null)}
        />
      )}

      {/* Searched by TMDb id rather than by path — the wishlist's own way in,
          since there is no file to search from. */}
      {shown && (
        <ReleaseSearchModal
          open={finding !== null}
          subject={{ kind: "tmdb", tmdbId: shown.tmdbId }}
          title={shown.title}
          subtitle={shown.year ? String(shown.year) : undefined}
          posterPath={shown.posterPath}
          configured={jackettReady}
          onClose={() => setFinding(null)}
        />
      )}
    </div>
  );
}
