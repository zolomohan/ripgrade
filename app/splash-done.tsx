"use client";

import { useEffect } from "react";

/**
 * Ends the splash's claim on the page.
 *
 * The overlay itself needs no JavaScript — it arrives in the first HTML and
 * leaves on a CSS animation. This is only the other half of that: `data-splash`
 * on <html> tells a list that mounted underneath the overlay to wait its turn,
 * and something has to say when the waiting is over. Removing the attribute
 * once means the wait belongs to the load that showed the splash, and not to
 * any navigation after it — those are client-side, and their lists should
 * cascade the moment they mount.
 *
 * Late enough that the last item of a staggered list has already started: an
 * animation that has finished does not restart when its delay changes.
 */
const CLEARED_AT = 2300;

export function SplashDone() {
  useEffect(() => {
    const timer = setTimeout(
      () => document.documentElement.removeAttribute("data-splash"),
      CLEARED_AT,
    );
    return () => clearTimeout(timer);
  }, []);

  return null;
}
