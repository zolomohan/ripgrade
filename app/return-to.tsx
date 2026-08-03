"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Where "back" goes, and why it is not `history.back()`.
 *
 * Going back through history is the honest way to return to a shelf — the URL
 * carries the filters, the sort and the scroll position, and the browser puts
 * all three back. But a history restore is not a React transition: React only
 * animates a view transition it runs itself, so a popstate leaves the poster to
 * cut rather than travel back to its tile. Measured, both ways round: a link to
 * the library animates, the back button did not.
 *
 * So the listing URL is remembered on the way out and navigated to on the way
 * back. The filters survive because the whole query string does.
 */
const KEY = "ripgrade:listing";

const LISTINGS = ["/", "/collections", "/wishlist", "/attention"];

/**
 * Catches the click that leaves a listing, in the capture phase so it runs
 * before the router does. One delegated listener rather than an onClick on
 * every poster in the app: the tiles are in six different views, and a handler
 * missing from one of them would be a back button that quietly forgets.
 */
export function RememberListing() {
  const pathname = usePathname();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const link = target?.closest?.("a[href^='/movie/'], a[href^='/show/']");
      if (!link || !LISTINGS.includes(location.pathname)) return;
      sessionStorage.setItem(KEY, location.pathname + location.search);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  /*
   * Clears the returning flag once the page being returned to has rendered.
   *
   * This effect is that moment: it runs after the commit that mounted the
   * shelf, whose tiles have already frozen their decision. A timer cannot know
   * when that is — the first attempt cleared after 900ms, and in development
   * the tiles arrived later than that and animated anyway.
   */
  useEffect(() => {
    const frame = requestAnimationFrame(clearReturning);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}

/** The listing last left, or the library when this page was opened directly. */
export const lastListing = () => {
  try {
    return sessionStorage.getItem(KEY) ?? "/";
  } catch {
    return "/";
  }
};

/**
 * Marks the return so the shelf does not replay its arrival.
 *
 * Every tile animates itself in when it mounts, which is right the first time
 * and wrong on the way back — the shelf was already there, and rebuilding it in
 * front of someone reads as the whole grid reloading.
 *
 * A flag rather than a class on the document, because CSS cannot express this.
 * `animation: none` while a marker is set does not cancel the animation, it
 * defers it: the moment the marker comes off, the elements gain an
 * animation-name they did not have and every tile plays at once. Each tile has
 * to decide for itself, once, as it mounts — which is what `useEntrance` is.
 */
let returning = false;

export const markReturning = () => {
  returning = true;
  // A floor under the clear below: if the navigation never lands, the flag must
  // not outlive it and silence every arrival from then on.
  setTimeout(() => (returning = false), 5000);
};

export const clearReturning = () => (returning = false);

/**
 * The entrance class for a tile, decided at mount and never revisited.
 *
 * Frozen in state on purpose: the flag clears a frame after the shelf renders,
 * and a tile that read it live would gain its animation at that moment — the
 * exact stampede this exists to prevent. Tiles mounted later, when a filter
 * admits them, read a flag that is false by then and animate normally.
 */
export const useEntrance = () =>
  useState(() => (returning ? "" : "row-enter"))[0];
