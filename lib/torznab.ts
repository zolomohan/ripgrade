/**
 * The Torznab feed format, parsed.
 *
 * Torznab is RSS 2.0 with one extra namespace: the facts that matter — seeders,
 * size, magnet, info hash — arrive as `<torznab:attr name value>` children
 * rather than as elements. The response is small and rigidly structured, so it
 * is read with regexes rather than by adding an XML dependency, the same trade
 * `bluray.ts` makes against Blu-ray.com's HTML.
 *
 * Kept apart from `jackett.ts`, which is the part that knows an address and a
 * key, because this half is pure and is where the parsing mistakes would live.
 */

export type IndexerResult = {
  /** The release name — the only description of quality an indexer gives. */
  title: string;
  /** Which tracker it came from, as Jackett labels it. */
  indexer?: string;
  sizeBytes?: number;
  seeders?: number;
  leechers?: number;
  publishedAt?: number;
  magnet?: string;
  infoHash?: string;
  /** The indexer's own page for the release, for anything this cannot show. */
  detailsUrl?: string;
  categories: number[];
};

export const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    // Ampersand last, so "&amp;lt;" decodes to "&lt;" and not to a tag.
    .replace(/&amp;/g, "&");

function tagValue(xml: string, name: string): string | undefined {
  const match = xml.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"),
  );
  return match ? decode(match[1]).trim() : undefined;
}

/** `<torznab:attr name="seeders" value="12" />` — where most of the facts live. */
function attrs(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const pattern = /<torznab:attr\s+name="([^"]+)"\s+value="([^"]*)"\s*\/?>/gi;
  for (const m of xml.matchAll(pattern)) {
    out.set(m[1].toLowerCase(), decode(m[2]));
  }
  return out;
}

const digits = (value?: string): number | undefined => {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** A magnet built from an info hash, for indexers that publish only the hash. */
const magnetFor = (infoHash: string, name: string) =>
  `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;

/**
 * The info hash an indexer published only inside its own URLs.
 *
 * Some trackers — TorrentDownload and LimeTorrents among them — send neither
 * `magneturl` nor `infohash`, and offer the download solely as Jackett's `link`.
 * That link cannot be used: it carries the API key, and these results are drawn
 * in a browser. So those releases arrive with nothing to fetch them by and the
 * row renders bare, which reads as "no download exists" rather than "the feed
 * described it differently".
 *
 * But the hash is right there in the details URL, because that is how those
 * sites address a torrent — /520F5BB2…/Inception-2010. Forty hex characters is
 * a v1 info hash and is not plausibly anything else in a path, so reading it
 * back costs nothing and asks no more of the indexer than it already said.
 *
 * Bounded on both sides so a longer hex run — a 64-character v2 hash, which is
 * not a btih and would make a magnet nothing can resolve — cannot match part of
 * itself and be mistaken for one.
 */
const HASH_IN_URL = /(?:^|[^0-9a-f])([0-9a-f]{40})(?:[^0-9a-f]|$)/i;

const hashFromUrls = (urls: (string | undefined)[]): string | undefined => {
  for (const url of urls) {
    const found = url?.match(HASH_IN_URL);
    if (found) return found[1].toLowerCase();
  }
  return undefined;
};

/** The `<error>` element Jackett returns, often alongside a 200. */
export function feedError(xml: string): string | undefined {
  const match = xml.match(/<error\b[^>]*\bdescription="([^"]*)"/i);
  return match ? decode(match[1]) : undefined;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/** One search mode, and which parameters it will actually accept. */
export type SearchMode = { available: boolean; params: string[] };

export type Caps = {
  categories: number[];
  /** Plain `t=search`, which every indexer supports. */
  search: SearchMode;
  /** `t=movie`, which adds imdbid matching where an indexer offers it. */
  movie: SearchMode;
  /** `t=tvsearch`, which adds season and episode numbers. */
  tv: SearchMode;
};

/**
 * What the aggregate feed will accept.
 *
 * This has to be asked rather than assumed. Jackett's `all` indexer refuses a
 * query outright — "all does not support the requested query" — when no
 * configured tracker advertises the mode being asked for, and a great many
 * public indexers advertise nothing beyond basic search. Reading caps first is
 * the difference between a working search and that error.
 */
export function parseCaps(xml: string): Caps {
  const mode = (name: string): SearchMode => {
    // `<search` cannot match inside `<movie-search`: the character before
    // "search" there is a dash, not the angle bracket this anchors on.
    const match = xml.match(new RegExp(`<${name}\\b([^>]*)/?>`, "i"));
    if (!match) return { available: false, params: [] };

    const attributes = match[1];
    const available = /\bavailable="(yes|true)"/i.test(attributes);
    const params =
      attributes
        .match(/\bsupportedParams="([^"]*)"/i)?.[1]
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean) ?? [];

    return { available, params };
  };

  return {
    // Subcategories are category ids in their own right — 2045 (Movies/UHD) is
    // what a 4K release is actually tagged with — so both are collected.
    categories: [...xml.matchAll(/<(?:category|subcat)\s+id="(\d+)"/gi)]
      .map((m) => Number(m[1]))
      .filter((id) => Number.isFinite(id)),
    search: mode("search"),
    movie: mode("movie-search"),
    tv: mode("tv-search"),
  };
}

export function parseTorznab(xml: string): IndexerResult[] {
  const out: IndexerResult[] = [];

  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const title = tagValue(item, "title");
    if (!title) continue;

    const a = attrs(item);

    // Size is a plain element on most indexers and a torznab attribute on the
    // rest; the enclosure's length is the last resort.
    const enclosure = item.match(/<enclosure[^>]*\blength="(\d+)"/i);
    const sizeBytes =
      digits(tagValue(item, "size")) ??
      digits(a.get("size")) ??
      digits(enclosure?.[1]);

    // Both of these describe the release's own page, and both are read twice:
    // once for the link the UI offers, once for a hash the feed omitted.
    const pageUrls = [tagValue(item, "comments"), tagValue(item, "guid")];

    const infoHash = a.get("infohash")?.toLowerCase() ?? hashFromUrls(pageUrls);
    const magnet =
      a.get("magneturl") ?? (infoHash ? magnetFor(infoHash, title) : undefined);

    const seeders = digits(a.get("seeders"));
    const peers = digits(a.get("peers"));

    const published = tagValue(item, "pubDate");
    const publishedAt = published ? Date.parse(published) : undefined;

    out.push({
      title,
      indexer: tagValue(item, "jackettindexer"),
      sizeBytes,
      seeders,
      // Torznab reports total peers, of which seeders are a subset.
      leechers:
        digits(a.get("leechers")) ??
        (peers !== undefined && seeders !== undefined
          ? Math.max(0, peers - seeders)
          : undefined),
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined,
      magnet,
      infoHash,
      // `guid` is a URL on most indexers and an opaque id on some, so it is
      // only worth offering as a link when it actually looks like one.
      detailsUrl: pageUrls.find(
        (value) => value && /^https?:\/\//i.test(value),
      ),
      categories: (a.get("category")?.split(",") ?? [])
        .map((c) => Number(c.trim()))
        .filter((c) => Number.isFinite(c)),
    });
  }

  return out;
}
