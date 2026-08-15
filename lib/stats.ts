import type { LibraryItem } from "./library";
import type { Show } from "./shows";
import {
  ISSUE_CATALOGUE,
  classifyEnhancementLayer,
  openIssues,
  type Severity,
  type Status,
} from "./derive";
import {
  SHOW_VERDICT_ORDER,
  episodesOf,
  shared,
  showGaps,
  showVerdict,
} from "./show-verdict";

/**
 * There are two scales here, not one ladder.
 *
 * A film with a disc to compare against is scored against that disc, and can
 * only land on these four. A film without one is scored on the absolute rubric,
 * and can only land on `Reference`/`Excellent`/`Good`/… — never on
 * `Best Available`, because with nothing to compare against the app cannot
 * claim anything is the best available.
 *
 * So `Reference` is not a lesser `Best Available`; it is the top of the other
 * scale, and the two can never describe the same film. Putting all six on one
 * axis implied a ranking the engine never makes.
 */
const COMPARED_ORDER: Status[] = [
  "Must Upgrade",
  "Upgrade Recommended",
  "Good",
  "Best Available",
];

const ABSOLUTE_ORDER: Status[] = [
  "Must Upgrade",
  "Upgrade Recommended",
  "Good",
  "Excellent",
  "Reference",
];

/**
 * Open issues, and the files holding them.
 *
 * Both numbers, because "Open issues" has two honest readings and the two tabs
 * had quietly picked one each: the films counted films with at least one
 * problem, television counted problems. Same label, same row, same typeface,
 * different question — so flipping the switch changed what the figure meant
 * without saying so.
 *
 * The label names issues, so the figure is issues. What the other reading was
 * worth is not lost: it rides along as `withIssues` and the tile says it on
 * hover, which is more than either tab said before.
 */
function issueTotals(items: LibraryItem[]) {
  let issues = 0;
  let withIssues = 0;

  for (const item of items) {
    const open = openIssues(item).length;
    if (!open) continue;
    issues += open;
    withIssues += 1;
  }

  return { issues, withIssues };
}

/**
 * The two scales above, applied to a set of files: what had a disc to be
 * measured against, ranked worst to best, and what did not, counted apart.
 *
 * Shared by the films and the episodes because it is the same question of the
 * same field. A season set is a disc like any other — `deriveAll` hands an
 * episode the release its season came out as, and `derive` compares it exactly
 * the way it compares a film — so the only thing that ever made this a
 * film-only chart was that nobody had drawn it for television.
 */
function verdictsOf(items: LibraryItem[]) {
  const compared = items.filter((m) => m.disc?.discScore);
  const uncomparedItems = items.filter((m) => !m.disc?.discScore);

  return {
    compared,
    uncomparedItems,
    scores: COMPARED_ORDER.map((status) => ({
      status,
      count: compared.filter((m) => m.status === status).length,
    })),
    uncompared: {
      total: uncomparedItems.length,
      byStatus: ABSOLUTE_ORDER.map((status) => ({
        status,
        count: uncomparedItems.filter((m) => m.status === status).length,
      })).filter((b) => b.count > 0),
    },
  };
}

/**
 * Everything the stats page draws, computed in one pass.
 *
 * Pure, like `derive` — it takes the library it is given and returns numbers,
 * so it can be tested without a database and recomputed on every request
 * without costing anything.
 */
export type Slice = {
  label: string;
  count: number;
  bytes: number;
};

export type LibraryStats = {
  totals: {
    films: number;
    bytes: number;
    runtimeHours: number;
    remux: number;
    dolbyVision: number;
    atmos: number;
    lossless: number;
    /** Issues, not films: one film can hold several. See `issueTotals`. */
    openIssues: number;
    /** Films holding at least one of them. */
    withIssues: number;
  };
  /** Films measured against a disc, worst to best. */
  scores: { status: Status; count: number }[];
  /** Films with no disc to measure against, kept out of that ranking. */
  uncompared: { total: number; byStatus: { status: Status; count: number }[] };
  /**
   * Where each film's ceiling came from: a disc that was found, one that was
   * typed in, or none at all. The three carry different weight — a library
   * measured against pressed discs is measured against something checkable,
   * and one measured against specs somebody remembered is not — so they are
   * counted apart rather than added up into "compared".
   */
  qualityCoverage: { label: string; count: number }[];
  /**
   * How the films with no ceiling break down: identified but no disc found,
   * against never matched at all. Two different problems with two different
   * fixes, and the coverage bar has no room to say so.
   */
  uncomparedReasons: { label: string; count: number }[];
  decades: Slice[];
  resolution: Slice[];
  hdr: Slice[];
  release: Slice[];
  dolbyVision: Slice[];
  collections: Slice[];
};

