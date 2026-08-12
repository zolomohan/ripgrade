import type { LibraryItem } from "./library";
import type { Show } from "./shows";
import {
  ISSUE_CATALOGUE,
  classifyEnhancementLayer,
  openIssues,
  type Severity,
  type Status,
} from "./derive";

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
    openIssues: number;
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
 * film. It has no disc to be measured against, it arrives forty at a time, and
 * the question you ask of a show — is it complete, and is it consistent — is
 * not one you can ask of a single file. Sharing one set of totals would bury
 * both answers.
 */
export type ShowStats = {
  totals: {
    shows: number;
    episodes: number;
    bytes: number;
    runtimeHours: number;
    /** Episodes TMDb lists for a season that is otherwise held. */
    missing: number;
    openIssues: number;
    averageScore: number;
  };
  /** Complete against incomplete, which is the point of tracking a show. */
  completeness: { label: string; count: number }[];
  resolution: Slice[];
  hdr: Slice[];
  release: Slice[];
  /** The largest shows, by episodes held. */
  biggest: Slice[];
};

const SHOW_LIMIT = 8;

export function computeShowStats(shows: Show[]): ShowStats {
  const episodes = shows.flatMap((show) =>
    show.seasons.flatMap((season) => season.episodes.map((e) => e.item)),
  );

  // Only where TMDb has told us how long a season runs. Before that, a gap in
  // the numbering is a guess, and counting guesses as absences would report a
  // library as incomplete for the crime of not being identified yet.
  const missing = shows.reduce(
    (n, show) =>
      n +
      show.seasons.reduce(
        (m, season) =>
          m + (season.total === undefined ? 0 : season.missing.length),
        0,
      ),
    0,
  );

  const short = shows.filter((show) =>
    show.seasons.some(
      (season) => season.total !== undefined && season.missing.length > 0,
    ),
  ).length;

  const totals = {
    shows: shows.length,
    episodes: episodes.length,
    bytes: episodes.reduce((n, e) => n + e.sizeBytes, 0),
    runtimeHours: Math.round(
      episodes.reduce((n, e) => n + (e.durationSec ?? 0), 0) / 3600,
    ),
    missing,
    openIssues: episodes.reduce((n, e) => n + openIssues(e).length, 0),
    averageScore: episodes.length
      ? Math.round(
          episodes.reduce((n, e) => n + e.scores.overall, 0) / episodes.length,
        )
      : 0,
  };

  return {
    totals,
    completeness: [
      { label: "Complete", count: shows.length - short },
      { label: "Missing episodes", count: short },
    ],
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
    biggest: shows
      .map((show) => ({
        label: show.title,
        count: show.episodeCount,
        bytes: show.sizeBytes,
      }))
      .sort((a, b) => b.count - a.count || b.bytes - a.bytes)
      .slice(0, SHOW_LIMIT),
  };
}

/** Counts and bytes per key, in a fixed order with empties dropped. */
function tally(
  items: LibraryItem[],
  order: string[],
  keyOf: (m: LibraryItem) => string | undefined,
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

const COLLECTION_LIMIT = 8;

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
    openIssues: items.filter((m) => openIssues(m).length > 0).length,
  };

  // Split by which scale judged the film, since the two do not share an axis.
  const compared = items.filter((m) => m.disc?.discScore);
  const uncomparedItems = items.filter((m) => !m.disc?.discScore);

  const scores = COMPARED_ORDER.map((status) => ({
    status,
    count: compared.filter((m) => m.status === status).length,
  }));

  const uncompared = {
    total: uncomparedItems.length,
    byStatus: ABSOLUTE_ORDER.map((status) => ({
      status,
      count: uncomparedItems.filter((m) => m.status === status).length,
    })).filter((b) => b.count > 0),
  };

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

  const collections = tally(items, [], (m) => m.tmdb?.collection)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, COLLECTION_LIMIT);

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
