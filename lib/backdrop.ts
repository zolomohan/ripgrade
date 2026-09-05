import "server-only";

import { getSetting } from "./db";

/**
 * How much of the window a page's artwork is allowed to take.
 *
 * Six pages open on a backdrop — a film, an episode, a show, a comparison, a
 * TMDb collection and one of your own — and until now every one of them drew it
 * the same way: a band across the top of the content column, beside the rail,
 * ending in a ramp up to the page colour. That is the conservative answer and
 * the right default. It is also not what the picture is for. A backdrop is a
 * frame of the film, and a frame of the film shown 36rem tall in a column that
 * starts 14rem from the left of the screen is a frame of the film in a slot.
 *
 * So there are two other answers here, and the difference between them is only
 * what happens when you scroll:
 *
 *   band       the strip at the head of the column, as it has always been
 *   fixed      the whole window, pinned — the page moves over the picture
 *   scrolling  the whole window, and it leaves with the page
 *
 * Both of the full ones run behind the rail rather than beside it, which is the
 * point of them: the rail is glass, and glass with a film behind it is the
 * material the Glass setting has been describing all along. Neither changes
 * what a page says, so this belongs under Themes with the scheme and the
 * layout — see lib/theme.ts, which is the same shape of question.
 */
export type Backdrop = "band" | "fixed" | "scrolling";

export const BACKDROP_KEY = "heroBackdrop";

/**
 * What goes on <html>, which is nothing at all for the band.
 *
 * The same trick `themeAttribute` plays next door, for the same reason: the
 * band is what every rule in globals.css already draws, so it is the absence of
 * the attribute rather than a third value for the CSS to have an opinion about.
 * Everything the two full modes change is written against `[data-backdrop]`.
 */
export const backdropAttribute = (
  backdrop: Backdrop,
): "fixed" | "scrolling" | undefined =>
  backdrop === "band" ? undefined : backdrop;

export const readBackdrop = (): Backdrop => {
  const stored = getSetting(BACKDROP_KEY);
  return stored === "fixed" || stored === "scrolling" ? stored : "band";
};