/**
 * The same library, asked about television.
 *
 * Separate from the films rather than folded in: an episode is not a small
 * film. It arrives forty at a time, and the question you ask of a show — is it
 * complete, and is it consistent — is not one you can ask of a single file.
 * Sharing one set of totals would bury both answers.
 *
 * What is *not* different is how an episode is judged. This said for a while
 * that an episode has no disc to be measured against, and drew no verdicts here
 * on the strength of it — but the scanner looks a season set up per season and
 * `deriveAll` hands it to the episode, so every episode of a season anyone owns
 * on disc has been scored against that disc all along. The census simply was
 * not reporting the one number the whole app is built to produce.
 */
export type ShowStats = {
  totals: {
    shows: number;
    episodes: number;
    bytes: number;
    runtimeHours: number;
    /** Episodes TMDb lists for a season that is otherwise held. */
    missing: number;
    atmos: number;
    lossless: number;
    /** Issues, not episodes: one episode can hold several. See `issueTotals`. */
    openIssues: number;
    /** Episodes holding at least one of them. */
    withIssues: number;
    averageScore: number;
  };
  /** Complete against incomplete, which is the point of tracking a show. */
  completeness: { label: string; count: number }[];
  /**
   * Episodes measured against their season's disc set, worst to best. Per
   * episode rather than per show, like the three charts under it: a verdict is
   * a reading of a file, and a run of forty where two want replacing is a fact
   * about those two.
   */
  scores: { status: Status; count: number }[];
  /** Episodes with no season set to measure against, kept out of that ranking. */
  uncompared: { total: number; byStatus: { status: Status; count: number }[] };
  /**
   * The same verdict asked of whole shows, which is the shelf's own question.
   *
   * Not a second opinion on the episodes but a different subject: `/library`
   * groups the shows tab by exactly these buckets, so a census that could only
   * count episodes was describing a shelf you cannot see. One show, one place —
   * the worst thing true of it, `showVerdict`.
   */
  showVerdicts: { label: string; count: number }[];
  /**
   * Where each season's ceiling came from, the films' quality-comparison card
   * asked of television. This is the card that explains the one above it: a
   * verdict chart with nothing on it is not a library nobody has judged, it is
   * a library nobody owns the discs for, and those are different problems.
   */
  discCoverage: { label: string; count: number }[];
  /** Why a season has no ceiling: no set found, or the show never identified. */
  discReasons: { label: string; count: number }[];
  /** Shows by how well their match is known — the film coverage bar, per show. */
  matchCoverage: { label: string; count: number }[];
  /**
   * Shows whose episodes disagree with each other, per property.
   *
   * The one question that is television's alone: a film cannot change
   * resolution halfway through, and a run that does is a real piece of work —
   * one season ripped from a different source than the rest. The shelf already
   * says "Mixed" of such a show; this counts them.
   */
  mixed: { label: string; count: number }[];
  resolution: Slice[];
  hdr: Slice[];
  release: Slice[];
  /** Shows by the decade they first aired, where TMDb knows the year. */
  decades: Slice[];
  /** The largest shows. Carries bytes as well, so the card can rank either way. */
  biggest: Slice[];
  /** Episodes held at each month's end. See `computeGrowth` on what `addedAt` is. */
  growth: GrowthBucket[];
};

/** How many rows a "biggest" list holds, whichever way it is ranked. */
export const TOP_LIMIT = 8;

/**
 * The top N by count *and* the top N by size, merged.
 *
 * A card the reader can rank two ways cannot be capped one way. Both of these
 * lists were cut to the top eight by one measure and then re-sorted by the
 * other in the view, so "By storage" answered with the largest of the eight
 * longest — a real answer to a question nobody asked, and quietly wrong: the
 * one enormous four-episode run is exactly what that switch is for.
 *
 * Merged rather than doubled: the two lists overlap heavily, and the view cuts
 * to eight again once it knows which measure is showing.
 */
