import "server-only";

import { getSetting, setSetting, db } from "./db";
import {
  feedError,
  parseCaps,
  parseTorznab,
  type Caps,
  type IndexerResult,
} from "./torznab";

/**
 * Jackett, over its Torznab endpoint.
 *
 * Jackett is a local proxy: it holds the indexer logins and exposes them all as
 * one RSS feed, so this file talks to one URL on your own machine rather than
 * to anybody's tracker. Everything here is read-only — a search returns names,
 * sizes and links, and the app never fetches a torrent or contacts a peer.
 *
 * Reading the feed itself lives in `torznab.ts`; this is the half that knows
 * an address and a key. One thing worth keeping in mind about that key:
 * Jackett's own `link` on each item embeds it, so that URL is never carried on
 * a result — results are rendered in the browser and the key would go with
 * them. Magnets and info hashes carry no credential, so those are what the UI
 * gets.
 */

const URL_KEY = "jackettUrl";
const KEY_KEY = "jackettApiKey";

/** Aggregate feed across every indexer configured in Jackett itself. */
const ALL_INDEXERS = "all";

/** Torznab's category numbers. Only the two top-level ones are needed. */
export const CATEGORY = { movies: 2000, tv: 5000 } as const;

/**
 * A search can fan out to a dozen trackers, several of which are slow, and
 * Jackett only answers once the last one has. Generous on purpose.
 */
const TIMEOUT_MS = 60_000;

export type JackettConfig = { url: string; apiKey: string };

/**
 * Environment wins over the stored value, so a deployment can pin it, but the
 * settings page is the expected route: the key is per-install and pasting it
 * into a field beats restarting the server.
 */
export function getJackettConfig(): JackettConfig | undefined {
  const url = process.env.JACKETT_URL ?? getSetting(URL_KEY);
  const apiKey = process.env.JACKETT_API_KEY ?? getSetting(KEY_KEY);
  if (!url || !apiKey) return undefined;
  return { url: url.replace(/\/+$/, ""), apiKey };
}

export function hasJackett(): boolean {
  return getJackettConfig() !== undefined;
}

export function setJackettConfig(config: JackettConfig): void {
  setSetting(URL_KEY, config.url.trim().replace(/\/+$/, ""));
  setSetting(KEY_KEY, config.apiKey.trim());
  capsCache = undefined;
}

