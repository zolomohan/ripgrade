/**
 * The backdrop at the head of a page, and the veil drawn down over it.
 *
 * Six pages open this way — a film, an episode, a show, a comparison, a TMDb
 * collection and one of your own — and the two lines that draw it were written
 * out identically in all six. That is one shape kept in six places, which is
 * the arrangement where a change lands in five of them.
 *
 * A plain module rather than one of the components: half the callers are server
 * components, and a value exported from a `"use client"` file reaches them as a
 * reference to something in the browser rather than as the string they need to
 * put in an attribute.
 */

/**
 * How much of the page a hero takes before the content starts.
 *
 * Two depths, which is a distinction the pages already made and worth keeping:
 * a film, an episode, a comparison and anything on TMDb's side open on the
 * deeper one, because the picture is most of what those pages are before you
 * have read a word of them. A show and a collection open on the shallower,
 * where the thing you came for is the list underneath.
 */
export const HERO_BOX = "relative h-96 w-full overflow-hidden sm:h-[32rem]";

/** The same, for the pages whose subject is the list under it. */
export const HERO_BOX_SHORT = "relative h-72 w-full overflow-hidden sm:h-96";

/**
 * Anchored to the top rather than the middle.
 *
 * `object-cover` centres by default, which is the right answer for a picture
 * shown whole and the wrong one for this: a backdrop is 16:9 and the band it is
 * cropped into is nearer 4:1, so most of the frame is thrown away either way —
 * and what a centred crop throws away is the sky, the skyline, the top of
 * whoever is standing there, while keeping the strip along the bottom that the
 * gradient then covers up and the title sits over. Held to the top, the part of
 * the picture that survives is the part that is still visible.
 */
export const HERO_ART =
  "enter-veil absolute inset-0 h-full w-full object-cover object-top";

/**
 * What turns the foot of it into page.
 *
 * Not a scrim over the whole picture — the top stays as bright as it was shot —
 * but a ramp up to the background colour, so the artwork ends by becoming the
 * page rather than stopping at an edge. The title and its controls sit in the
 * part that has already become page, which is why they are legible over
 * anything.
 */
export const HERO_VEIL =
  "absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20";
