import type { LibraryItem } from "./library";
import type { Show } from "./shows";
import { classifyEnhancementLayer, openIssues, type Status } from "./derive";

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
   * How much of the library has a disc to be judged against — and for the rest,
   * which step it stalled at, since "no disc exists" and "we never identified
   * the film" are different problems with different fixes.
   */
  discCoverage: { label: string; count: number }[];
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
        (m, season) => m + (season.total === undefined ? 0 : season.missing.length),
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
    hdr: tally(episodes, ["Dolby Vision", "HDR10+", "HDR10", "SDR"], (e) => e.hdr),
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

export function computeStats(items: LibraryItem[]): LibraryStats {
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

  const discCoverage = [
    {
      label: "Compared to a disc",
      count: compared.length,
    },
    {
      label: "Identified, no disc found",
      count: uncomparedItems.filter((m) => m.tmdb?.id).length,
    },
    {
      label: "Not identified yet",
      count: uncomparedItems.filter((m) => !m.tmdb?.id).length,
    },
  ];

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
    discCoverage,
    decades,
    resolution,
    hdr,
    release,
    dolbyVision,
    collections,
  };
}
