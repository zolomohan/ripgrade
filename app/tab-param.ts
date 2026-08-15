"use client";

import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * A switch at the head of a page, written to the address and animated on the
 * way over.
 *
 * Three pages ask the same question — which half of this am I reading — and all
 * three wrote it out themselves. The library's and the wishlist's were the same
 * eight lines twice over, reading `t` and writing it back with `replaceState`.
 * The collections page had a third version that did something the other two did
 * not: it held the tab as state and changed it inside `startTransition`, which
 * is what let a poster on both halves fly from the row it was on to the row it
 * moved to.
 *
 * That difference was invisible as a decision and very visible as a result:
 * Yours ↔ TMDb glided, Films ↔ Shows cut. The same gesture, in the same control,
 * at the same place on the page, behaving two ways depending on which page you
 * were standing on. This is the collections version, which is the one worth
 * keeping, made available to all three.
 *
 * **Why state at all**, when the address is the record: a `replaceState` is not
 * an update React is holding the reins of, and a view transition only runs for a
 * change React made inside `startTransition`. So the thing that renders has to
 * be state this hook owns, and the address is written alongside it — inside the
 * same transition, so the router's own repaint is part of the change being
 * animated rather than a second render arriving in the middle of it.
 *
 * **Why `replaceState` and not the router**: which half you are reading is a
 * question about how the page you are on is drawn. Pushed, every tap would be a
 * step in the history you have to press back through to leave.
 *
 * Seeded from the address and never resynced, which is exactly right here:
 * nothing but this switch moves the parameter, and arriving from anywhere else —
 * the dashboard's "Missing episodes" tile, a link into a set, the back button —
 * is a mount, which reads it again.
 */
export function useTabParam<T extends string>(
  key: string,
  values: readonly T[],
  /**
   * The tab the bare address means, and the one value never written to it. What
   * keeps a plain `/library` the films shelf and a shared link short.
   */
  fallback: T,
): [T, (next: string) => void] {
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<T>(() => {
    const param = searchParams.get(key);
    return values.includes(param as T) ? (param as T) : fallback;
  });

  const [, startTransition] = useTransition();

  function select(next: string) {
    // Nothing to animate and nothing to write: tapping the tab you are on is
    // not a change, and treating it as one would play the flight in place.
    if (next === tab || !values.includes(next as T)) return;

    startTransition(() => {
      setTab(next as T);

      const params = new URLSearchParams(searchParams.toString());
      if (next === fallback) params.delete(key);
      else params.set(key, next);
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
    });
  }

  return [tab, select];
}
