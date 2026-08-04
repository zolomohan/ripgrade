"use client";

import { useEffect } from "react";

/**
 * The light that follows the pointer across a row.
 *
 * A row that only changes colour on hover tells you it is hoverable; a row lit
 * where your cursor is tells you where you are on it, which is what you want on
 * a line that runs the width of the page. The lighting is a pseudo-element in
 * globals.css — all this does is say where.
 *
 * One listener on the document rather than a handler per row: the lists here
 * run to hundreds of rows, and a React `onPointerMove` on each is hundreds of
 * subscriptions and a re-render risk for something that is, in the end, two
 * numbers on a style attribute.
 */

/** Two decimals is finer than any 3° rotation can show. */
const round = (n: number) => Math.round(n * 100) / 100;

export function Glow() {
  useEffect(() => {
    // Cursor-following light is a pointer affordance; a touch has no pointer to
    // follow, and firing this on every drag would light rows nobody hovered.
    const fine = window.matchMedia("(pointer: fine)");
    if (!fine.matches) return;

    let lit: HTMLElement | null = null;

    const move = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const row = target?.closest?.<HTMLElement>(".glow") ?? null;

      // Coordinates are the row's own, so the gradient can be positioned in the
      // element's box without knowing where on the page that box is.
      if (row) {
        const box = row.getBoundingClientRect();
        const x = event.clientX - box.left;
        const y = event.clientY - box.top;
        row.style.setProperty("--gx", `${x}px`);
        row.style.setProperty("--gy", `${y}px`);

        // The same position again, as −1…1 from the centre. A tile tilts by it,
        // and an angle cannot be made of pixels: the CSS would need the
        // element's own width to divide by, which is the one thing it has no
        // way to ask for.
        row.style.setProperty("--gnx", String(round((x / box.width - 0.5) * 2)));
        row.style.setProperty("--gny", String(round((y / box.height - 0.5) * 2)));
      }

      /*
       * The tilt is released on the way out — a tile you are no longer pointing
       * at should lie flat — but the light is left exactly where it was.
       *
       * Clearing its position too sent the gradient back to the element's
       * centre for the length of the fade, which read as the glow flashing in
       * the middle of a row you had just left. The stale coordinates cost
       * nothing: crossing back into a row is itself a pointermove, so they are
       * overwritten in the same event that turns the light back on.
       */
      if (lit && lit !== row) {
        lit.style.removeProperty("--gnx");
        lit.style.removeProperty("--gny");
      }
      lit = row;
    };

    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  return null;
}
