import assert from "node:assert/strict";
import { test } from "node:test";

import { tickRows } from "../lib/selection";

/*
 * The rows a shift-click covers, which is the half of a multi-select that is
 * worth a test: an ordinary click is a toggle, and a run that comes out
 * inverted or off by one starts a remux on a film nobody picked.
 */

const rows = ["a", "b", "c", "d", "e"];

test("a plain click ticks the row it was aimed at", () => {
  assert.deepEqual([...tickRows(new Set(), rows, 2, null, false)], ["c"]);
});

test("a second click on a ticked row unticks it", () => {
  const chosen = new Set(["c"]);
  assert.deepEqual([...tickRows(chosen, rows, 2, null, false)], []);
});

test("shift ticks the whole run between the anchor and the row", () => {
  const chosen = new Set(["a"]);
  const next = tickRows(chosen, rows, 3, 0, true);
  assert.deepEqual([...next].sort(), ["a", "b", "c", "d"]);
});

test("a run measured upwards covers the same rows", () => {
  const chosen = new Set(["d"]);
  const next = tickRows(chosen, rows, 1, 3, true);
  assert.deepEqual([...next].sort(), ["b", "c", "d"]);
});

test("shift-unticking clears the run, which is what makes it a checkbox", () => {
  const chosen = new Set(["a", "b", "c", "d"]);
  const next = tickRows(chosen, rows, 3, 0, true);
  assert.deepEqual([...next], []);
});

test("a shift-click with nothing to measure from is simply a click", () => {
  assert.deepEqual([...tickRows(new Set(), rows, 2, null, true)], ["c"]);
});

test("an anchor left behind by a shorter list does not extend anything", () => {
  // The list is re-sorted, re-cut and re-rendered under the anchor all the
  // time; one pointing past the end must not reach rows that are not there.
  assert.deepEqual([...tickRows(new Set(), rows, 1, 9, true)], ["b"]);
});

test("the run follows the order the rows are drawn in, not the array's", () => {
  // What `orderedBy` hands back once a grouping has cut the list: the same
  // rows, in the order they appear down the page.
  const grouped = ["e", "a", "d", "b", "c"];
  const next = tickRows(new Set(["e"]), grouped, 2, 0, true);
  assert.deepEqual([...next].sort(), ["a", "d", "e"]);
});
