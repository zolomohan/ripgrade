import "server-only";

import type { StripJob } from "./audio-strip";
import type { ConvertJob } from "./convert";
import type { DoviJob } from "./dovi";
import type { ScanState } from "./scanner";
import type { ThumbJob } from "./thumbs";
import type { SweepJob } from "./upgrade-sweep";

/**
 * The change signal behind `/api/jobs`.
 *
 * Every job module calls `notifyJobs()` from its `setState`/`setJob` choke
 * point; the SSE route subscribes and pushes a fresh snapshot to every open
 * connection. Carrying no payload is deliberate: subscribers read the jobs
 * through their getters at send time, so a coalesced burst of changes costs
 * one read of the latest state, not a queue of stale ones.
 */

/** Everything the client needs to draw the rail — every job, together. */
export type JobsSnapshot = {
  scan: ScanState;
  dovi: DoviJob;
  convert: ConvertJob;
  strip: StripJob;
  sweep: SweepJob;
  thumbs: ThumbJob;
};

/**
 * The scanner mutates its state once per discovered file — thousands of times
 * in a walk. Emitting each one would put more on the wire than the old polling
 * ever did, so changes within this window collapse into one send.
 */
const COALESCE_MS = 250;

type JobEvents = {
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  lastEmit: number;
};

/**
 * On globalThis for the same reason the job state itself is: this module can
 * exist more than once in one server (dev reload, separate action and route
 * bundles), and a module-local emitter would leave the SSE route listening to
 * a different instance than the one the running job notifies.
 */
const globalForEvents = globalThis as unknown as { medlibJobEvents?: JobEvents };

const events = (): JobEvents =>
  (globalForEvents.medlibJobEvents ??= {
    listeners: new Set(),
    timer: null,
    lastEmit: 0,
  });

function emit() {
  const ev = events();
  ev.timer = null;
  ev.lastEmit = Date.now();
  for (const listener of ev.listeners) {
    try {
      listener();
    } catch {
      // A connection that died mid-send must not stop the others hearing.
    }
  }
}

/**
 * Leading edge immediately, trailing edge after the window: a job's first
 * mutation (and anything after a quiet spell) reaches the client at once,
 * while a busy stretch settles into one send per window — always ending on
 * the latest state, so a final "done" is never swallowed.
 */
export function notifyJobs(): void {
  const ev = events();
  if (ev.timer) return;
  const wait = COALESCE_MS - (Date.now() - ev.lastEmit);
  if (wait <= 0) emit();
  else ev.timer = setTimeout(emit, wait);
}

/** Returns the unsubscribe, for the route to call when its connection closes. */
export function subscribeJobs(listener: () => void): () => void {
  const ev = events();
  ev.listeners.add(listener);
  return () => {
    ev.listeners.delete(listener);
  };
}
