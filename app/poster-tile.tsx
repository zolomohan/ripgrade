"use client";

import Link from "next/link";
import { ViewTransition } from "react";

import { Art } from "@/app/art";
import { useEntrance } from "@/app/return-to";
import { stagger } from "@/app/stagger";

/**
 * A film as a poster. The app's one tile.
 *
 * The library, the wishlist, the shelves, the search results and every
 * collection have drawn this from the beginning, and every one of them drew it
 * itself: the same frame string — `glow glow-over tilt relative aspect-[2/3]
 * overflow-hidden rounded-card bg-surface-strong ring-1 ring-line` — copied out
 * by hand six times, with a caption underneath that agreed on the type sizes and
 * not on much else. It is the app's most-repeated twenty lines.
 *
 * So the jobs page and the queue did not get a seventh copy. This is that tile,
 * lifted out of the library shelf that had the best version of it, and taught
 * the four things a page of *work* needs it to say — which turn out to be
 * exactly four corners of a poster:
 *
 *   top left      whether this one is chosen
 *   top right     the reading this list is ranked by
 *   bottom left   what is happening to it, in a word
 *   bottom right  what can be done about it
 *
 * All four are slots, because the pages disagree about what goes in them and are
 * right to: the library's reading is a score on a plate, the queue's is a dial,
 * the audio tab's is a size in green. What they must agree on is where it sits
 * and what it is allowed to look like.
 *
 * And that is the rule: nothing but a *reading* wears a plate. It is
 * app/tile-button.tsx's, and the reason for it holds everywhere — a two-digit
 * number at eleven pixels cannot be read off a photograph, and an icon drawn
 * white over its own shadow can. A grid of posters with a black disc pinned to
 * every corner is a grid of buttons with pictures behind them.
 */

/**
 * The shelf these are laid out on.
 *
 * The library's own columns — five across on a wide screen, three on a tablet,
 * two on a phone. Named rather than written out at each list because a grid that
 * is five columns on one tab and four on the next is two shelves pretending to
 * be one.
 *
 * The library keeps its own spacing above it — `pt-13` on an ungrouped shelf,
 * the section gap on a grouped one — so this is the grid and nothing else.
 */
export const TILE_GRID = "grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5";

/**
 * The same shelf for the pages that stand one directly under a section heading.
 *
 * The jobs page and the queue part their sections with a name and a hairline and
 * then begin immediately: a list of rows opens with its own `py-4` and does not
 * notice, where a grid opens with the poster, and the first artwork ends up
 * sitting on the rule.
 */
export const TILE_GRID_RULED = `${TILE_GRID} pt-3`;

/**
 * The plate a *reading* wears over artwork — a size freed, a place in a queue, a
 * score.
 *
 * The one thing on these tiles that keeps a background, and `backdrop-blur` over
 * `background/85` is what the library's score badge and the wishlist's "In the
 * library" line already stand on, so a figure reads the same wherever it is laid
 * over a poster.
 */
export const TILE_READING =
  "rounded-chip bg-background/85 px-1.5 text-[11px] leading-[20px] font-medium tabular-nums backdrop-blur";

/** The same plate for a word rather than a figure — no tabular numbers. */
export const TILE_NOTE =
  "truncate rounded-chip bg-background/85 px-1.5 text-[10px] leading-[18px] font-medium backdrop-blur";

