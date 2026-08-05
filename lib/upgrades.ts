import "server-only";

import { relativeToDisc, scoreDisc, titleKey } from "./derive";
import type { DiscLookup } from "./disc";
import { searchIndexers, type IndexerResult } from "./jackett";
import { guessFromTitle, type ReleaseGuess } from "./release-title";

/**
 * "Is there a better copy of this than the one I have?"
 *
 * Joins the indexer search to the rubric: every result is read as a release
 * name, scored on the same scale as the library, and ranked by how far above
 * the copy on the drive it claims to be. The claim is the important word — see
 * `release-title.ts` for what a predicted score is and is not worth.
 */

/**
 * How far short of the disc a release may fall and still count as a near miss.
 *
 * Set from where the scale actually breaks rather than picked round. Losing one
 * dimension while staying on the same tier — Dolby Vision down to HDR10, or
 * Atmos down to plain TrueHD — costs somewhere between 3 and 18 points. Dropping
 * a resolution tier costs closer to 30, because the resolution, the dynamic
 * range and the video ceiling all give at once. Twenty sits in the gap, so amber
 * means "the same calibre of release, one thing weaker" and red means "a step
 * down from the disc" — which is the distinction actually worth acting on.
 */
export const CLOSE_ENOUGH = 20;

/**
 * How a release stands against whatever it is being measured against — the one
 * thing the ring's colour is there to say.
 *
 * Three levels rather than a signed number because what counts as good depends
 * on the reference. Against the copy you hold, beating it is the win and
 * matching it is merely neutral. Against a disc, matching it *is* the win —
 * nothing can beat a disc — so the same nil difference has to read differently.
 * Resolving that here keeps the rule in one place instead of leaving the UI to
 * infer it from a delta and a kind.
 */
export type Standing = "good" | "fair" | "poor" | "unknown";

function standingOf(
  delta: number | undefined,
  reference?: Reference,
): Standing {
  if (delta === undefined || !reference) return "unknown";

  if (reference.kind === "copy") {
    return delta > 0 ? "good" : delta === 0 ? "fair" : "poor";
  }

  // Against the disc: parity is as good as it gets.
  if (delta >= 0) return "good";
  return delta >= -CLOSE_ENOUGH ? "fair" : "poor";
}

/** The disc a search was scored against, for the modal to show as its yardstick. */
export type DiscSummary = {
  title: string;
  url: string;
  format: "4K" | "3D" | "BD";
  resolution?: string;
  videoCodec?: string;
  videoBitrateMbps?: number;
  /** False when the disc is an upscale rather than a true 4K master. */
  nativeFourK?: boolean;
  hdr: string[];
  audio: string[];
  releaseCount: number;
  uhdExists: boolean;
};

export type ScoredRelease = IndexerResult & {
  guess: ReleaseGuess;
  /**
   * The score to show: measured against the disc wherever one is known, and
   * against the bare rubric only where none is.
   *
   * This is the number the library itself reports for a film, so the two are
   * directly comparable — which is the entire point of showing it here.
   */
  score: number;
  /** True when `score` is a percentage of the disc rather than a rubric total. */
  relative: boolean;
  /**
   * `score` minus whatever this release is being measured against — the copy
   * you hold, or the disc itself when you hold none. Undefined when there is no
   * reference to compare with, which is a film with neither.
   */
  delta?: number;
  /** Whether this beats, matches or falls short of the reference. */
  standing: Standing;
  /** How many indexers carried the same release name. */
  sources: number;
};

export type UpgradeTarget = {
  kind: "movie" | "tv";
  title: string;
  year?: number;
  /** tt-prefixed. The single biggest improvement to result quality. */
  imdbId?: string;
  season?: number;
  episode?: number;
  /** TMDb's runtime, without which no encode's bitrate can be inferred. */
  runtimeMinutes?: number;
  /** What the copy on the drive scores, when there is one. */
  currentScore?: number;
  /**
   * The best disc release of this film, so results can be scored as a fraction
   * of what is actually purchasable rather than against an abstract ideal.
   */
  disc?: DiscLookup;
};

/**
 * What the results are being held up against.
 *
 * A film you own is measured against your copy: better, worse, or the same as
 * the thing it would replace. A film you do not own has no such copy, so the
 * disc stands in — and since nothing can beat the disc, the best a release can
 * do there is match it.
 */
export type Reference = {
  score: number;
  /** Named for the UI, which has to say what "better" is better than. */
  label: string;
  kind: "copy" | "disc";
};

