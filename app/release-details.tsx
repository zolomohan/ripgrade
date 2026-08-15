"use client";

import Link from "next/link";

import { Art } from "@/app/art";
import { BUTTON, Fact } from "@/app/controls";
import { DownArrow, MagnetAction } from "@/app/magnet-action";
import { CloseButton, Modal } from "@/app/modal";
import { queueTheme, ScoreDial } from "@/app/score-circle";
import { TILE_MARK } from "@/app/tile-button";
import type { DownloadSource } from "@/lib/qbittorrent";
import type { StoredHit } from "@/lib/upgrade-sweep";

/**
 * Everything the sweep knows about one release, for when the poster is not
 * enough.
 *
 * The queue's tiles carry one mark and one line: the magnet, and the three words
 * that say what the release claims to be. That is the whole of what a grid is
 * good at — recognising the film, and seeing at a glance whether this one is
 * 2160p Dolby Vision or a 1080p encode. Everything else a row used to print
 * down its length — the release's own name, its size, who is seeding it, which
 * indexer answered, when it was last asked about, what the score is made of —
 * came here rather than being squeezed onto a picture.
 *
 * That is also why the name is not on the tile any more. A release name is
 * sixty characters of group tags and it is the one string on the row that
 * genuinely needs a line to itself; on a tile it was a grey smear under the
 * title, cut at the front, telling you nothing you could act on. Here it wraps,
 * whole, at the top of the facts it summarises.
 *
 * Both tabs open this, because a release is a release whether or not you own the
 * film. The two facts that differ arrive as props: an upgrade has a copy on the
 * drive to be better than, so it has a gain and a comparison to open; a want has
 * neither, and its way onward is the film's own page.
 */

/**
 * The one mark a tile wears to reach all of this.
 *
 * A download arrow that does not download — it opens the dialog, and the dialog
 * fetches. That reads as a contradiction written down and as one gesture on
 * screen: you press the arrow on the poster, you are shown what you would be
 * fetching, and you press the arrow again. What it replaced was the arrow
 * sending the magnet on the first press, which meant the one irreversible
 * button on a shelf of forty posters was also the easiest one to hit by
 * accident.
 *
 * It also replaced a second mark. The tiles carried a magnifier beside the
 * arrow that opened exactly this dialog, which put two marks in the corner of
 * every picture for one destination — and made you choose between them before
 * knowing what either did.
 *
 * The poster keeps its own click: on the library shelf that is the film, and on
 * the wishlist it is the film's page on TMDb's side. This mark stops the click
 * on its way there, since it sits inside the frame the link covers.
 */
export function ReleaseMark({
  title,
  onOpen,
}: {
  /** Whose release this is, for the label. */
  title: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`The release found for ${title}`}
      title="What the sweep found — and the button that fetches it"
      className={TILE_MARK}
    >
      <DownArrow className="h-5 w-5" strokeWidth="2.2" />
    </button>
  );
}