const topEither = (slices: Slice[], limit = TOP_LIMIT): Slice[] => {
  const byCount = [...slices].sort(
    (a, b) => b.count - a.count || b.bytes - a.bytes,
  );
  const byBytes = [...slices].sort(
    (a, b) => b.bytes - a.bytes || b.count - a.count,
  );

  const seen = new Set<string>();
  const merged: Slice[] = [];
  for (const slice of [
    ...byCount.slice(0, limit),
    ...byBytes.slice(0, limit),
  ]) {
    if (seen.has(slice.label)) continue;
    seen.add(slice.label);
    merged.push(slice);
  }
  return merged;
};

export function computeShowStats(
  shows: Show[],
  // The clock arrives as an argument for `computeGrowth`'s reason: a test
  // standing still is the only way to assert on a window of months.
  now = Date.now(),
): ShowStats {
  const episodes = shows.flatMap(episodesOf);

  const missing = shows.reduce((n, show) => n + showGaps(show), 0);

  const short = shows.filter((show) =>
    show.seasons.some(
      (season) => season.total !== undefined && season.missing.length > 0,
    ),
  ).length;

  const issues = issueTotals(episodes);

  const totals = {
    shows: shows.length,
    episodes: episodes.length,
    bytes: episodes.reduce((n, e) => n + e.sizeBytes, 0),
    runtimeHours: Math.round(
      episodes.reduce((n, e) => n + (e.durationSec ?? 0), 0) / 3600,
    ),
    missing,
    atmos: episodes.filter((e) => e.audio.some((a) => a.atmos)).length,
    lossless: episodes.filter((e) => e.audio.some((a) => a.lossless)).length,
    openIssues: issues.issues,
    withIssues: issues.withIssues,
    averageScore: episodes.length
      ? Math.round(
          episodes.reduce((n, e) => n + e.scores.overall, 0) / episodes.length,
        )
      : 0,
  };

  const { scores, uncompared } = verdictsOf(episodes);

  /*
   * The ceilings, counted per season rather than per show or per episode.
   *
   * A season is what Blu-ray.com sells and what `lib/tv-disc.ts` keys on, so it
   * is the unit that either has a release behind it or does not. Counting shows
   * would have to decide what a show with two seasons on disc and three without
   * is, and counting episodes would let one forty-episode season drown out five
   * short ones that nobody has looked up.
   *
   * Seasons holding nothing are skipped — a gap in the numbering is not a
   * season you own and failed to compare.
   */
  const seasons = shows.flatMap((show) =>
    show.seasons
      .filter((season) => season.episodes.length > 0)
      .map((season) => ({ show, season })),
  );

  const found = seasons.filter(
    ({ season }) => season.disc?.best && !season.disc.entered,
  ).length;
  // Typed in by hand, which is a ceiling somebody remembered rather than one
  // anybody can check — the films' card draws the same line for the same
  // reason, and there it needs a side table of ids to know. A season carries
  // the flag on the lookup itself.
  const entered = seasons.filter(({ season }) => season.disc?.entered).length;
  const without = seasons.filter(({ season }) => !season.disc?.best);

  return {
    totals,
    completeness: [
      { label: "Complete", count: shows.length - short },
      { label: "Missing episodes", count: short },
    ],
    scores,
    uncompared,
    showVerdicts: SHOW_VERDICT_ORDER.map((label) => ({
      label,
      count: shows.filter((show) => showVerdict(show) === label).length,
    })),
    discCoverage: [
      { label: "Disc", count: found },
      { label: "Manual", count: entered },
      { label: "None", count: without.length },
    ],
    discReasons: [
      {
        label: "Identified, no set found",
        count: without.filter(({ show }) => show.tmdb?.id).length,
      },
      {
        label: "Show not identified yet",
        count: without.filter(({ show }) => !show.tmdb?.id).length,
      },
    ].filter((r) => r.count > 0),
    matchCoverage: matchCoverage(shows),
    // Only where there is a run to disagree with itself: a show holding one
    // episode is consistent by arithmetic rather than by anyone's doing, and
    // counting it as such is how a library of pilots reports itself immaculate.
    mixed: [
      { label: "Resolution", of: (e: LibraryItem) => e.resolution },
      { label: "Dynamic range", of: (e: LibraryItem) => e.hdr },
      { label: "Release type", of: (e: LibraryItem) => e.releaseType },
    ].map(({ label, of }) => ({
      label,
      count: shows.filter(
        (show) => show.episodeCount > 1 && shared(show, of) === "Mixed",
      ).length,
    })),
    resolution: tally(
      episodes,
      ["2160p", "1080p", "720p", "SD", "unknown"],
      (e) => e.resolution,
    ),
    hdr: tally(
      episodes,
      ["Dolby Vision", "HDR10+", "HDR10", "SDR"],
      (e) => e.hdr,
    ),
    release: tally(
      episodes,
      ["REMUX", "WEB-DL", "ENCODE", "UNKNOWN"],
      (e) => e.releaseType,
    ),
    // The series' own first year, not the season's: a run that started in 1999
    // and ended in 2007 is a nineties show, and splitting it across two columns
    // by season would answer a question nobody asked.
    decades: tally(shows, [], (show) =>
      show.tmdb?.year ? `${Math.floor(show.tmdb.year / 10) * 10}s` : undefined,
    ).sort((a, b) => a.label.localeCompare(b.label)),
    biggest: topEither(
      shows.map((show) => ({
        label: show.title,
        count: show.episodeCount,
        bytes: show.sizeBytes,
      })),
    ),
    growth: computeGrowth(episodes, GROWTH_MONTHS, now),
  };
}

