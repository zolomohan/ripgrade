import assert from "node:assert/strict";
import { test } from "node:test";

import { ISSUE_CATALOGUE, type Issue } from "../lib/derive";
import type { LibraryItem } from "../lib/library";
import type { Show } from "../lib/shows";
import {
  computeGrowth,
  computeIssues,
  computeMatchCoverage,
  computeShowStats,
  computeStats,
  type ShowStats,
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
    audio: [],
    art: {},
    ...over,
  }) as LibraryItem;

/** A high-confidence match, which is all these tests need a TMDb id to be. */
const id = (n: number) => ({
  id: n,
  title: String(n),
  confidence: "high" as const,
});

/**
 * A scored ceiling, named by the one field the coverage split reads. Cast for
 * the same reason `film` is: `DiscFacts` describes a whole release, and none
 * of the rest of it changes which bucket a film lands in.
 */
const ceiling = (discScore: number) =>
  ({ discScore }) as NonNullable<LibraryItem["disc"]>;

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

// ---------------------------------------------------------------------------
// Quality comparison
// ---------------------------------------------------------------------------

test("a ceiling typed in is counted apart from one that was found", () => {
  // Both scored the same way and neither film can tell you which it got — the
  // set of ids is the only thing that separates them, which is exactly why
  // this is worth pinning.
  const stats = computeStats(
    [
      film({ path: "/a", tmdb: id(1), disc: ceiling(90) }),
      film({ path: "/b", tmdb: id(2), disc: ceiling(80) }),
      film({ path: "/c", tmdb: id(3), disc: ceiling(70) }),
      film({ path: "/d", tmdb: id(4) }),
      film({ path: "/e" }),
    ],
    new Set([3]),
  );

  assert.deepEqual(stats.qualityCoverage, [
    { label: "Disc", count: 2 },
    { label: "Manual", count: 1 },
    { label: "None", count: 2 },
  ]);
});

test("an entered id for a film with no ceiling counts as neither", () => {
  // The entry exists but nothing came of it, and the card is about what the
  // verdicts rest on rather than about what was typed.
  const stats = computeStats([film({ path: "/a", tmdb: id(1) })], new Set([1]));

  assert.deepEqual(
    stats.qualityCoverage.map((s) => s.count),
    [0, 0, 1],
  );
});

test("the films with no ceiling say which problem they are", () => {
  const stats = computeStats([
    film({ path: "/a", tmdb: id(1) }),
    film({ path: "/b" }),
  ]);

  assert.deepEqual(stats.uncomparedReasons, [
    { label: "Identified, no disc found", count: 1 },
    { label: "Not identified yet", count: 1 },
  ]);
});

test("a reason nobody has is left out rather than drawn at zero", () => {
  const stats = computeStats([film({ path: "/a", tmdb: id(1) })]);

  assert.deepEqual(stats.uncomparedReasons, [
    { label: "Identified, no disc found", count: 1 },
  ]);
});

// ---------------------------------------------------------------------------
// Television verdicts
// ---------------------------------------------------------------------------

/**
 * A show of one season, holding whatever episodes the test hands it. `over`
 * replaces the season outright where a test needs gaps, a set, or a second one.
 */
const show = (episodes: LibraryItem[], over: Partial<Show> = {}): Show =>
  ({
    key: "a",
    title: "A",
    seasons: [
      {
        number: 1,
        episodes: episodes.map((item, i) => ({ item, number: i + 1 })),
        missing: [],
      },
    ],
    episodeCount: episodes.length,
    sizeBytes: episodes.reduce((n, e) => n + e.sizeBytes, 0),
    art: {},
    ...over,
  }) as Show;

/** A season, for the tests that care what is behind it rather than in it. */
const season = (
  episodes: LibraryItem[],
  over: Partial<Show["seasons"][number]> = {},
) =>
  ({
    number: 1,
    episodes: episodes.map((item, i) => ({ item, number: i + 1 })),
    missing: [],
    ...over,
  }) as Show["seasons"][number];

/** A disc release for a season, named by the two fields the coverage reads. */
const set = (entered = false) =>
  ({
    uhdExists: false,
    releaseCount: 1,
    best: { format: "Blu-ray" },
    entered,
  }) as unknown as Show["seasons"][number]["disc"];

/** A show's match, which carries a name where a film's carries a title. */
const named = (n: number, confidence: "high" | "low" = "high") =>
  ({ id: n, name: String(n), confidence }) as Show["tmdb"];

