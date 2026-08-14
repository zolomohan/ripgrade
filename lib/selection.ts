/**
 * Ticking a row in a list, and ticking every row between it and the last one.
 *
 * The same gesture `tickRange` gives the tracks inside one file — see
 * lib/audio-plan.ts — asked of the rows of a list instead, and without the rule
 * that keeps one of them: a film has to keep an audio track, but a list is
 * perfectly entitled to have all of its rows chosen.
 *
 * Here rather than in the component for the reason that one gives: what a
 * browser does with a shift-held click on a label is the browser's business,
 * but which rows end up chosen is this function's, and a range that comes out
 * inverted or off by one is a remux started on a film nobody meant to pick.
 *
 * Keyed rather than indexed on the way out, because the list the user is
 * looking at is sorted, cut into groups and re-rendered from the server every
 * time a job ends — an index means nothing across any of that, and a path
 * means the same thing before and after.
 */
export function tickRows<K>(
  chosen: ReadonlySet<K>,
  /** The rows in the order they are drawn, which is what a run runs along. */
  keys: readonly K[],
  index: number,
  /** The last row ticked by hand, or null if this is the first of a session. */
  anchor: number | null,
  /** Whether shift was held, which extends instead of toggling. */
  range: boolean,
): Set<K> {
  const next = new Set(chosen);
  const key = keys[index];
  if (key === undefined) return next;

  // What the clicked box itself is doing decides what the whole run does.
  const checking = !next.has(key);

  // With nothing to measure from, a shift-click is simply a click.
  const extend = range && anchor !== null && anchor < keys.length;
  const first = extend ? Math.min(anchor, index) : index;
  const last = extend ? Math.max(anchor, index) : index;

  for (let i = first; i <= last; i += 1) {
    const at = keys[i];
    if (at === undefined) continue;
    if (checking) next.add(at);
    else next.delete(at);
  }

  return next;
}
