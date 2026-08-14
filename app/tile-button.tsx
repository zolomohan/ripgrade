"use client";

/**
 * The marks a poster wears, and the one way of drawing them.
 *
 * A tile in this app can carry three things over the artwork: a score, a heart,
 * and a cross that takes the film out of whatever list it is in. The first
 * genuinely needs a plate — a two-digit number at eleven pixels cannot be read
 * off a photograph — and the other two do not, so they no longer have one: an
 * icon drawn white over its own shadow carries on artwork the way a subtitle
 * does, and a grid of posters with a black disc pinned to every corner is a
 * grid of buttons with pictures behind them.
 *
 * There were two crosses before this: the collections' and the wishlist's,
 * different in every measurement they had — 9 against 7, 5 against 3, plate
 * against none, one corner against the other. They are the same button doing
 * the same job, and this is it.
 */

/**
 * The shadow on its own, for the few marks that answer in a colour of their own.
 *
 * A download that has landed goes green and one that failed goes red, wherever
 * it is drawn — see `MagnetAction` — and a mark carrying both `text-white` and
 * `text-emerald-300` is a mark whose colour is decided by the order Tailwind
 * happens to emit them in. So the shadow is separable and the colour is always
 * stated once.
 */
export const OVER_ART_SHADOW = "drop-shadow-[0_1px_4px_rgba(0,0,0,0.65)]";

/**
 * White in both themes, unlike everything else here, because what it stands on
 * is a photograph rather than a surface this app painted. The shadow is what
 * carries it over a bright poster.
 */
export const OVER_ART = `text-white ${OVER_ART_SHADOW}`;

/** And in red, where a mark stops being an offer and becomes an answer. */
export const WANTED_ART =
  "text-red-500 drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]";

/**
 * The size and weight of one of those marks, wherever it is put.
 *
 * The box is larger than the disc it replaced even though nothing is painted on
 * it — with no plate to draw, a generous target costs nothing.
 *
 * Split from the positioned version below because a tile can carry a *row* of
 * these: the queue's posters offer the rest of the field, the indexer's page and
 * the magnet, which is three marks in one corner rather than one mark in three
 * corners. A flex row cannot be built out of absolutely positioned children.
 */
export const TILE_MARK = `grid h-9 w-9 place-items-center transition-opacity ${OVER_ART}`;

/**
 * Where a tile's own controls sit.
 *
 * `z-10` because these live inside the frame, above the glow overlay the frame
 * paints at `z-1`. Inside rather than pinned beside it, which matters: the frame
 * is the thing that lifts and turns under the pointer, and a control anchored
 * outside it hangs still while the picture it belongs to moves.
 */
export const TILE_BUTTON = `absolute z-10 ${TILE_MARK}`;

/**
 * Takes a film out of the list the tile is part of — a set of your own, or the
 * wishlist.
 *
 * Top left, always. Top right is spoken for on every other kind of tile in the
 * app — the score on one, the heart on the next — and a control that moves
 * corners depending on which shelf you are looking at is a control you have to
 * find twice.
 *
 * On hover only: a grid of posters should read as posters until you reach for
 * one. The red arrives with the pointer, which is the rule `BUTTON.danger`
 * keeps.
 *
 * A sibling of the tile's link rather than a child of it: a button nested
 * inside an anchor is invalid, and one click would fire both.
 */
export function RemoveButton({
  label,
  title,
  disabled,
  onClick,
}: {
  /** What is being taken out, for a screen reader. */
  label: string;
  /** And what it is being taken out of, for the pointer. */
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className={`${TILE_BUTTON} top-1 left-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-400 disabled:opacity-30`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden
        // Sized to the heart across the tile from it, which is the only other
        // thing that shares a poster's top edge.
        className="h-5 w-5"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