const episode = (over: Partial<LibraryItem> = {}) =>
  film({
    kind: "episode",
    scores: { overall: 0 },
    ...over,
  } as Partial<LibraryItem>);

test("episodes are ranked against the season set they were compared to", () => {
  // The point of the chart: a season nobody owns on disc has no ranking to be
  // on, and an episode that was compared belongs on the same four-step scale a
  // film does — the season set is a disc like any other.
  const stats = computeShowStats([
    show([
      episode({ path: "/a", disc: ceiling(90), status: "Best Available" }),
      episode({ path: "/b", disc: ceiling(90), status: "Must Upgrade" }),
      episode({ path: "/c", status: "Excellent" }),
    ]),
  ]);

  assert.deepEqual(stats.scores, [
    { status: "Must Upgrade", count: 1 },
    { status: "Upgrade Recommended", count: 0 },
    { status: "Good", count: 0 },
    { status: "Best Available", count: 1 },
  ]);
});

test("an episode with no season set is stated on the other scale, not ranked", () => {
  const stats = computeShowStats([
    show([
      episode({ path: "/a", disc: ceiling(90), status: "Good" }),
      episode({ path: "/b", status: "Reference" }),
      episode({ path: "/c", status: "Reference" }),
    ]),
  ]);

  assert.equal(stats.uncompared.total, 2);
  assert.deepEqual(stats.uncompared.byStatus, [
    { status: "Reference", count: 2 },
  ]);
  // And it is nowhere in the ranking — one compared episode, one column.
  assert.equal(
    stats.scores.reduce((n, s) => n + s.count, 0),
    1,
  );
});

test("a library of shows nobody owns on disc ranks nothing", () => {
  // What the card checks before drawing four empty columns.
  const stats = computeShowStats([
    show([episode({ path: "/a", status: "Excellent" })]),
  ]);

  assert.equal(
    stats.scores.reduce((n, s) => n + s.count, 0),
    0,
  );
  assert.equal(stats.uncompared.total, 1);
});

// ---------------------------------------------------------------------------
// The show as a whole
// ---------------------------------------------------------------------------

const verdict = (stats: ShowStats, label: string) =>
  stats.showVerdicts.find((v) => v.label === label)?.count;

test("a gap outranks every reading of the files that are there", () => {
  // The bucket order is the point: a season short of an episode is not the
  // best available copy of anything, however good the files present are.
  const stats = computeShowStats([
    show(
      [episode({ path: "/a", disc: ceiling(90), status: "Best Available" })],
      {
        seasons: [
          season([episode({ path: "/a", disc: ceiling(90) })], {
            total: 2,
            missing: [{ number: 2 }],
          }),
        ],
      },
    ),
  ]);

  assert.equal(verdict(stats, "Missing episodes"), 1);
  assert.equal(verdict(stats, "Best available"), 0);
});

test("the worst episode speaks for the show", () => {
  // Nineteen good files and one that must be replaced is a show with work to
  // do, and an average would have hidden the one that needs it.
  const stats = computeShowStats([
    show([
      episode({ path: "/a", disc: ceiling(90), status: "Best Available" }),
      episode({ path: "/b", disc: ceiling(90), status: "Must Upgrade" }),
    ]),
  ]);

  assert.equal(verdict(stats, "Must upgrade"), 1);
  assert.equal(verdict(stats, "Best available"), 0);
});

test("one episode with no set is enough to hold the show back", () => {
  const stats = computeShowStats([
    show([
      episode({ path: "/a", disc: ceiling(90), status: "Best Available" }),
      episode({ path: "/b", status: "Reference" }),
    ]),
  ]);

  assert.equal(verdict(stats, "Not compared to a disc"), 1);
});

test("every bucket is reported even at zero", () => {
  // The columns are a fixed axis, like the severity bar: a chart that drops its
  // empty buckets changes shape between two renders of the same library.
  const stats = computeShowStats([show([episode({ path: "/a" })])]);

  assert.deepEqual(
    stats.showVerdicts.map((v) => v.label),
    [
      "Missing episodes",
      "Must upgrade",
      "Upgrade recommended",
      "Best available",
      "Not compared to a disc",
    ],
  );
});

// ---------------------------------------------------------------------------
// Season sets, matches and consistency
// ---------------------------------------------------------------------------

