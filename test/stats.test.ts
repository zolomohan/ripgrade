import assert from "node:assert/strict";
import { test } from "node:test";

import { ISSUE_CATALOGUE, type Issue } from "../lib/derive";
import type { LibraryItem } from "../lib/library";
import {
  computeGrowth,
  computeIssues,
  computeMatchCoverage,
} from "../lib/stats";

/**
 * The dashboard's arithmetic, tested against fixtures rather than against the
 * four hundred real films in the database — which is the whole reason these
 * functions live in `lib/stats.ts` and take the library as an argument instead
 * of reading it.
 */

/**
 * Enough of a `LibraryItem` for the functions under test, and nothing else.
 *
 * The cast is deliberate: `Derived` carries forty fields describing a video
 * file, and a fixture that filled them all in would be four hundred lines
 * asserting nothing. What each test needs, it names.
 */
const film = (over: Partial<LibraryItem> = {}): LibraryItem =>
  ({
    path: "/m/A.mkv",
    title: "A",
    kind: "movie",
    sizeBytes: 1e9,
    addedAt: 0,
    acknowledged: false,
    issues: [],
    art: {},
    ...over,
  }) as LibraryItem;

const issue = (code: string, severity: Issue["severity"]): Issue => ({
  code,
  severity,
  message: code,
});

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

test("severity counts issues, not the films holding them", () => {
  // One film with three problems is three problems. Counting it once would
  // make the severity bar a second copy of `filmsAffected`.
  const tally = computeIssues([
    film({
      issues: [
        issue("dv-profile-7", "warning"),
        issue("low-bitrate", "warning"),
        issue("fake-4k", "critical"),
      ],
    }),
  ]);

  assert.deepEqual(tally.bySeverity, [
    { label: "Critical", count: 1 },
    { label: "Warning", count: 2 },
    { label: "Info", count: 0 },
  ]);
  assert.equal(tally.filmsAffected, 1);
  assert.equal(tally.filmsCritical, 1);
});

test("every severity is reported even at zero", () => {
  // The bar is a part of a whole, and a whole that drops its empty parts
  // changes shape between two renders of the same library.
  const tally = computeIssues([
    film({ issues: [issue("low-bitrate", "warning")] }),
  ]);

  assert.equal(tally.bySeverity.length, 3);
  assert.deepEqual(
    tally.bySeverity.map((s) => s.label),
    ["Critical", "Warning", "Info"],
  );
});

test("a film accepted as-is holds no open issues", () => {
  // `acknowledged` is "you have looked at this and decided", which is what
  // `openIssues` exists to honour — the dashboard must not re-raise it.
  const tally = computeIssues([
    film({ acknowledged: true, issues: [issue("fake-4k", "critical")] }),
  ]);

  assert.equal(tally.filmsAffected, 0);
  assert.equal(tally.filmsCritical, 0);
  assert.deepEqual(tally.byCode, []);
});

test("codes are ranked by occurrences and carry the storage they sit on", () => {
  const tally = computeIssues([
    film({
      path: "/a",
      sizeBytes: 10e9,
      issues: [issue("dv-profile-7", "warning")],
    }),
    film({
      path: "/b",
      sizeBytes: 20e9,
      issues: [issue("dv-profile-7", "warning")],
    }),
    film({
      path: "/c",
      sizeBytes: 5e9,
      issues: [issue("low-bitrate", "warning")],
    }),
  ]);

  // Under the catalogue's own name for the check, not its code: the chart is
  // read by someone looking at their library, not at `/how-it-works`.
  assert.deepEqual(tally.byCode, [
    { label: ISSUE_CATALOGUE["dv-profile-7"].name, count: 2, bytes: 30e9 },
    { label: ISSUE_CATALOGUE["low-bitrate"].name, count: 1, bytes: 5e9 },
  ]);
});

