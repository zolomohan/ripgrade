/**
 * Shared styling for the small icon buttons on the film page.
 *
 * They started life floating on the hero artwork, where a translucent plate was
 * enough to separate them from whatever was behind. Two of them now sit on the
 * page itself, where that plate is the page colour and so invisible — hence the
 * border, which is what gives them an edge on both surfaces.
 *
 * Hover is colour only: these sit tight against the panels around them, and
 * moving them would jostle a corner that is meant to stay put.
 *
 * Positioning is deliberately not included — the back button is anchored on its
 * own, the other two live in a flex group.
 */
export const HERO_BUTTON = [
  "grid h-8 w-8 place-items-center rounded-chip",
  "border border-line bg-background/70 text-sm backdrop-blur",
  "transition-colors duration-150",
  "hover:border-line-strong hover:bg-surface-strong",
  "disabled:opacity-40",
].join(" ");
