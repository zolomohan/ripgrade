import { SplashDone } from "./splash-done";

/**
 * The two seconds before the library appears.
 *
 * The overlay is deliberately not a client component and deliberately without
 * state: it is in the first HTML the browser receives and it leaves on a CSS
 * animation, so it needs no JavaScript to arrive and none to go away. Nothing
 * is being waited for either — the page renders behind it the whole time.
 *
 * What it covers, though, is a list arriving. `data-splash` on <html> holds
 * those items back so they cascade into view as the overlay lifts instead of
 * behind it; `SplashDone` is the one line of JavaScript that lets go of them.
 *
 * Hidden from assistive technology: the page underneath is what is being read,
 * and this is a mark and a name it already has in the sidebar.
 */
export function Splash() {
  return (
    <>
      <SplashDone />
      <div className="splash" aria-hidden>
        <div className="splash-mark">
          <span className="mark-skull splash-skull h-24 w-[4.61rem] sm:h-28 sm:w-[5.38rem]" />
          <span className="splash-word font-logo text-5xl leading-none lowercase sm:text-6xl">
            ripgrade
          </span>
        </div>
      </div>
    </>
  );
}
