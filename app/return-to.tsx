"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";

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
const SCROLL_KEY = "ripgrade:listingScroll";

/**
 * A page you can arrive at something *from*.
 *
 * The shelves, and also the pages that are themselves lists of pages: a show
 * lists its episodes, a collection lists its films, and a series nobody owns
 * lists its seasons and theirs their episodes. Back from an episode means back
 * to the season, not back to the library it was three clicks ago.
 *
 * Search was one of them, while it was a page. It is a window now, and a window
 * is not somewhere you can be sent back to: opening a film from it closes it
 * and leaves the page underneath, which is the page this trail already holds.
 * See app/search/dialog.tsx.
 */
const LISTINGS = ["/library", "/collections", "/wishlist", "/upgrades"];

const isListing = (path: string) =>
  LISTINGS.includes(path) ||
  path.startsWith("/show/") ||
  path.startsWith("/collections/") ||
  path.startsWith("/discover/");

/** Where you were, and how far down it you had got. */
type Crumb = { url: string; scroll: number };

/*
 * A trail rather than a single address, because these nest: library → show →
 * episode. One slot would have the show overwrite the library on the way in,
 * and then send the show's own back button to the show.
 */
function readTrail(): Crumb[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const trail = raw ? (JSON.parse(raw) as Crumb[]) : [];
    return Array.isArray(trail) ? trail : [];
  } catch {
    return [];
  }
}

function writeTrail(trail: Crumb[]) {
  try {
    // Ten is far past any real path through this app; the cap is only there so
    // a loop of clicks cannot grow the entry without bound.
    sessionStorage.setItem(KEY, JSON.stringify(trail.slice(-10)));
  } catch {
    // A private window with no storage: back still works, it just goes home.
  }
}

/**
 * Catches the click that leaves a listing, in the capture phase so it runs
 * before the router does. One delegated listener rather than an onClick on
 * every poster in the app: the tiles are in six different views, and a handler
 * missing from one of them would be a back button that quietly forgets.
 */
/**
 * Records the page being left as the place "back" returns to. Shared by the
 * click capture below and by controls that navigate imperatively — the
 * upgrade queue's rows push a route from a handler, which no delegated
 * anchor listener can see.
 */
export function rememberListing() {
  if (!isListing(location.pathname)) return;

  // The offset as well as the address: returning to the top of a shelf you
  // were halfway down is a different place, and it takes the tile you came
  // from off the screen — so the poster has nowhere to travel back to.
  const crumb = {
    url: location.pathname + location.search,
    scroll: Math.round(window.scrollY),
  };

  const trail = readTrail();
  // Clicking a second tile on the same shelf is not a step deeper; it is
  // the same step, taken from a different scroll offset.
  if (trail[trail.length - 1]?.url === crumb.url) trail.pop();
  writeTrail([...trail, crumb]);
}

export function RememberListing() {
  const pathname = usePathname();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const link = target?.closest?.(
        "a[href^='/film/'], a[href^='/episode/'], a[href^='/show/'], a[href^='/collections/'], a[href^='/discover/']",
      );
      if (!link) return;
      rememberListing();
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

  /*
   * Restores the scroll offset the shelf was left at.
   *
   * A layout effect rather than an effect: this runs inside the commit that
   * mounted the shelf, which is the state the view transition captures. Put it
   * a frame later and the poster has already been told to land at the top of
   * an unscrolled page, and it flies to the wrong place — or off it.
   */
  useLayoutEffect(() => {
    if (!isReturning()) return;
    const saved = Number(sessionStorage.getItem(SCROLL_KEY) ?? "");
    if (Number.isFinite(saved) && saved > 0) window.scrollTo(0, saved);
  }, [pathname]);

  return null;
}

/** Whether a return is in progress; see `markReturning`. */
export const isReturning = () => returning;

/**
 * The listing last left, or the library when this page was opened directly.
 *
 * The shelf rather than the dashboard: arriving at a film from a bookmark and
 * pressing back means "show me this among the others", which is a question the
 * status board does not answer.
 */
export const lastListing = () => readTrail().at(-1)?.url ?? "/library";

/**
 * The same, and steps off it: going back is leaving this page, so the page it
 * returns to is no longer the one behind you.
 */
export const popListing = () => {
  const trail = readTrail();
  const crumb = trail.pop();
  writeTrail(trail);

  try {
    sessionStorage.setItem(SCROLL_KEY, String(crumb?.scroll ?? 0));
  } catch {
    // See writeTrail.
  }

  return crumb?.url ?? "/library";
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
