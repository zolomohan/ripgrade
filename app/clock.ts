"use client";

import { useSyncExternalStore } from "react";

/**
 * The wall clock, to the second, as something React can subscribe to.
 *
 * Whole seconds rather than milliseconds because the snapshot has to hold still
 * between reads within one render — `Date.now()` never does, and React reads it
 * more than once.
 *
 * A store rather than a `setInterval` writing state from an effect: a clock is
 * an external system, which is the case `useSyncExternalStore` exists for. It
 * also settles the server, where there is no clock to read and any time printed
 * would be wrong before it arrived.
 */
const clock = {
  subscribe(onTick: () => void) {
    const timer = setInterval(onTick, 1000);
    return () => clearInterval(timer);
  },
  now: () => Math.floor(Date.now() / 1000),
  /** No clock on the server; nothing that depends on one is rendered there. */
  onServer: () => 0,
};

const idle = () => () => {};

/**
 * The time now, in milliseconds, ticking once a second — or 0 on the server and
 * for the first paint after it, which callers read as "no clock yet" and print
 * something that does not depend on one.
 *
 * `active` false leaves the interval unstarted, for a component that only
 * sometimes has something to count.
 */
export function useNow(active = true): number {
  const seconds = useSyncExternalStore(
    active ? clock.subscribe : idle,
    clock.now,
    clock.onServer,
  );
  return seconds * 1000;
}
