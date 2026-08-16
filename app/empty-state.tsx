import { stagger } from "./stagger";

/**
 * A page with nothing to show yet, saying so properly.
 *
 * These were bordered boxes holding one long grey sentence — a frame around
 * an apology. Unboxed, like every other part of a page here: a drawn mark so
 * the state reads before the words do, a heading that names the situation, a
 * sentence that says what changes it, and the action that does — in the empty
 * state itself, because "what do I do now" is the whole question an empty
 * page asks.
 *
 * ## Where it sits
 *
 * Two things have to be true at once, and the obvious layout gets neither.
 * Centring the bounding box means every line of prose and every button moves
 * the mark, because the box is centred by its own height — the eye tracks the
 * mark, so the same component reads as landing somewhere different on every
 * page. Pinning the mark instead, with `fr` spacers either side of it, holds it
 * still but hangs the words off it: a state with two lines and no button then
 * has nothing under it, and the whole thing rides high in its own block.
 *
 * So the words get a room of their own. The mark and a text box of *fixed
 * height* travel as one unit, centred as one thing; the words and the button
 * are then centred inside that box rather than hung from its top. The unit's
 * height is the same on every page, so the mark does not move; the unit is
 * dead centre, so nothing rides high; and a state with two lines sits in the
 * middle of the space a state with four would have used, rather than at the top
 * of it. The reserve is sized to the longest state in the app — anything longer
 * simply grows the box, which moves the mark by half the overflow and is the
 * one case worth trading away.
 *
 * What is left is a dozen pixels, and it is left on purpose. Centring the unit
 * centres the room; what anybody actually sees is the ink, and the ink of the
 * shortest state stops half a room short of the bottom while the longest fills
 * it. Measured off the pixels of a real render, that puts the two of them about
 * eleven pixels either side of the centre line — and the even padding is what
 * keeps it *either side*. Deepening the top to sit the short state exactly on
 * the line only hands the whole error to the long one, twice the size.
 *
 * It claims its own height to do all this: `flex-1` takes whatever the page
 * column is handing down, and the floor under it means a state nested in a
 * section — where there is no page height to inherit — still stands in a room
 * rather than a line. One block, the same everywhere.
 *
 * ## The mark
 *
 * A dial on a horizon: the app's own fading hairline through the middle, two
 * rings lit from above and fading out before they reach the words, and the disc
 * itself over the glow this app puts under its hero art. It is the shape of an
 * instrument that is powered up and has nothing to report, which is what an
 * empty page here always is.
 *
 * ## The action
 *
 * Always the filled pill — `BUTTON.primary`, and nothing else. This was three
 * different weights across the app (a hand-rolled primary on the dashboard, a
 * secondary on the library, underlined words on the shelves), which read as
 * three different degrees of "you should do this" for what is in every case the
 * only thing on the page to do. There is at most one action here, it is the way
 * out of the empty state, and one thing on an otherwise empty page does not
 * need to be quiet.
 */
export function EmptyState({
  icon,
  title,
  action,
  className = "",
  children,
}: {
  /** SVG innards — paths and circles on a 24×24 stroke grid. */
  icon: React.ReactNode;
  title: string;
  /** The way out, when there is one. `BUTTON.primary`, always. */
  action?: React.ReactNode;
  /**
   * Where the block sits on *this* page, and nothing else.
   *
   * Everything above is arranged so the mark lands in the same place whatever
   * the state says — but that holds within the block, and pages hand it
   * different rooms: one under a tab bar, one under a heading and a filter row,
   * one nested in a section that has already spent the height. A `-mt-*` here
   * is the page saying how much of that to take back, which is a thing only the
   * page knows.
   *
   * Offsets only. The internals are the reason this component exists — pass
   * `min-h` or padding and you are undoing the reserve that keeps the mark
   * still, one page at a time.
   */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex min-h-[min(23rem,70dvh)] flex-1 flex-col items-center justify-center px-6 py-10 text-center ${className}`}
    >
      {/* The mark and the room the words live in, travelling as one thing.
          Its height is the same in every empty state in the app, which is what
          lets this be centred — the plain, obvious centring — without the mark
          moving from page to page. */}
      <div className="flex w-full max-w-md flex-col items-center">
        {/* The mark's own row, a constant `h-16`: everything drawn around the
            disc is taken out of the flow, so no part of the mark can move the
            line the words sit under. */}
        <div
          className="row-enter relative flex h-16 w-full items-center justify-center"
          style={stagger(0)}
        >
          {/* The horizon. The same hairline this app parts its rows with, fading
            out at both ends rather than ruling the width — it gives the mark
            something to stand on, and it is the one line on the page. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-line to-transparent"
          />

          {/* The light it is standing in — `--glow`, the fall-off already under
            the hero art, at the strength that reads as air rather than as one
            more circle. */}
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glow),transparent)]"
          />

          {/* Two rings, each masked away towards the bottom: lit from above, like
            everything else on a page whose glow comes from the top, and gone
            well before they reach the heading. The fade is also what lets them
            be this wide without boxing the words in — a ring drawn all the way
            round is a target, and half a ring is depth. */}
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line [-webkit-mask-image:linear-gradient(to_bottom,black,transparent_78%)] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line [-webkit-mask-image:linear-gradient(to_bottom,black,transparent_58%)] [mask-image:linear-gradient(to_bottom,black,transparent_58%)]"
          />

          {/* The disc. Opaque, so the horizon passes behind it rather than
            through the icon, with the page's own faint surface laid over the
            top of it and a hairline of light along the upper edge — the same
            way every raised thing in this app is lit. */}
          <span className="relative grid h-16 w-16 place-items-center rounded-full border border-line bg-background shadow-[inset_0_1px_0_var(--glow-over)]">
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-surface"
            />
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="relative h-7 w-7 opacity-60"
            >
              {icon}
            </svg>
          </span>
        </div>

        {/* The room the words live in. `min-h` is the reserve — the height of
            the longest state in the app, a heading over three lines and a
            button — and `justify-center` is what puts a two-line state in the
            middle of that room instead of at the top of it. The two together
            are the whole trick: the unit above is one height everywhere, so
            centring it does not move the mark, and the words inside are centred
            too, so a short state does not ride up inside its own reserve.

            The measure is in characters rather than rems: centred prose is read
            by finding the start of each line, and a line you have to hunt the
            start of is a line too long — which 24rem of `text-sm` is. */}
        <div className="mt-7 flex min-h-[11.5rem] max-w-[38ch] flex-col items-center justify-center">
          <p
            className="row-enter font-display text-2xl font-semibold tracking-tight"
            style={stagger(1)}
          >
            {title}
          </p>
          <p
            className="row-enter mt-2 text-sm leading-relaxed opacity-50"
            style={stagger(2)}
          >
            {children}
          </p>

          {action && (
            <div className="row-enter mt-7" style={stagger(3)}>
              {action}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
