/**
 * The button shapes, in a file with no "use client" on it.
 *
 * They lived in app/controls.tsx, which is a client module — and a server
 * component that imports a plain value out of a client module does not get the
 * value. It gets the reference React hands the bundler, so `BUTTON.primary` is
 * `undefined`, `className={undefined}` is no class attribute at all, and the
 * button renders as bare words. No error and no warning: the dashboard and the
 * library both offered their way out of an empty page as unstyled text, and had
 * been doing it for as long as those links had been there.
 *
 * So the strings live here, where either side of the boundary can read them,
 * and `controls.tsx` re-exports them for the twenty-odd client components that
 * already import from it.
 */

/**
 * One shape for every button that commits to something, so a row of them
 * lines up.
 *
 * This began as the console's own, on the film page, where a verdict band and
 * an action band needed their buttons to agree. It is here now because the
 * queue's rows and the dashboard's inline actions want the same four weights,
 * and a second set written from memory would drift from this one at the first
 * change to either.
 *
 * The shape is the pill. It was `--radius-control` here, `--radius-chip` on
 * the settings pages, and a full round on the shelf's own controls — three
 * answers to one question, which is how the app came to look like three apps
 * depending on which page you were standing on. The shelf's answer won,
 * because it was already the shape of the search field, the segmented tabs,
 * the filter chips and every icon button: the app was mostly pills and the
 * buttons were the holdout.
 *
 * `inline-flex` and a gap on all three of the boxed weights, so a label can be
 * joined by a `Spinner` — or an icon — without the button having to be rebuilt
 * around it. `justify-center` matters for the ones that are given a width:
 * their contents change size as they work, and centred is the only alignment
 * that does not make the button look like it is drifting.
 */
export const BUTTON = {
  primary:
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-foreground px-4 py-1.5 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-40",
  secondary:
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-line px-4 py-1.5 text-sm transition-colors hover:bg-surface-strong disabled:opacity-40",
  // Its colour arrives on hover, when you are reaching for it: sitting in the
  // row it is one button among several, and the dialog behind it is where the
  // red belongs.
  danger:
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-line px-4 py-1.5 text-sm transition-colors hover:border-red-500/40 hover:bg-red-500/[0.08] hover:text-red-700 disabled:opacity-40 dark:hover:text-red-300",
  // `danger`'s hover state, worn standing.
  //
  // For the one place the rule above does not fit: a card whose whole subject
  // is a file that is still on the drive, offering to delete it. There the
  // destructive thing is not one option among several that happens to be
  // reachable — it is half of what the card is for, and the other half is the
  // button beside it. Neutral until you reach for it would be hiding what it
  // does, which is the argument `confirm` makes below; but a card is not a
  // dialog, so it stops at the outline and leaves the fill to the dialog that
  // this button is going to open anyway.
  //
  // Written out in full for the reason `confirm` gives: two `border-*` colours
  // in one class string are settled by Tailwind's emit order, not by which was
  // written last.
  dangerStanding:
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-red-500/40 px-4 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-500/[0.08] disabled:opacity-40 dark:text-red-300",
  // Words rather than a box: what it offers is an alternative to the button
  // beside it, and a second bordered button would read as a second decision of
  // equal weight. The app's own link treatment, underline arriving on hover.
  // No pill, because there is no box to round — but still a flex row, so a
  // spinner can sit beside the words like it does everywhere else.
  text: "inline-flex shrink-0 items-center gap-1.5 px-1 py-1.5 text-sm underline decoration-transparent underline-offset-4 opacity-60 transition hover:decoration-current hover:opacity-100 disabled:opacity-30",
  // The red a dialog wears, which is not the red a row wears. `danger` above
  // waits for hover because out on a page it is one option among several; by
  // the time a dialog is open, the destructive thing is the only thing being
  // asked about, and a button that looks neutral until you reach for it is
  // hiding what it does. Same pill, filled from the start.
  //
  // Written out rather than layered onto `secondary`, because two `border-*`
  // colours in one class string are settled by the order Tailwind emits them
  // in, not the order they are written — which is a coin toss dressed up as
  // an override.
  confirm:
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-red-500/40 bg-red-500/[0.10] px-4 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-500/20 disabled:opacity-40 dark:text-red-300",
  // The same button at the size of the small print. Copy, Try again, Browse,
  // Edit poster: things offered beside a line of `text-xs` and sized to it, so
  // that a button next to a caption does not out-shout the caption. This one
  // existed already — six times, in six files, written from memory each time
  // and no two agreeing on radius or padding. Once, here.
  small:
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs transition-colors hover:bg-surface-strong disabled:opacity-40",
};
