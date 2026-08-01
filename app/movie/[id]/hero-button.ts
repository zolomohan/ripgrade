/**
 * Shared styling for the icon buttons floating over the hero image.
 *
 * They sit on top of arbitrary artwork, so hover has to do more than nudge the
 * background opacity: the plate goes fully opaque, gains a ring to separate it
 * from whatever is behind, lifts slightly, and presses back down on click.
 *
 * Positioning is deliberately not included — the back button is anchored on its
 * own, the other two live in a flex group.
 */
export const HERO_BUTTON = [
  "grid h-8 w-8 place-items-center rounded-chip",
  "bg-background/70 text-sm backdrop-blur",
  "ring-1 ring-transparent transition duration-150",
  "hover:bg-background hover:ring-line-strong hover:scale-110 hover:shadow-md",
  "active:scale-95",
  "disabled:opacity-40 disabled:hover:scale-100 disabled:hover:shadow-none",
].join(" ");
