/**
 * Work under way, in the button you pressed to start it.
 *
 * One loader for the whole app. Every button that goes and does something —
 * a token being checked, a folder being read, a sweep of every indexer —
 * shows this beside its own label rather than inventing a way of its own to
 * say the same thing. The label stays put and keeps saying what is happening;
 * this only says that it still is.
 *
 * The iPhone's indicator, drawn the way it is actually built: eight fixed
 * spokes at descending opacity, and the whole wheel stepped round one spoke at
 * a time. Nothing fades — the brightest position simply moves, which is what
 * gives it the chase rather than the spin of a rotating arc. Eight steps a
 * turn also means it never lands between spokes, so it reads as clean at
 * 14 pixels as at forty.
 *
 * `currentColor`, so it belongs to whatever it is sitting on: the background
 * colour on a filled pill, the foreground on a bordered one, red on a
 * destructive one, with nothing to keep in step by hand.
 */

/**
 * Brightest first and then away round the wheel. Not a straight ramp: the tail
 * has to fall off faster than the head or the whole ring reads as evenly lit
 * and the movement disappears.
 */
const SPOKES = [1, 0.82, 0.67, 0.54, 0.43, 0.33, 0.24, 0.16];

export function Spinner({
  /**
   * Sized by its caller, because a spinner belongs to the text it stands
   * beside. The default is the icon size the app's buttons already use.
   */
  className = "h-3.5 w-3.5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={`spinner shrink-0 ${className}`}
    >
      {SPOKES.map((opacity, i) => (
        <rect
          key={i}
          x="10.9"
          y="2.6"
          width="2.2"
          height="5.8"
          rx="1.1"
          fill="currentColor"
          opacity={opacity}
          transform={`rotate(${i * 45} 12 12)`}
        />
      ))}
    </svg>
  );
}