test("a season set typed in is counted apart from one that was found", () => {
  // The films' split, drawn per season — a ceiling somebody remembered is not
  // one anybody can check.
  const stats = computeShowStats([
    show([], {
      seasons: [
        season([episode({ path: "/a" })], { number: 1, disc: set() }),
        season([episode({ path: "/b" })], { number: 2, disc: set(true) }),
        season([episode({ path: "/c" })], { number: 3 }),
      ],
    }),
  ]);

  assert.deepEqual(stats.discCoverage, [
    { label: "Disc", count: 1 },
    { label: "Manual", count: 1 },
    { label: "None", count: 1 },
  ]);
});

test("a season holding nothing is not a season that failed to compare", () => {
  // A gap in the numbering is not a season you own.
  const stats = computeShowStats([
    show([], {
      seasons: [
        season([episode({ path: "/a" })], { number: 1, disc: set() }),
        season([], { number: 2 }),
      ],
    }),
  ]);

  assert.deepEqual(
    stats.discCoverage.map((s) => s.count),
    [1, 0, 0],
  );
});

test("a season with no set says whether its show was ever identified", () => {
  const stats = computeShowStats([
    show([episode({ path: "/a" })], { key: "a", tmdb: named(1) }),
    show([episode({ path: "/b" })], { key: "b", title: "B" }),
  ]);

  assert.deepEqual(stats.discReasons, [
    { label: "Identified, no set found", count: 1 },
    { label: "Show not identified yet", count: 1 },
  ]);
});

test("only a high-confidence show counts as identified", () => {
  const stats = computeShowStats([
    show([episode({ path: "/a" })], { key: "a", tmdb: named(1) }),
    show([episode({ path: "/b" })], { key: "b", tmdb: named(2, "low") }),
    show([episode({ path: "/c" })], { key: "c" }),
  ]);

  assert.deepEqual(stats.matchCoverage, [
    { label: "Matched", count: 1 },
    { label: "Needs review", count: 1 },
    { label: "Not identified", count: 1 },
  ]);
});

test("a run that changes resolution partway through is mixed", () => {
  const stats = computeShowStats([
    show([
      episode({ path: "/a", resolution: "2160p", hdr: "SDR" }),
      episode({ path: "/b", resolution: "1080p", hdr: "SDR" }),
    ]),
  ]);

  assert.deepEqual(stats.mixed, [
    { label: "Resolution", count: 1 },
    { label: "Dynamic range", count: 0 },
    { label: "Release type", count: 0 },
  ]);
});

test("a show of one episode cannot disagree with itself", () => {
  // Counting it as consistent is how a library of pilots reports itself
  // immaculate — it agrees by arithmetic rather than by anyone's doing.
  const stats = computeShowStats([
    show([episode({ path: "/a", resolution: "2160p" })]),
  ]);

  assert.deepEqual(
    stats.mixed.map((m) => m.count),
    [0, 0, 0],
  );
});

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

test("both tabs count open issues the same way", () => {
  // The bug this pins: one tab counted problems and the other counted files
  // holding them, under one label. The figure is issues; the files ride along.
  const two = [issue("fake-4k", "critical"), issue("low-bitrate", "warning")];

  const films = computeStats([
    film({ path: "/a", issues: two }),
    film({ path: "/b", issues: [] }),
  ]);
  const shows = computeShowStats([
    show([
      episode({ path: "/a", issues: two }),
      episode({ path: "/b", issues: [] }),
    ]),
  ]);

  assert.equal(films.totals.openIssues, 2);
  assert.equal(films.totals.withIssues, 1);
  assert.equal(shows.totals.openIssues, films.totals.openIssues);
  assert.equal(shows.totals.withIssues, films.totals.withIssues);
});

test("a biggest list holds the top rows by either measure", () => {
  // The switch on the card is only honest if both answers are in the data: a
  // short show on a lot of disk is exactly what "By storage" is for, and a list
  // cut to the eight longest would never have held it.
  const shows = Array.from({ length: 9 }, (_, i) =>
    show([episode({ path: `/${i}`, sizeBytes: 1e9 })], {
      key: `k${i}`,
      title: `Long ${i}`,
      episodeCount: 10 + i,
      sizeBytes: 1e9,
    }),
  );
  const whale = show([episode({ path: "/w", sizeBytes: 500e9 })], {
    key: "w",
    title: "Whale",
    episodeCount: 1,
    sizeBytes: 500e9,
  });

  const stats = computeShowStats([...shows, whale]);
  const labels = stats.biggest.map((s) => s.label);

  assert.ok(labels.includes("Whale"));
  assert.ok(labels.includes("Long 8"));
});