export function PosterTile({
  poster,
  transitionName,
  title,
  year,
  episode,
  fileName,
  facts,
  factsTitle,
  mark,
  remove,
  badge,
  note,
  actions,
  status,
  action,
  label,
  index,
  href,
  onOpen,
  selecting,
  chosen,
}: {
  /**
   * The artwork, where there is any. A tile with none keeps the empty frame
   * rather than collapsing: the cleanup list leans on that hardest — an original
   * whose film has since been renamed is a row with a file and no film at all,
   * and it still has to hold its place in the grid.
   */
  poster?: {
    src?: string;
    remote?: string;
    version?: number;
  };
  /**
   * Identity across the navigation this tile opens — `posterName(…)`.
   *
   * On the frame, not on the image inside it. The whole tile is the thing that
   * travels: its ring, the reading on it and the note with it, all of it moving
   * as one object into the page it opens. Named on the `Art` instead, the
   * picture flies off alone and leaves the badge and the ring standing where the
   * tile was — which is the shelf coming apart mid-flight.
   *
   * Only worth naming the tile a click is actually aimed at: every name costs
   * the browser a snapshot on every transition, and a name has to be unique
   * among everything mounted — two tiles of one film claiming it abort the
   * transition outright. The cleanup grid leaves it off for exactly that reason.
   */
  transitionName?: string;
  title: string;
  year?: number;
  /** "S01E02 · Its own title", where a tile is one. Its own line; it is long. */
  episode?: string;
  /** The file's own name, cut at the front — see `.cut-start` in globals.css. */
  fileName?: string;
  /**
   * What separates this film from the next one, as the muted line under the
   * name: `2017 · 2160p · REMUX`.
   *
   * A list of parts rather than a node, joined by the middle dot every caption
   * in this app is joined by, with the year always first. Passed this way
   * because the alternative is what these pages had — one list setting its facts
   * as chips, the next as loose spans, a third as a flex row with its own gaps —
   * and a shelf of posters with three outlined boxes under each of them reads as
   * a form rather than a shelf.
   *
   * Anything falsy is dropped, so a caller can write the list out and let the
   * absent facts fall away.
   */
  facts?: (string | number | false | null | undefined)[];
  /** What that line means, where a word in it is an abbreviation. */
  factsTitle?: string;
  /** Top left: whether this one is chosen. */
  mark?: React.ReactNode;
  /**
   * Top left as well: the cross that takes this one out of the list it is in.
   *
   * The same corner as `mark` and never at the same time — one is a tick that
   * only exists while a grid is being ticked, the other a control on a grid
   * that has no ticking. The corner is not shared out of thrift: it is where
   * this app has always put the mark that says what a tile is *in* rather than
   * what it is, and a cross that moved to the other corner on one shelf would
   * be a control you have to find twice. See `RemoveButton` in
   * app/tile-button.tsx, which is what belongs here.
   */
  remove?: React.ReactNode;
  /** Top right: the reading this list is ranked by. */
  badge?: React.ReactNode;
  /** Bottom left: what is happening to it, in a word. */
  note?: React.ReactNode;
  /**
   * Bottom right: what can be done about it, as marks over the artwork.
   *
   * Standing but dropped back, rather than hidden until the pointer finds them.
   * How visible a mark should be is a question about how central it is: taking a
   * film off a list is incidental to a shelf of posters, so the wishlist's cross
   * waits for a hover; fetching the release is the entire reason the queue's
   * tiles exist, and a grid of them showing nothing to press would appear to
   * offer nothing.
   */
  actions?: React.ReactNode;
  /**
   * A strip along the foot of the poster, for a tile something is happening to.
   *
   * It takes the whole width because a progress bar is the one thing here that
   * is a measurement of the tile rather than a mark on it — so it replaces the
   * note and the actions rather than sharing the line with them. Nothing is
   * offered on a film that is already being rewritten anyway.
   */
  status?: React.ReactNode;
  /** And what sits under the caption, where words will not fit on a poster. */
  action?: React.ReactNode;
  /** What this tile is, for a screen reader. */
  label: string;
  index: number;
  /**
   * Where the tile goes, for the tiles that simply go somewhere.
   *
   * An anchor wherever one will do, because an anchor is the thing a browser
   * knows how to middle-click, preview and open in a new tab — and because the
   * delegated listener in app/return-to.tsx only sees anchors, so a tile that
   * navigates from a handler has to leave its own crumb by hand.
   */
  href?: string;
  /**
   * What the poster does instead, for the tiles that do not merely navigate:
   * open a dialog, or take a tick in a run down the grid.
   *
   * The shift flag is passed through for the lists that offer that run. Absent
   * along with `href` on a tile that is only to be looked at — the queued films,
   * which have been decided already.
   */
  onOpen?: (range: boolean) => void;
  /** Whether the boxes are out, which is a mode the whole grid is in or not. */
  selecting?: boolean;
  chosen?: boolean;
}) {
  /**
   * Whether this tile plays its arrival.
   *
   * The library's rule, and it belongs to every shelf: coming *back* to a grid
   * from a film's page must not set forty posters animating in again, so the
   * class is decided once at mount from a flag the back navigation sets. Written
   * into the tile rather than left to each caller, which is how the jobs page and
   * the queue came to stampede on the way back.
   */
  const entrance = useEntrance();

  const art = poster && (
    <Art
      src={poster.src}
      remote={poster.remote}
      version={poster.version}
      loading="lazy"
      className="h-full w-full object-cover"
    />
  );

  /**
   * Whether the frame holds something clickable of its own.
   *
   * It decides the shape of the whole tile, because an anchor may not contain a
   * button: with nothing but badges on the poster the link is the tile — the
   * caption included, which is how the library shelf has always behaved — and
   * with a control on it the link shrinks to the picture and the control becomes
   * its sibling. The wishlist settled this trade; it is written down here so the
   * next tile does not have to settle it again.
   */
  const controls = Boolean(mark || remove || actions);

  const cover =
    href && controls ? (
      <Link href={href} aria-label={label} className="absolute inset-0" />
    ) : onOpen ? (
      /* A role rather than a link, for the tiles whose click is a dialog or a
         tick rather than an address. */
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => onOpen(e.shiftKey)}
        // While the boxes are out the tile is one of them, so it says so.
        aria-pressed={selecting ? Boolean(chosen) : undefined}
        // Shift-click is also how a browser extends a text selection, so without
        // this a run ticked across the grid drags a blue smear over it. Only
        // when shift is held, and only where a run means something — the same
        // refusal `Tick` makes for the same reason.
        onMouseDown={(e) => {
          if (selecting && e.shiftKey) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(e.shiftKey);
          }
        }}
        aria-label={label}
        className="absolute inset-0 cursor-pointer"
      />
    ) : null;

  const line = [year, ...(facts ?? [])].filter(Boolean).join(" · ");

  const frame = (
    <div className="glow glow-over tilt relative aspect-[2/3] overflow-hidden rounded-card bg-surface-strong ring-1 ring-line">
      {art}
      {cover}

      {/* Top left, always, which is where this app's tiles have always put the
            mark that says what the tile is *in* rather than what it is — see
            `RemoveButton`. Out of the way while nothing is being chosen, and
            inert with it, so the tab key does not stop on a control that is not
            there.

            `pointer-events-none` as well as `inert`, which is belt and braces
            and worth it: a box at zero opacity is still a box sitting over the
            corner of the picture, and if it took the click the tile would do
            nothing at all where you happened to press it. */}
      {mark && (
        <div
          inert={!selecting}
          className={`absolute top-1 left-1 z-10 transition-opacity duration-200 ${
            selecting ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {mark}
        </div>
      )}

      {/* Positioned by the button itself, which is what `RemoveButton` is: it
          carries the corner and the hover with it, so the same cross sits in
          the same place whether a tile is built out of this component or by
          hand — see the wishlist's, which is not. */}
      {remove}

      {badge && <div className="absolute top-2 right-2 z-10">{badge}</div>}

      {status ? (
        /* Ranged along the foot on a scrim of its own: a bar laid straight on
             a bright poster is a bar you cannot find the ends of. */
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1.5 bg-gradient-to-t from-black/75 via-black/45 to-transparent px-2.5 pt-8 pb-2.5">
          {status}
        </div>
      ) : (
        (note || actions) && (
          <div className="absolute inset-x-1 bottom-1 z-10 flex items-end justify-between gap-1">
            {/* `min-w-0` on the note and none on the actions: a long word
                  gives way to the buttons rather than pushing them off the
                  poster. */}
            <div className="min-w-0">{note}</div>
            {actions && (
              <div className="flex shrink-0 items-center opacity-75 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {actions}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );

  const body = (
    <>
      {/* The whole tile is what travels, so the name goes round the frame and
          everything on it — see `transitionName`. `share="morph"` puts the pair
          in a class the stylesheet can time; `default="none"` restricts it to
          that pairing, so a server action's refresh does not start a transition
          on a poster with no second page involved. */}
      {transitionName ? (
        <ViewTransition name={transitionName} share="morph" default="none">
          {frame}
        </ViewTransition>
      ) : (
        frame
      )}

      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="min-w-0 truncate text-sm font-medium" title={title}>
          {title}
        </p>

        {episode && (
          <p className="min-w-0 truncate text-[11px] opacity-45">{episode}</p>
        )}

        {line && (
          <p
            className="min-w-0 truncate text-[11px] opacity-45"
            title={factsTitle}
          >
            {line}
          </p>
        )}

        {/* Cut at the front, because what tells one of these apart from the next
            is at the end of it — see `.cut-start`, and the `<bdi>` it requires
            so the right-to-left context reaches the cut and not the text. */}
        {fileName && (
          <p
            className="cut-start min-w-0 truncate font-mono text-[11px] opacity-45"
            title={fileName}
          >
            <bdi>{fileName}</bdi>
          </p>
        )}
      </div>

      {action}
    </>
  );

  const shape = `${entrance} group flex flex-col gap-2`;

  // The whole tile as the link, where nothing on the poster contests the click.
  // The caption goes with it, which is the shelf's own behaviour: the title
  // under a poster is part of the poster as far as anybody clicking is
  // concerned.
  return href && !controls ? (
    <Link href={href} style={stagger(index)} className={shape}>
      {body}
    </Link>
  ) : (
    <div style={stagger(index)} className={shape}>
      {body}
    </div>
  );
}