export type UpgradeSearch = {
  /**
   * The phrase this search amounts to, so a search that finds nothing can be
   * understood — and rewritten: the modal offers it for editing, and an edited
   * phrase comes back through `findUpgrades` as the term itself.
   */
  query: string;
  results: ScoredRelease[];
  /** Results dropped as being for some other film entirely. */
  discarded: number;
  /**
   * Which indexers actually came back with something.
   *
   * Jackett's aggregate feed drops an indexer that failed — a dead tracker, an
   * expired login, a site whose TLS its runtime will not accept — and reports
   * a perfectly ordinary 200 carrying only whatever the rest returned. There is
   * no error channel in Torznab to read, so the honest thing available is to
   * say who answered and let a conspicuous absence speak for itself.
   *
   * Note this cannot separate "failed" from "answered with nothing": an
   * indexer holding no copy of this film is missing from the list too.
   */
  indexers: string[];
  /** What `delta` on each result is measured from, when there is anything. */
  reference?: Reference;
  /** True when the scores are percentages of the disc rather than rubric totals. */
  relative: boolean;
  /** The disc the scores are a fraction of, where one was found. */
  disc?: DiscSummary;
};

/**
 * Whether a result is even about the film that was asked for.
 *
 * Indexers match loosely, and a search for "Heat" comes back carrying half of
 * everything. Compared on the app's own duplicate-detection key, so whatever
 * counts as the same film elsewhere counts as the same film here.
 */
function matchesTarget(guess: ReleaseGuess, target: UpgradeTarget): boolean {
  const found = guess.tags.title;
  if (!found) return false;

  if (
    titleKey(found, guess.tags.year) === titleKey(target.title, target.year)
  ) {
    return true;
  }

  // Titles get punctuated differently everywhere ("Wall-E" / "WALL E"), so a
  // second pass compares them stripped to letters and digits alone.
  const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (bare(found) !== bare(target.title)) return false;

  // Same name, different film: remakes are the reason the year is checked at
  // all. One year of slack covers a festival run crossing a new year.
  if (
    target.year &&
    guess.tags.year &&
    Math.abs(guess.tags.year - target.year) > 1
  ) {
    return false;
  }

  return true;
}

/**
 * Collapses the same release carried by several trackers into one row.
 *
 * Keyed on the release name rather than the info hash: the same release is
 * frequently re-uploaded with a fresh hash, and it is still one thing to
 * choose. The copy with the most seeders wins, since that is the one worth
 * having.
 */
function dedupe(results: ScoredRelease[]): ScoredRelease[] {
  const best = new Map<string, ScoredRelease>();

  for (const result of results) {
    const key = result.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const existing = best.get(key);

    if (!existing) {
      best.set(key, result);
      continue;
    }

    const winner =
      (result.seeders ?? 0) > (existing.seeders ?? 0) ? result : existing;

    best.set(key, {
      ...winner,
      // A magnet from either copy will do, and not every indexer publishes one.
      magnet: winner.magnet ?? existing.magnet ?? result.magnet,
      sources: existing.sources + 1,
    });
  }

  return [...best.values()];
}

