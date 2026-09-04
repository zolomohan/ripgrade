"use client";

import { Toaster } from "glaceui";

import { useGlass } from "./glass";
import type { Theme } from "@/lib/theme";

/**
 * Where the app says a thing happened and then stops saying it.
 *
 * The one part of Glacé this app had no equivalent of, and the reason is worth
 * writing down: it did not have transient feedback at all. What it had instead
 * was transient feedback invented per site — a receipt hung under the scan
 * button for the one pass with no job to watch, an error chip under Reveal in
 * Finder, a status line in the thumbnail cache — each with its own timer, its
 * own corner to appear in, and its own opinion about how long a sentence
 * survives. Three answers to a question nobody had asked once.
 *
 * The rail is why there were only three. Anything that takes long enough to
 * watch is a job, and a job reports itself in the rail from wherever you are
 * standing — see app/sidebar-processes.tsx. That is the right home for work in
 * progress and the wrong one for work already over: a pass that touches no disk
 * is finished before the rail could draw it, and a permission error from the
 * Finder is not a job at all. Those are what land here.
 *
 * So this is deliberately not a general notification system. Nothing that
 * belongs in the rail should be sent to it, and nothing a form can say inline
 * should be either — an error about the field you are typing in belongs beside
 * the field. What is left is the narrow case both of the sites above are: a
 * short sentence about something that has already happened, somewhere other
 * than where you are looking.
 *
 * The tuning comes from the same setting as every other pane, so a toast is the
 * app's own glass rather than the kit's — see app/glass.tsx. `Toaster` takes
 * the rim and the frosting but not the opacity, which reaches Glacé's own
 * surfaces as `--g-bg` and its toasts as `--glace-bg`; globals.css ties the
 * second to the first.
 *
 * Top right, and three at a time.
 *
 * Not the bottom, which is where a toast usually goes and where this started.
 * The bottom of this app is where you are working: a shelf runs off the foot of
 * every listing page and the film page's controls sit down there, so a stack
 * arriving in that corner lands on top of the thing you were reaching for. The
 * top right is the one corner of this layout that holds nothing — the rail owns
 * the left edge at every width, and the narrow screen's bar owns the top left
 * with the brand on it. What is left is the corner a receipt can appear in
 * without covering anything.
 */
export function Toasts({ theme }: { theme: Theme }) {
  const glass = useGlass();

  return (
    <Toaster
      position="top-right"
      /*
       * Told rather than left to work it out. Every other surface in the app
       * takes its scheme from CSS, which now answers to a setting; a toast is
       * Glacé's own component and asks `matchMedia` for itself, so on a machine
       * set dark and an app set light it would have been the one pane still
       * agreeing with the machine. The three values happen to be the three this
       * app has, which is why this is a pass-through and not a translation.
       */
      theme={theme}
      refract={glass.refract === 0 ? false : glass.refract}
      aberration={glass.aberration}
      blur={glass.blur}
      // Off. It is the Vibration API, which no desktop and no iPhone exposes,
      // and this app is used at a desk in front of a library — a buzz for a
      // finished re-derive is a phone's idea of importance.
      haptics={false}
      // Long enough to read a sentence twice, which is what the rail gives a
      // finished scan's summary. The two say the same kind of thing.
      duration={5000}
    />
  );
}
