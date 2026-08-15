"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Art } from "@/app/art";
import { EmptyState } from "@/app/empty-state";
import { ago } from "@/app/format";
import { useJobs } from "@/app/jobs-provider";
import type { Layout } from "@/app/listing";
import { MagnetAction } from "@/app/magnet-action";
import { useLingering } from "@/app/modal";
import { PosterTile, TILE_GRID_RULED } from "@/app/poster-tile";
import { ReleaseSearchModal } from "@/app/release-search";
import { rememberListing } from "@/app/return-to";
import { queueTheme, ScoreBadge, ScoreDial } from "@/app/score-circle";
import { stagger } from "@/app/stagger";
import { TILE_MARK } from "@/app/tile-button";
import { ReleaseDetails, ReleaseMark } from "@/app/release-details";
import type { StoredHit } from "@/lib/upgrade-sweep";
import { posterName } from "@/lib/routes";
import type { WishlistFind } from "@/lib/wishlist-search";
import { Grouped, pickGroup, type GroupOption } from "@/app/grouping";
import { byTitle, pickSort, type SortOption } from "@/app/sorts";

/**
 * What the sweep found for the films you want.
 *
 * One pass over the indexers answers two questions — is there a better copy of a
 * film I have, and has anything turned up for a film I want — and this file used
 * to draw both, because both are a release with a score and two buttons. They
 * shared a list, tagged by kind, which made the sort menu offer a gain to rows
 * that cannot have one. Then two tabs. Then two pages.
 *
 * Now one: the answers about films you already own are drawn on the library
 * shelf, on the film itself, under "Upgrades found" — which is where you were
 * always going to end up, since a better copy of something you have is a fact
 * about that thing and not a list of its own. See app/library-view.tsx.
 *
 * What is left here is the half that has nowhere else to be. A want is not on
 * any shelf — that is what makes it a want — so the release found for it is
 * drawn beside the wanting, on the wishlist page.
 *
 * This list never touches an indexer. The searching already happened — a sweep
 * runs at the end of every scan and a scan runs whenever the app is opened, so
 * the list fills itself and empties itself: fetch a film, rescan, and its row
 * falls out because the question it stood for is answered. It carries no control
 * of the sweep's own — Scan starts another pass, and how the pass is getting on
 * is the rail's to say.
 */

const gigabytes = (bytes?: number) =>
  bytes === undefined ? undefined : `${(bytes / 1024 ** 3).toFixed(1)} GB`;

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
 * As little of a find as a comparator or a bucket needs.
 *
 * There was a tagged union here — an upgrade or a want, in one list, because
 * both were drawn in one tab and every sort had to cope with either. Then a
 * shared shape, because they were two lists in one file. With one list left it
 * is only a narrowing: a cut asked for less than it is given is safe by
 * construction, and `RELEASE_GROUPS` reads nothing but the release.
 */
type Found = { title: string; checkedAt: number; hit: StoredHit };

/**
 * How the finds are ranked.
 *
 * The release's own score leads, because there is no copy to gain against: a
 * want you do not have is not being improved on, and how good the release is
 * *is* the question when the alternative is not having the film.
 *
 * These were shared with the upgrade queue and written generically for it —
 * one list of comparators that read nothing but the release, typed by whichever
 * of the two asked. The upgrades are drawn on the library shelf now and ranked
 * by the shelf's own sorts, so what is left is this list, for this list.
 */
export const DOWNLOAD_SORTS: SortOption<WishlistFind>[] = [
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
    label: "Recently found",
    compare: (a, b) => b.checkedAt - a.checkedAt,
  },
  {
    key: "title",
    label: "Title",
    compare: (a, b) => byTitle(a.title, b.title),
  },
];

/** The release-search modal's own chip, so a fact reads the same here. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap opacity-70 ring-1 ring-line-strong ring-inset">
      {children}
    </span>
  );
}

/**
 * The cuts the list can be made along — the ones that read the release and
 * nothing else.
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
 * Typed on the shared shape rather than per list: a cut that reads only the
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

/** How many films a section holds — the part both lists can say. */
const filmsNote = (rows: unknown[]) =>
  `${rows.length} film${rows.length === 1 ? "" : "s"}`;

/**
 * The same release as a poster.
 *
 * Two lists drew this, because the difference between an upgrade and a want is
 * two facts and not a layout: an upgrade has a copy on the drive to be better
 * than, so it can report a gain, and a want has neither. What is gone with the
 * upgrades is the gain and the tab that reported it; everything else about a
 * release read the same either way and reads the same still.
 *
 * A tile says three things and stops: which film this is, what the release
 * claims to be, and how good it would be. Everything a row printed down its
 * length — the release's own name, its size, who is seeding it, which indexer
 * answered — is in the dialog behind the mark; see app/release-details.tsx. The
 * name went first and most gladly: sixty characters of group tags, cut at the
 * front, is a grey smear under the title saying nothing you can act on.
 *
 * The poster goes to the film, like every other poster in this app. It opened
 * the release dialog for a while and the mark on it sent the magnet, which had
 * the two presses the wrong way round: the picture of a film you do not own is
 * a question about the film, and the arrow over it was the one gesture on the
 * page you could not take back. Now the poster answers "what is this" and the
 * arrow answers "and how do I get it" — with the dialog in between, where the
 * fetch actually happens.
 *
 * One mark over the artwork, and it stays one whether or not there is a magnet:
 * an indexer that publishes none still has a page of its own and a field of
 * other releases behind it, and both are in the dialog. Three marks in the
 * corner of a picture was a toolbar over a poster.
 */