export function clearJackettConfig(): void {
  db.prepare("DELETE FROM settings WHERE key IN (?, ?)").run(URL_KEY, KEY_KEY);
  capsCache = undefined;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** Re-exported so callers need only one import to search and read results. */
export type { IndexerResult };

export class JackettError extends Error {}

async function torznab(
  params: Record<string, string | undefined>,
): Promise<string> {
  const config = getJackettConfig();
  if (!config) {
    throw new JackettError(
      "Jackett is not set up. Add its URL and API key on the Settings page.",
    );
  }

  const url = new URL(
    `${config.url}/api/v2.0/indexers/${ALL_INDEXERS}/results/torznab/api`,
  );
  url.searchParams.set("apikey", config.apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // The usual failure is that Jackett is not running, and its own message
    // ("fetch failed") does not say that, so the address is repeated back.
    const reason = err instanceof Error ? err.message : String(err);
    throw new JackettError(
      reason.includes("timed out") || reason.includes("abort")
        ? `Jackett did not answer within ${TIMEOUT_MS / 1000}s — a slow indexer, or it is still starting up.`
        : `Could not reach Jackett at ${config.url} — ${reason}`,
    );
  }

  const body = await response.text();

  // Jackett answers 200 with an <error> element as often as it uses a status
  // code, so the body is checked either way.
  const error = feedError(body);
  if (error) throw new JackettError(error);

  if (!response.ok) {
    throw new JackettError(`Jackett returned ${response.status}.`);
  }

  return body;
}

/**
 * Confirms the URL and key work, and counts what Jackett has configured.
 *
 * Worth its own call: an empty result list means "no indexers set up" and "no
 * releases found" equally, and only this can tell the two apart.
 */
export async function testJackett(): Promise<{ categories: number }> {
  const caps = await fetchCaps();
  if (caps.categories.length === 0) {
    throw new JackettError(
      "Jackett answered but reported no categories — check that at least one indexer is added in Jackett.",
    );
  }
  if (!caps.search.available && !caps.movie.available && !caps.tv.available) {
    throw new JackettError(
      "Jackett answered but none of its indexers offer a search mode this can use.",
    );
  }
  // The aggregate feed reports the union of its indexers' categories, so this
  // proves the pipe works; how many trackers sit behind it is Jackett's own UI.
  return { categories: caps.categories.length };
}

/**
 * Capabilities, cached per configuration.
 *
 * Asked once rather than before every search: the answer only changes when an
 * indexer is added or removed in Jackett, and a search that costs two round
 * trips instead of one is a search that feels twice as slow. The cache is
 * dropped whenever the configuration changes, and expires on its own so adding
 * an indexer is picked up without a restart.
 */
const CAPS_TTL_MS = 5 * 60_000;
let capsCache: { key: string; at: number; caps: Caps } | undefined;

async function fetchCaps(): Promise<Caps> {
  const config = getJackettConfig();
  const key = config ? `${config.url}|${config.apiKey}` : "";

  if (
    capsCache &&
    capsCache.key === key &&
    Date.now() - capsCache.at < CAPS_TTL_MS
  ) {
    return capsCache.caps;
  }

  const caps = parseCaps(await torznab({ t: "caps" }));
  capsCache = { key, at: Date.now(), caps };
  return caps;
}

export type SearchQuery = {
  /** Free text. Always sent — it is the one thing every indexer understands. */
  term?: string;
  /** tt-prefixed. Indexers that support it return far better matches. */
  imdbId?: string;
  season?: number;
  episode?: number;
  /** "any" is a plain keyword search: no category, no film, whatever comes back. */
  kind: "movie" | "tv" | "any";
};

/** "Show Name" + S02E05, for indexers with no season and episode parameters. */
function withEpisodeInTerm(query: SearchQuery): string | undefined {
  if (query.season === undefined) return query.term;

  const season = `S${String(query.season).padStart(2, "0")}`;
  const episode =
    query.episode !== undefined
      ? `E${String(query.episode).padStart(2, "0")}`
      : "";

  return [query.term, `${season}${episode}`].filter(Boolean).join(" ");
}

/**
 * One search across every indexer Jackett knows.
 *
 * The mode is chosen from what caps actually advertises. `movie` and `tvsearch`
 * are preferred where available, because they let an indexer match on the IMDb
 * id or on real season and episode numbers rather than on a string — but if no
 * configured tracker offers them, asking anyway earns a flat refusal from the
 * aggregate rather than a fallback. So basic search is used instead, with the
 * episode numbers folded into the term where that is all there is.
 */
export async function searchIndexers(
  query: SearchQuery,
): Promise<IndexerResult[]> {
  const caps = await fetchCaps();

  /*
   * A free search asks for nothing in particular, so it uses the basic mode and
   * sends no category: narrowing to films would hide exactly the things this is
   * for — a boxed set, a soundtrack, a documentary nobody has catalogued.
   */
  if (query.kind === "any") {
    if (!caps.search.available) {
      throw new JackettError(
        "None of the indexers configured in Jackett offer a keyword search.",
      );
    }
    return parseTorznab(await torznab({ t: "search", q: query.term }));
  }

  const wanted = query.kind === "tv" ? caps.tv : caps.movie;

  const params: Record<string, string | undefined> = {
    cat: String(query.kind === "tv" ? CATEGORY.tv : CATEGORY.movies),
  };

  if (wanted.available) {
    params.t = query.kind === "tv" ? "tvsearch" : "movie";
    params.q = query.term;

    // Each of these is sent only where the mode claims to accept it: an
    // unsupported parameter is refused just as firmly as an unsupported mode.
    if (query.imdbId && wanted.params.includes("imdbid")) {
      params.imdbid = query.imdbId;
    }
    if (query.season !== undefined && wanted.params.includes("season")) {
      params.season = String(query.season);
    }
    if (query.episode !== undefined && wanted.params.includes("ep")) {
      params.ep = String(query.episode);
    }

    // A tv-search that cannot take a season number is no better than basic
    // search, and worse if it drops the numbers on the floor.
    if (query.kind === "tv" && !wanted.params.includes("season")) {
      params.q = withEpisodeInTerm(query);
    }
  } else if (caps.search.available) {
    params.t = "search";
    params.q = withEpisodeInTerm(query);
  } else {
    throw new JackettError(
      "None of the indexers configured in Jackett offer a usable search mode.",
    );
  }

  return parseTorznab(await torznab(params));
}
