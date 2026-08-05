"use client";

import { useEffect } from "react";

/**
 * Ends the splash, by handing it to the sidebar.
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

/** When the mark leaves the middle of the screen for the rail. */
const HANDOVER_AT = 1500;

export function SplashDone() {
  useEffect(() => {
    /*
     * The mark and the name travel to the rail rather than fading where they
     * stand — the same trick a poster plays on its way to a film's page, and
     * for the same reason: the thing in the middle of the screen and the thing
     * in the corner are one object, and showing that is what makes the app feel
     * like it was already there.
     *
     * Driven from here rather than from CSS because a view transition needs a
     * DOM change to bracket: the overlay goes, and in the same update the
     * sidebar's mark takes the name the splash's had. `data-landed` is what
     * hands it over, and it comes off again once the animation has finished so
     * the rail is not snapshotted on every navigation afterwards.
     */
    const handover = setTimeout(() => {
      const root = document.documentElement;
      const swap = () => {
        // Hidden rather than removed. The overlay is a React-rendered node,
        // and pulling it out of the DOM by hand leaves React holding a child
        // of <body> that is no longer there — every later commit that walks
        // body's children (and with view transitions, that is every
        // navigation) then throws insertBefore/removeChild NotFoundErrors.
        // A display:none element is not captured by a view transition any
        // more than a removed one is, so the handover reads the same.
        const splash = document.querySelector<HTMLElement>(".splash");
        if (splash) splash.style.display = "none";
        root.setAttribute("data-landed", "");
      };

      if (!document.startViewTransition) {
        swap();
        return;
      }

      document
        .startViewTransition(swap)
        .finished.finally(() => root.removeAttribute("data-landed"));
    }, HANDOVER_AT);

    const timer = setTimeout(
      () => document.documentElement.removeAttribute("data-splash"),
      CLEARED_AT,
    );

    return () => {
      clearTimeout(handover);
      clearTimeout(timer);
    };
  }, []);

  return null;
}