function ReleaseTile({
  poster,
  title,
  hit,
  scoreTitle,
  scoreLabel,
  index,
  href,
  onOpen,
}: {
  poster: { src?: string; remote?: string; version?: number; name: string };
  title: string;
  hit: StoredHit;
  scoreTitle: string;
  scoreLabel: string;
  index: number;
  /** Where the poster goes — the film's own page. */
  href: string;
  /** And what the mark opens: everything this tile does not say. */
  onOpen: () => void;
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
      /*
       * No year. The library's tile leads its line with one because the shelf
       * is a shelf of films and the year is how you tell two cuts of the same
       * one apart; this is a shelf of *releases*, where the film has already
       * been chosen and the line has one job — saying what you would be
       * fetching. A year in front of that is the only fact on it you cannot
       * act on.
       */
      // The library card's own line, in the library card's own words: the facts
      // that separate one copy of a film from another, set as plain muted text.
      // They were chips, which is right in the release dialog where they stand
      // among prose and wrong in a grid — a shelf of posters with three outlined
      // boxes under every one reads as a form.
      facts={[hit.resolution, hit.hdr, hit.releaseType]}
      badge={
        /* The library's badge, which is now the app's — a ring on a white disc
           pinned to the corner was the queue reporting the same hundred-point
           scale in a drawing no other shelf used. See `ScoreBadge`.

           A gain used to lead it, on the upgrades this tile also drew: the
           release's score and what it would add to the copy you have, read as
           one thought. A want has no copy to add to, so the corner holds the
           one number — and the pairing survives where it was always true, on
           the library shelf's own card. See app/library-view.tsx.

           The colour is still the queue's own: green is kept for a release that
           closes the question rather than for a high number, which is what
           `queueTheme` is for and the one thing here that should not match the
           library. */
        <ScoreBadge
          score={hit.score}
          theme={queueTheme(hit.score)}
          title={scoreTitle}
          srLabel={scoreLabel}
        />
      }
      actions={<ReleaseMark title={title} onOpen={onOpen} />}
      href={href}
      label={title}
      index={index}
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
            source="wishlist"
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
 * There was a failed-sweep notice here, over both lists: the last error the
 * sweep stopped on, with a Try again beside it.
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
 * Films you do not have, that something has turned up for.
 *
 * The other half of the same sweep, and once the third band of the upgrades
 * list — which put two unlike decisions in one ranking. Replacing a copy is an
 * improvement to a film you already chose; fetching a want is choosing it. They
 * are ranked by different things, they are grouped by different things, and the
 * counts that matter about them are different counts.
 *
 * That made it a tab of its own for a while, beside the upgrades. It is drawn on
 * the wishlist page now, under the wants it is the answer to: what the sweep
 * found for a film you asked for belongs beneath the asking, not on a page about
 * the copies you already hold.
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
  groups = RELEASE_GROUPS,
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
  /** A key from `groups`; flat unless asked otherwise. */
  group?: string;
  /**
   * The cuts on offer, where they are not the queue's own.
   *
   * The wishlist page hands its own list in: two of its cuts read the wishlist
   * entry a find belongs to rather than the release — the set a film is part
   * of, the year it came out — which is a join this component has no side of.
   * The first option is whatever that page calls flat, and the rest are mostly
   * `RELEASE_GROUPS` again. See wishGroups in app/wishlist/wishlist-view.tsx.
   */
  groups?: GroupOption<WishlistFind>[];
  /** Posters or rows — the fourth thing the listing bar asks. */
  layout: Layout;
}) {
  const { jobs } = useJobs();
  const sweep = jobs.sweep;
  const sweeping = sweep.status === "running";
  const [finding, setFinding] = useState<WishlistFind | null>(null);
  const shown = useLingering(finding);
  /** And the one release this find is, read whole — see `UpgradesView`. */
  const [reading, setReading] = useState<WishlistFind | null>(null);
  const read = useLingering(reading);

  const order = pickSort(DOWNLOAD_SORTS, sort);
  const grouping = pickGroup(groups, group);
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
                    hit={find.hit}
                    // No gain on a want. Nothing is being improved on — the
                    // number in the dial is simply how good the release is,
                    // which is the whole question when the alternative is not
                    // having the film at all.
                    scoreTitle={`Predicted ${find.hit.score} — you do not have this film`}
                    scoreLabel={`Predicted score ${find.hit.score}, not in the library`}
                    // Wishlist finds are films; the sweep only searches those.
                    href={`/discover/movie/${find.tmdbId}`}
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
        // The two halves of a sweep run in order, and this list is the second
        // of them: while the films you own are being checked there is no
        // wishlist progress to report yet, and reporting the other half's
        // numbers here would be this page counting somebody else's work.
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
          source="wishlist"
          // Wishlist finds are films; the sweep only searches those. No
          // `onward` beside it: a want has no copy on the drive to compare
          // this release against, so the film's page is the only way onward
          // and it is the link above.
          film={{ href: `/discover/movie/${read.tmdbId}` }}
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
          source="wishlist"
          configured={jackettReady}
          onClose={() => setFinding(null)}
        />
      )}
    </div>
  );
}
