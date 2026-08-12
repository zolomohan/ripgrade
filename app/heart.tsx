"use client";

import { useState } from "react";

/**
 * Wanting something, in the one mark that has meant it for fifteen years.
 *
 * One heart for the whole app. It was two — the same eleven-point path drawn
 * twice, at two sizes, in two files that had no reason to know about each
 * other — and they were already a stroke-weight apart before anything asked
 * them to animate.
 *
 * It moves when it changes, and the movement is the point: the wishlist is the
 * one thing in this app you alter without a page behind it and without waiting
 * for anything, so there is nothing to say it happened except the mark itself.
 *
 * It moves differently in each direction, because the two are not the same act.
 * Filling is squash, overshoot, settle — the shape a tapped heart has had since
 * Instagram gave it one, and the reason a like reads as answered rather than
 * merely recorded. Emptying is that shape run the other way: a collapse and a
 * small rebound, quicker, and never larger than it started. Taking something
 * off a list should feel like letting go of it, not like a second celebration —
 * and an app whose yes and whose no look alike is an app you have to read the
 * colour of to know what you just did.
 *
 * Neither plays on arrival. The previous value is kept so a heart that loads
 * already filled — every wanted film on a freshly opened shelf — simply is
 * filled, rather than the page opening with a dozen hearts going off at once.
 */
export function Heart({
  filled,
  /**
   * Sized by its caller, the way `Spinner` is: this sits in a poster's corner
   * at one size and beside a film's title at another, and neither is the
   * heart's business.
   */
  className = "h-6 w-6",
}: {
  filled: boolean;
  className?: string;
}) {
  /*
   * The count is what restarts the animation. A CSS animation runs once per
   * element, so a class alone would fire on the first press and never again —
   * keying the drawing on a number that changes remounts it, which is the way
   * to replay one without reaching for the DOM. It counts every change rather
   * than every fill, because both directions have something to play now.
   *
   * Adjusted during render rather than in an effect, the way `useClosing` in
   * app/modal.tsx does it: an effect would paint the new state's first frame
   * plain and start the motion one frame late.
   */
  const [was, setWas] = useState(filled);
  const [beats, setBeats] = useState(0);

  if (filled !== was) {
    setWas(filled);
    setBeats((n) => n + 1);
  }

  // Nothing at all until something has actually been pressed: at zero this is
  // a heart that arrived the way it is, and playing either motion on mount
  // would set off every filled heart on the shelf at once.
  const motion = beats === 0 ? "" : filled ? "heart-pop" : "heart-off";

  return (
    <svg
      key={beats}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`${motion} ${className}`}
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

/*
 * How it is worn over artwork lives with the cross it shares a poster's top
 * edge with — see `OVER_ART` and `WANTED_ART` in app/tile-button.tsx. The two
 * marks are the same treatment doing the same job, and they were a plate and a
 * size apart for as long as each kept its own copy of it.
 */