export async function findUpgrades(
  target: UpgradeTarget,
  options: { term?: string } = {},
): Promise<UpgradeSearch> {
  // A phrase the caller typed replaces the constructed one wholesale.
  const custom = options.term?.trim() || undefined;

  // The year is sent as part of the term because indexers treat it as one
  // string; it is what separates a remake from the original when there is no
  // IMDb id to go on.
  const term = [
    target.title,
    target.kind === "movie" ? target.year : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  // What the search amounts to as one line of text. For television the season
  // and episode ride alongside the term as parameters, so they are folded back
  // in here — this is the phrase shown for editing, and sending it back as an
  // edited term must reproduce the same search.
  const sxxeyy =
    target.season !== undefined
      ? `S${String(target.season).padStart(2, "0")}${
          target.episode !== undefined
            ? `E${String(target.episode).padStart(2, "0")}`
            : ""
        }`
      : undefined;
  const query = custom ?? [term, sxxeyy].filter(Boolean).join(" ");

  const raw = await searchIndexers(
    custom
      ? // An edited phrase is the whole search: nothing is sent beside it
        // that could quietly override what was typed.
        { term: custom, kind: target.kind }
      : {
          term,
          imdbId: target.imdbId,
          season: target.season,
          episode: target.episode,
          kind: target.kind,
        },
  );

  // Taken from the raw response, before the title filter below: an indexer
  // that answered with results for the wrong film still answered.
  const indexers = [
    ...new Set(raw.map((r) => r.indexer).filter(Boolean) as string[]),
  ].sort();

  // The disc's own sub-scores, which every result is then expressed as a
  // fraction of. Absent for a film with no disc release found, in which case
  // the rubric total stands as it did before.
  // `audio` is renamed at this boundary exactly as `library.ts` renames it:
  // the scraper calls the list `audio`, the rubric calls it `audioTracks`.
  const discParts = target.disc?.best
    ? scoreDisc({ ...target.disc.best, audioTracks: target.disc.best.audio })
    : undefined;
  const relative = Boolean(discParts && discParts.overall > 0);

  // What "better" is better than. Your copy where you have one; otherwise the
  // disc, which a release can equal but never beat.
  const reference: Reference | undefined =
    target.currentScore !== undefined
      ? { score: target.currentScore, label: "your copy", kind: "copy" }
      : relative
        ? { score: 100, label: "the disc", kind: "disc" }
        : undefined;

  let discarded = 0;
  const scored: ScoredRelease[] = [];

  for (const result of raw) {
    const guess = guessFromTitle(result.title, {
      sizeBytes: result.sizeBytes,
      runtimeMinutes: target.runtimeMinutes,
    });

    // A rewritten phrase defines its own relevance — the filter that protects
    // an automatic search from loose indexer matching would here be
    // second-guessing exactly the wording the user changed.
    if (!custom && !matchesTarget(guess, target)) {
      discarded++;
      continue;
    }

    const score =
      discParts && relative
        ? relativeToDisc(guess.scores, discParts)
        : guess.scores.overall;

    const delta = reference ? score - reference.score : undefined;

    scored.push({
      ...result,
      guess,
      score,
      relative,
      delta,
      standing: standingOf(delta, reference),
      sources: 1,
    });
  }

  const results = dedupe(scored).sort(
    (a, b) =>
      b.score - a.score ||
      // Among equals, take the one that will actually finish downloading.
      (b.seeders ?? 0) - (a.seeders ?? 0),
  );

  const best = target.disc?.best;
  const disc: DiscSummary | undefined =
    best && relative
      ? {
          title: best.title,
          url: best.url,
          format: best.format,
          resolution: best.resolution,
          videoCodec: best.videoCodec,
          videoBitrateMbps: best.videoBitrateMbps,
          nativeFourK: best.nativeFourK,
          hdr: best.hdr,
          audio: best.audio,
          releaseCount: target.disc?.releaseCount ?? 0,
          uhdExists: target.disc?.uhdExists ?? false,
        }
      : undefined;

  return { query, results, discarded, indexers, reference, relative, disc };
}

/**
 * A search for whatever you typed.
 *
 * The same pipeline as `findUpgrades` with the two film-shaped parts taken out:
 * nothing is discarded for being "the wrong film" when there is no film, and
 * the scores are the rubric's own rather than a fraction of a disc — there is
 * no disc to be a fraction of, and no copy on the drive to beat.
 */
export async function searchAnything(term: string): Promise<UpgradeSearch> {
  const raw = await searchIndexers({ term, kind: "any" });

  const indexers = [
    ...new Set(raw.map((r) => r.indexer).filter(Boolean) as string[]),
  ].sort();

  const scored: ScoredRelease[] = raw.map((result) => {
    const guess = guessFromTitle(result.title, {
      sizeBytes: result.sizeBytes,
    });
    return {
      ...result,
      guess,
      score: guess.scores.overall,
      relative: false,
      delta: undefined,
      standing: "unknown" as const,
      sources: 1,
    };
  });

  const results = dedupe(scored).sort(
    (a, b) =>
      b.score - a.score || (b.seeders ?? 0) - (a.seeders ?? 0),
  );

  return {
    query: term,
    results,
    discarded: 0,
    indexers,
    reference: undefined,
    relative: false,
    disc: undefined,
  };
}

/**
 * The single best release for a target, or nothing.
 *
 * The sweep over a whole library runs one of these per film and only needs to
 * know whether an improvement exists, so returning one row keeps what crosses
 * back to the browser proportional to the question.
 */
export async function bestUpgrade(
  target: UpgradeTarget,
): Promise<ScoredRelease | undefined> {
  const { results } = await findUpgrades(target);
  return results[0];
}