/** The release-search modal's own chip, so a fact reads the same here. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap opacity-70 ring-1 ring-line-strong ring-inset">
      {children}
    </span>
  );
}

export function ReleaseDetails({
  open,
  title,
  year,
  poster,
  posterRemote,
  posterVersion,
  hit,
  gain,
  currentScore,
  checkedLabel,
  source,
  film,
  onward,
  onMore,
  onClose,
}: {
  open: boolean;
  title: string;
  year?: number;
  poster?: string;
  posterRemote?: string;
  posterVersion?: number;
  hit: StoredHit;
  /** What replacing your copy would add, where there is a copy to replace. */
  gain?: number;
  /** And what it scores today, which is what the gain is measured from. */
  currentScore?: number;
  /** "Checked 3 h ago" on an upgrade, "Found 3 h ago" on a want. */
  checkedLabel: string;
  /** Which list opened this, and so which one a fetch from it reports under. */
  source: DownloadSource;
  /**
   * The film's own page — where the poster and the name both go.
   *
   * An anchor rather than a handler, so the browser can middle-click and
   * preview it, and so the crumb that brings the poster home is left by the
   * delegated listener in app/return-to.tsx, which only sees anchors.
   */
  film: { href: string };
  /**
   * The comparison between this release and the copy on your drive, where there
   * is a copy — it shares the row with the button that fetches, at the lighter
   * weight, because it is how you check what that button claims.
   *
   * Absent on a want, which has nothing to compare against: its film's page is
   * the link above, and the download stands alone.
   */
  onward?: { label: string; go: () => void };
  /** The rest of the field, which is a dialog of its own. */
  onMore: () => void;
  onClose: () => void;
}) {
  const gigabytes =
    hit.sizeBytes === undefined
      ? undefined
      : `${(hit.sizeBytes / 1024 ** 3).toFixed(1)} GB`;

  const pills = [hit.resolution, hit.hdr, hit.releaseType].filter(
    Boolean,
  ) as string[];

  return (
    <Modal
      open={open}
      onClose={onClose}
      label={`${title} — release details`}
      panelClassName="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto glass-panel rounded-card border border-line p-6 shadow-2xl"
    >
      <>
        {/* The dialog is named for the work, not for the film — the rule the
            conversion dialog settled; see app/jobs/dovi-details.tsx.

            A film's name at the top made this look like the film's own page in
            a window, and the film is not what you opened it to decide. Every
            one of these is the same question asked about a different release,
            so the heading says which question, once, and the film it is about
            sits below with its poster. */}
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="min-w-0 truncate text-base font-semibold">
            Download this release
          </h2>
          <CloseButton onClick={onClose} />
        </header>

        <div aria-hidden className="rule-head mb-1" />

        {/* Which film, and what pressing the button would get you — one block,
            because they are one thought. The artwork is small: you opened this
            off a poster you are already looking at, so it says which film this
            is rather than asking to be looked at again.

            The poster and the name are the way to the film. There was a button
            for it in the row below, and a button is what you give something
            with no handle of its own — a picture of the film and its name are
            the handle, and they were sitting inert an inch above one that said
            "About this film". */}
        <div className="flex items-center gap-4">
          <Link
            href={film.href}
            aria-hidden
            tabIndex={-1}
            className="glow h-24 w-16 shrink-0 overflow-hidden rounded-control bg-surface-strong ring-1 ring-line"
          >
            <Art
              src={poster}
              remote={posterRemote}
              version={posterVersion}
              size="w92"
              className="h-full w-full object-cover"
            />
          </Link>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Link
              href={film.href}
              className="min-w-0 text-sm font-semibold break-words hover:underline"
            >
              {title}
            </Link>

            {/* Under the name rather than beside it, which is where every shelf
                in the app puts a year: set against a title that wraps to two
                lines it ends up floating in the middle of the block. */}
            {year && <p className="text-xs opacity-45">{year}</p>}

            {/* What the release would gain you, and the way to check it — one
                line, because they are one thought. "+11 over your copy" is a
                claim about two files, and the comparison is where both are set
                out side by side; the words sit against the figure they are
                about rather than in the row of buttons at the foot, where they
                read as a third thing you might do instead of downloading.

                A text link, not a pill: it is an aside on a fact, and a
                bordered button here would weigh as much as the one that
                fetches. */}
            {((gain !== undefined && gain > 0) || onward) && (
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                {gain !== undefined && gain > 0 && (
                  <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    +{gain} over your copy
                  </p>
                )}

                {onward && (
                  <button
                    type="button"
                    onClick={onward.go}
                    className={BUTTON.text}
                  >
                    {onward.label}
                  </button>
                )}
              </div>
            )}

            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {pills.map((pill) => (
                <Chip key={pill}>{pill}</Chip>
              ))}
            </div>
          </div>

          {/* The reading, in its own corner. No caption under it: "Predicted
              score" was a label on the one thing in the dialog that cannot be
              anything else, and the gain beside it already says what it is
              measured against. */}
          <ScoreDial
            score={hit.score}
            theme={queueTheme(hit.score)}
            size={56}
            title={
              currentScore === undefined
                ? `Predicted ${hit.score} — you do not have this film`
                : `Predicted ${hit.score}, from ${currentScore} now`
            }
            srLabel={
              currentScore === undefined
                ? `Predicted score ${hit.score}, not in the library`
                : `Predicted score ${hit.score}, up from ${currentScore}`
            }
          />
        </div>

        {/* The name, and then everything the sweep stored about it, as the one
            ruled block this app sets a table of facts in. The name is a row
            like the rest rather than a heading of its own: it is what the other
            rows are facts *about*, and a sixty-character string set large is a
            title the film does not have. */}
        <dl className="overflow-hidden rounded-control border border-line">
          <Fact label="Release" value={hit.title} mono />
          <Fact label="Size" value={gigabytes} />
          <Fact
            label="Seeders"
            value={hit.seeders === undefined ? undefined : String(hit.seeders)}
          />
          <Fact label="Indexer" value={hit.indexer} />
          <Fact label="Audio" value={hit.audio} />
          {/* What the predicted score is made of, where the row was stored with
              it. Older rows predate these and simply have no line — the compare
              page makes the same allowance. */}
          <Fact
            label="Video score"
            value={hit.scores ? String(hit.scores.video) : undefined}
          />
          <Fact
            label="Audio score"
            value={hit.scores ? String(hit.scores.audio) : undefined}
          />
          <Fact
            label="Release score"
            value={hit.scores ? String(hit.scores.release) : undefined}
          />
          <Fact
            label="Your copy"
            value={
              currentScore === undefined ? undefined : String(currentScore)
            }
          />
          <Fact label="Last asked" value={checkedLabel} />
        </dl>

        {/* One row, and one decision on it.
 
            Take this release, or go and look at the others — which is the only
            question the dialog cannot answer itself: what it shows is the best
            the sweep found, and the button beside it is the doubt about that
            word. It says "Other releases" rather than "Search", because that is
            what pressing it gets you: the whole field for this film, asked for
            again, this one included. "Search" named the machinery and left you
            to guess what would be searched for — which on a page that also has
            a Scan at its head read as a second way of starting a sweep.
            Weighted the way the answers are: the fetch takes whatever width is
            left over and the doubt takes its own words.

            Nothing else is here. Going to the film is a press on the film
            itself, above; comparing this release with the copy you have is a
            press on the line that makes the claim, also above. Both were
            buttons in this row once, which made a row of four things read as
            four things you might do — when three of them were ways of not
            deciding yet. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onMore}
            title="Every release for this film, not just the best one"
            className={BUTTON.secondary}
          >
            Other releases
          </button>

          {hit.magnet ? (
            /* The compare page's filled button rather than the circle a tile
                 wears: in a dialog this is the thing being asked about, not one
                 mark among several over a picture. `w-full` against a sibling
                 that refuses to shrink, so it simply takes whatever is left. */
            <MagnetAction
              magnet={hit.magnet}
              film={{ title, posterPath: posterRemote }}
              source={source}
              pill
              full
            />
          ) : hit.detailsUrl ? (
            /* No magnet, so the indexer's own page *is* the way to fetch it —
                 which makes it the primary press rather than a sentence saying
                 where to go and leaving you to find it. It stood in the row
                 row as "On the indexer" while there was a Download for it to be
                 a second choice to; with nothing else to do here it takes the
                 slot that button would have had. */
            <a
              href={hit.detailsUrl}
              target="_blank"
              rel="noreferrer noopener"
              title={`No magnet — fetch it on ${hit.indexer ?? "the indexer"}`}
              /* `BUTTON.primary`'s recipe written out, less its `shrink-0`:
                   this is standing in for the Download, so it is filled like
                   one — and a button that refuses to shrink and is also asked
                   to fill the row adds up to the row plus the width of the
                   button beside it, which is exactly how far it hung off the
                   panel. Here it takes the slack and gives it back, and the
                   indexer's name — somebody else's string, of any length — is
                   cut rather than allowed to set the width. */
              className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-4 py-1.5 text-sm text-background transition-opacity hover:opacity-90"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                /* Full strength, like the arrow on the Download this stands in
                     for: the dimming it wore was for an icon on an outlined
                     button among several, and 60% of the inverted text on a
                     filled pill is just a faint mark. */
                className="h-4 w-4 shrink-0"
              >
                <path d="M14 5h5v5" />
                <path d="M19 5l-7.5 7.5" />
                <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
              </svg>
              <span className="truncate">
                No magnet — fetch it on {hit.indexer ?? "the indexer"}
              </span>
            </a>
          ) : (
            <p className="w-full rounded-control border border-line px-4 py-2.5 text-center text-xs opacity-45">
              This indexer publishes no magnet, and no page to fetch it from.
            </p>
          )}
        </div>
      </>
    </Modal>
  );
}