/**
 * Counts and bytes per key, in a fixed order with empties dropped.
 *
 * Generic in the thing being counted rather than fixed to a film: a show has a
 * size and a decade too, and the arithmetic of "how many, how big" does not
 * care which it is handed.
 */
function tally<T extends { sizeBytes: number }>(
  items: T[],
  order: string[],
  keyOf: (m: T) => string | undefined,
): Slice[] {
  const map = new Map<string, Slice>();

  for (const item of items) {
    const key = keyOf(item);
    if (key === undefined) continue;

    const slice = map.get(key) ?? { label: key, count: 0, bytes: 0 };
    slice.count += 1;
    slice.bytes += item.sizeBytes;
    map.set(key, slice);
  }

  const rank = (label: string) => {
    const i = order.indexOf(label);
    return i === -1 ? order.length : i;
  };

  return [...map.values()].sort(
    (a, b) => rank(a.label) - rank(b.label) || b.count - a.count,
  );
}

/**
 * `entered` is the set of TMDb ids whose ceiling was typed in by hand. Passed
 * in rather than read here for the reason at the top of this file: everything
 * in it takes what it is given and returns numbers, so a fixture is enough to
 * test it. An empty set is honest — it says every ceiling was found, which is
 * true of a library nobody has typed one into.
 */
export function computeStats(
  items: LibraryItem[],
  entered: Set<number> = new Set(),
): LibraryStats {
  const issues = issueTotals(items);

  const totals = {
    films: items.length,
    bytes: items.reduce((n, m) => n + m.sizeBytes, 0),
    runtimeHours: Math.round(
      items.reduce((n, m) => n + (m.durationSec ?? 0), 0) / 3600,
    ),
    remux: items.filter((m) => m.releaseType === "REMUX").length,
    dolbyVision: items.filter((m) => m.hdr === "Dolby Vision").length,
    atmos: items.filter((m) => m.audio.some((a) => a.atmos)).length,
    lossless: items.filter((m) => m.audio.some((a) => a.lossless)).length,
    openIssues: issues.issues,
    withIssues: issues.withIssues,
  };

  // Split by which scale judged the film, since the two do not share an axis.
  const { compared, uncomparedItems, scores, uncompared } = verdictsOf(items);

  // A ceiling typed in is still an ordinary spec by the time it is scored, so
  // the film itself carries no trace of where it came from — the set of ids
  // does, and it is the only thing separating these two counts.
  const enteredCount = compared.filter(
    (m) => m.tmdb?.id !== undefined && entered.has(m.tmdb.id),
  ).length;

  const qualityCoverage = [
    {
      label: "Disc",
      count: compared.length - enteredCount,
    },
    {
      label: "Manual",
      count: enteredCount,
    },
    {
      label: "None",
      count: uncomparedItems.length,
    },
  ];

  const uncomparedReasons = [
    {
      label: "Identified, no disc found",
      count: uncomparedItems.filter((m) => m.tmdb?.id).length,
    },
    {
      label: "Not identified yet",
      count: uncomparedItems.filter((m) => !m.tmdb?.id).length,
    },
  ].filter((r) => r.count > 0);

  const decades = tally(items, [], (m) =>
    m.year ? `${Math.floor(m.year / 10) * 10}s` : undefined,
  ).sort((a, b) => a.label.localeCompare(b.label));

  const resolution = tally(
    items,
    ["2160p", "1080p", "720p", "SD", "unknown"],
    (m) => m.resolution,
  );

  const hdr = tally(
    items,
    ["Dolby Vision", "HDR10+", "HDR10", "SDR"],
    (m) => m.hdr,
  );

  const release = tally(
    items,
    ["REMUX", "WEB-DL", "ENCODE", "UNKNOWN"],
    (m) => m.releaseType,
  );

  // Profile 7 splits by what its enhancement layer is doing, since that is the
  // distinction that decides what you can do with those files.
  const dolbyVision = tally(
    items,
    [
      "Profile 7 · complex FEL",
      "Profile 7 · simple FEL",
      "Profile 7 · MEL",
      "Profile 8",
      "Profile 5",
    ],
    (m) => {
      if (m.hdr !== "Dolby Vision" || m.dvProfile === undefined)
        return undefined;
      if (m.dvProfile !== 7) return `Profile ${m.dvProfile}`;

      const el = classifyEnhancementLayer(m.dovi, m.hdr10);
      return el?.kind === "mel"
        ? "Profile 7 · MEL"
        : el?.kind === "complex-fel"
          ? "Profile 7 · complex FEL"
          : el?.kind === "simple-fel"
            ? "Profile 7 · simple FEL"
            : "Profile 7 · unread";
    },
  );

  const collections = topEither(tally(items, [], (m) => m.tmdb?.collection));

  return {
    totals,
    scores,
    uncompared,
    qualityCoverage,
    uncomparedReasons,
    decades,
    resolution,
    hdr,
    release,
    dolbyVision,
    collections,
  };
}

