/**
 * The line at the foot of a shelf: how much is on it, and what it comes to.
 *
 * A total reads as a total under the thing it counts. Above the shelf it is
 * just another line between the controls and the films — which is where all
 * three of these used to sit before they were moved down, and moving them was
 * the only part anybody remembered to do three times.
 *
 * The band itself was written out by hand in the library, the shows shelf and
 * the wishlist: the same rule, the same top margin, the same eleven-point ink,
 * the same baseline alignment. Identical to the character, which is exactly the
 * kind of duplicate that stays identical right up until one of them gains a
 * decimal.
 *
 * Two slots and no opinion about what goes in them, because the three pages
 * genuinely count different things — films and their size, shows and their
 * episodes, wants and how many have since arrived. What they agree on is the
 * shape of the line, and that is the whole of what is shared here.
 *
 * No `"use client"`: it holds nothing and does nothing, so a server page can
 * draw it as readily as the three client shelves that do.
 */
export function ShelfTotal({
  left,
  right,
}: {
  left: React.ReactNode;
  /** The figure the count adds up to, where the page has one. */
  right?: React.ReactNode;
}) {
  return (
    <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-4 text-xs opacity-45">
      <p>{left}</p>
      {right && <p>{right}</p>}
    </div>
  );
}
