"use client";

import { Art } from "@/app/art";
import { BUTTON } from "@/app/controls";
import { MagnetAction } from "@/app/magnet-action";
import { CloseButton, Modal } from "@/app/modal";
import { queueTheme, ScoreDial } from "@/app/score-circle";
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

/** The release-search modal's own chip, so a fact reads the same here. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-chip px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap opacity-70 ring-1 ring-line-strong ring-inset">
      {children}
    </span>
  );
}

/** One labelled fact, in the ruled block `ProcessDetails` sets its facts in. */
function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  /** A release name: monospace, and wrapped rather than cut — see below. */
  mono?: boolean;
}) {
  if (!value) return null;

  return (
    <div className="card-band flex items-baseline justify-between gap-4 px-3 py-2">
      <dt className="shrink-0 text-xs opacity-50">{label}</dt>
      <dd
        className={`min-w-0 text-right text-xs ${
          mono ? "font-mono break-all" : "break-words tabular-nums"
        }`}
      >
        {value}
      </dd>
    </div>
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
  /** The page this release's film lives on, and what to call going there. */
  onward: { label: string; go: () => void };
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
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="min-w-0 truncate text-base font-semibold">
            {title}
            {year && (
              <span className="ml-2 text-sm font-normal opacity-40">
                {year}
              </span>
            )}
          </h2>
          <CloseButton onClick={onClose} />
        </header>

        <div aria-hidden className="rule-head mb-1" />

        {/* The picture, the verdict and what the verdict is worth, on one line.
            Small: this dialog is opened off a poster you are already looking at,
            so the artwork is here to say which film you opened rather than to be
            looked at again. */}
        <div className="flex items-center gap-4">
          <div className="h-24 w-16 shrink-0 overflow-hidden rounded-control bg-surface-strong ring-1 ring-line">
            <Art
              src={poster}
              remote={posterRemote}
              version={posterVersion}
              size="w92"
              className="h-full w-full object-cover"
            />
          </div>

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

          <div className="flex min-w-0 flex-col gap-1">
            {gain !== undefined && gain > 0 ? (
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                +{gain} over your copy
              </p>
            ) : (
              <p className="text-sm opacity-55">Predicted score</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {pills.map((pill) => (
                <Chip key={pill}>{pill}</Chip>
              ))}
            </div>
          </div>
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

        {/* What this dialog can do, in the order the questions are asked: is
            this the one — no, show me the rest — yes, fetch it. The film's own
            page is the quiet one on the left, because you arrived here from its
            poster and going to it is a way out rather than an answer. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onward.go} className={BUTTON.text}>
            {onward.label}
          </button>

          <button type="button" onClick={onMore} className={BUTTON.secondary}>
            Every release
          </button>

          {hit.detailsUrl && (
            <a
              href={hit.detailsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={BUTTON.secondary}
            >
              On the indexer
            </a>
          )}

          {hit.magnet ? (
            // The compare page's filled button rather than the circle a tile
            // wears: in a dialog this is the thing being asked about, not one
            // mark among several over a picture.
            <MagnetAction
              magnet={hit.magnet}
              film={{ title, posterPath: posterRemote }}
              pill
            />
          ) : (
            <p className="text-xs opacity-45">
              This indexer publishes no magnet — fetch it from its own page.
            </p>
          )}
        </div>
      </>
    </Modal>
  );
}