/*
 * ---------------------------------------------------------------------------
 * The dashboard's share of the arithmetic.
 *
 * These live here rather than in `lib/dashboard.ts` for the reason stated at
 * the top of this file: they take the library they are given and return
 * numbers, so they can be tested against a handful of fixtures instead of
 * against four hundred real films. What the dashboard needs that they cannot
 * supply — the filesystem, the settings table, the clock — stays there.
 * ---------------------------------------------------------------------------
 */

/**
 * The library's open issues, counted twice over.
 *
 * By severity, because that is the axis you triage on: three criticals matter
 * more than thirty pieces of info, and a bar showing forty-two issues without
 * saying which kind is a number nobody can act on.
 *
 * And by code, because a count of issues is not a list of problems. Twelve
 * `dv-profile-7` files is one afternoon's work; twelve different codes is
 * twelve investigations.
 *
 * Each code arrives under the name the catalogue gives it rather than as the
 * code itself. A chart of the commonest problems is a chart about the library,
 * and `disc-higher-bitrate` turns it into a chart about this app's vocabulary —
 * readable only to someone who has already read `/how-it-works`. The name comes
 * from `ISSUE_CATALOGUE`, so it is not a second naming of the same check; a
 * code with no entry there falls back to itself.
 */
export type IssueTally = {
  /** Issues, not films: one film can hold several. */
  bySeverity: { label: string; count: number }[];
  /** The commonest checks, in words, with the storage they sit on. */
  byCode: Slice[];
  /** Films holding at least one open issue. */
  filmsAffected: number;
  /** Films holding at least one critical, which is the queue-jumping kind. */
  filmsCritical: number;
};

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

const ISSUE_LIMIT = 6;

/** The check in words, or the code itself where the catalogue has no entry. */
const issueName = (code: string): string =>
  code in ISSUE_CATALOGUE
    ? ISSUE_CATALOGUE[code as keyof typeof ISSUE_CATALOGUE].name
    : code;

export function computeIssues(
  items: LibraryItem[],
  limit = ISSUE_LIMIT,
): IssueTally {
  const bySeverity = new Map<Severity, number>();
  const byCode = new Map<string, Slice>();
  let filmsAffected = 0;
  let filmsCritical = 0;

  for (const item of items) {
    const open = openIssues(item);
    if (open.length === 0) continue;

    filmsAffected += 1;
    if (open.some((issue) => issue.severity === "critical")) filmsCritical += 1;

    for (const issue of open) {
      bySeverity.set(issue.severity, (bySeverity.get(issue.severity) ?? 0) + 1);

      const slice = byCode.get(issue.code) ?? {
        label: issueName(issue.code),
        count: 0,
        bytes: 0,
      };
      slice.count += 1;
      slice.bytes += item.sizeBytes;
      byCode.set(issue.code, slice);
    }
  }

  return {
    // Every severity is listed even at zero: the bar is a part of a whole, and
    // a whole that silently drops its empty parts changes shape between two
    // renders of the same library.
    bySeverity: SEVERITY_ORDER.map((severity) => ({
      label: SEVERITY_LABEL[severity],
      count: bySeverity.get(severity) ?? 0,
    })),
    byCode: [...byCode.values()]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, limit),
    filmsAffected,
    filmsCritical,
  };
}