test("a code the catalogue does not know keeps its own name", () => {
  const tally = computeIssues([
    film({ issues: [issue("invented-code", "warning")] }),
  ]);

  assert.deepEqual(
    tally.byCode.map((s) => s.label),
    ["invented-code"],
  );
});

test("the code list is capped, and the cap keeps the commonest", () => {
  const items = ["a", "b", "c", "d"].map((code, i) =>
    // One extra occurrence each, so the order is unambiguous.
    film({
      path: `/${code}`,
      issues: Array.from({ length: i + 1 }, () => issue(code, "info")),
    }),
  );

  const tally = computeIssues(items, 2);
  assert.deepEqual(
    tally.byCode.map((s) => s.label),
    ["d", "c"],
  );
});

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

const MARCH_2026 = new Date(2026, 2, 15).getTime();
const at = (year: number, month: number) => new Date(year, month, 3).getTime();

test("the window ends with the month we are in", () => {
  const buckets = computeGrowth([], 3, MARCH_2026);

  assert.deepEqual(
    buckets.map((b) => b.label),
    ["Jan", "Feb", "Mar"],
  );
});

test("everything older than the window is the floor, not a lost month", () => {
  // A library scanned once two years ago and never added to is not a library
  // that grew from nothing in January — the first column has to stand on what
  // was already there.
  const buckets = computeGrowth(
    [film({ addedAt: at(2024, 0), sizeBytes: 100e9 })],
    3,
    MARCH_2026,
  );

  assert.deepEqual(
    buckets.map((b) => b.cumulativeBytes),
    [100e9, 100e9, 100e9],
  );
  // But it is not counted as arriving in any of them.
  assert.deepEqual(
    buckets.map((b) => b.count),
    [0, 0, 0],
  );
});

test("bytes accumulate forward and never fall", () => {
  const buckets = computeGrowth(
    [
      film({ path: "/a", addedAt: at(2026, 0), sizeBytes: 10e9 }),
      film({ path: "/b", addedAt: at(2026, 2), sizeBytes: 5e9 }),
    ],
    3,
    MARCH_2026,
  );

  assert.deepEqual(
    buckets.map((b) => b.bytes),
    [10e9, 0, 5e9],
  );
  assert.deepEqual(
    buckets.map((b) => b.cumulativeBytes),
    [10e9, 10e9, 15e9],
  );
  assert.deepEqual(
    buckets.map((b) => b.cumulativeCount),
    [1, 1, 2],
  );
});

test("a file added this month lands in the last bucket, not past the end", () => {
  const buckets = computeGrowth(
    [film({ addedAt: at(2026, 2), sizeBytes: 7e9 })],
    3,
    MARCH_2026,
  );

  assert.equal(buckets.at(-1)?.count, 1);
  assert.equal(buckets.at(-1)?.bytes, 7e9);
});

test("no months means no chart", () => {
  assert.deepEqual(computeGrowth([film()], 0, MARCH_2026), []);
});

// ---------------------------------------------------------------------------
// Match coverage
// ---------------------------------------------------------------------------

test("only a high-confidence match counts as done", () => {
  // Anything less is a guess the app is not willing to raise runtime issues
  // from, so it is not a match for this purpose either.
  const coverage = computeMatchCoverage([
    film({ path: "/a", tmdb: { id: 1, title: "A", confidence: "high" } }),
    film({ path: "/b", tmdb: { id: 2, title: "B", confidence: "medium" } }),
    film({ path: "/c", tmdb: { id: 3, title: "C", confidence: "low" } }),
    film({ path: "/d" }),
  ]);

  assert.deepEqual(coverage, [
    { label: "Matched", count: 1 },
    { label: "Needs review", count: 2 },
    { label: "Not identified", count: 1 },
  ]);
});

test("an empty library reports three zeroes rather than nothing", () => {
  assert.deepEqual(
    computeMatchCoverage([]).map((s) => s.count),
    [0, 0, 0],
  );
});
