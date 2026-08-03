import type { CSSProperties } from "react";

/**
 * Marks an element as the nth to arrive in its list.
 *
 * Pairs with `.row-enter` in globals.css, which reads `--i` as the item's place
 * in the queue. Kept as a helper rather than written inline at each list: a
 * custom property has to be cast past `CSSProperties` every time, and that cast
 * is not something worth repeating in the middle of a poster grid.
 */
export const stagger = (index: number) =>
  ({ "--i": index }) as CSSProperties;