/**
 * How the library grew, month by month.
 *
 * `addedAt` is when this app first saw a file, not when you acquired it — a
 * fresh database would report the whole collection as having arrived on the
 * day it was scanned. That is why the chart carries a hint saying so rather
 * than a title claiming otherwise.
 *
 * It is still an honest cohort: every row written by one derive pass shares
 * the value exactly, so "the month this appeared" is a real bucket even when
 * the first one is the entire back catalogue.
 *
 * Cumulative, because the question is how big the library got, not how busy a
 * particular February was — and a bar chart of monthly additions is mostly
 * zero with two spikes in it.
 */
export type GrowthBucket = {
  label: string;
  /** Files that first appeared in this month. */
  count: number;
  /** Bytes those files account for. */
  bytes: number;
  /** Everything held by the end of this month, back catalogue included. */
  cumulativeBytes: number;
  cumulativeCount: number;
};

const GROWTH_MONTHS = 12;

export function computeGrowth(
  items: LibraryItem[],
  months = GROWTH_MONTHS,
  // The clock arrives as an argument so a test can stand still.
  now = Date.now(),
): GrowthBucket[] {
  if (months <= 0) return [];

  const end = new Date(now);
  // The first day of the month `months - 1` back, so the window ends with the
  // month we are in rather than a month from now.
  const first = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);

  const buckets: GrowthBucket[] = [];
  const starts: number[] = [];
  for (let i = 0; i < months; i++) {
    const date = new Date(first.getFullYear(), first.getMonth() + i, 1);
    starts.push(date.getTime());
    buckets.push({
      label: date.toLocaleDateString("en-GB", { month: "short" }),
      count: 0,
      bytes: 0,
      cumulativeBytes: 0,
      cumulativeCount: 0,
    });
  }

  // Everything older than the window is the floor the first column stands on,
  // not a month that fell off the end.
  let priorBytes = 0;
  let priorCount = 0;

  for (const item of items) {
    const at = item.addedAt;
    if (at === undefined) continue;

    if (at < starts[0]) {
      priorBytes += item.sizeBytes;
      priorCount += 1;
      continue;
    }

    // Later than the last bucket's start means "this month", which is the last
    // bucket — there is no bucket after it to fall into.
    let index = starts.length - 1;
    for (let i = 0; i < starts.length; i++) {
      if (at < starts[i]) {
        index = i - 1;
        break;
      }
    }
    if (index < 0) continue;

    buckets[index].count += 1;
    buckets[index].bytes += item.sizeBytes;
  }

  let runningBytes = priorBytes;
  let runningCount = priorCount;
  for (const bucket of buckets) {
    runningBytes += bucket.bytes;
    runningCount += bucket.count;
    bucket.cumulativeBytes = runningBytes;
    bucket.cumulativeCount = runningCount;
  }

  return buckets;
}

/**
 * How much of the library knows what it is.
 *
 * Three states rather than matched/unmatched, because a low-confidence match is
 * a different problem from no match at all: one needs confirming, the other
 * needs finding. Only `high` is trusted enough to raise runtime issues, so only
 * `high` counts as done here.
 */
export function computeMatchCoverage(
  items: LibraryItem[],
): { label: string; count: number }[] {
  return matchCoverage(items);
}

/**
 * The same three states, of anything that carries a match.
 *
 * A show is one of those things, and it matters more there than on a film: an
 * unidentified film is a film with no poster, while an unidentified show has no
 * season lengths behind it, so it contributes nothing to every missing-episode
 * figure on the page and does so silently.
 */
function matchCoverage(
  items: { tmdb?: { id?: number; confidence?: string } }[],
): { label: string; count: number }[] {
  let confirmed = 0;
  let review = 0;
  let unknown = 0;

  for (const item of items) {
    if (!item.tmdb?.id) unknown += 1;
    else if (item.tmdb.confidence === "high") confirmed += 1;
    else review += 1;
  }

  return [
    { label: "Matched", count: confirmed },
    { label: "Needs review", count: review },
    { label: "Not identified", count: unknown },
  ];
}
