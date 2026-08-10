import "server-only";

import { titleKey } from "./derive";

/**
 * Blu-ray.com lookup — the disc side of "is this the best version I can own?".
 *
 * There is no API, so this parses the public pages. Two consequences worth
 * keeping in mind:
 *
 *  - It is scraping, so it will break when they change their markup. Every
 *    parse failure is recorded rather than thrown, and the raw specs are cached
 *    so a broken parser never costs a re-fetch.
 *  - Pages are ~600 KB. Requests are serialised with a delay between them, and
 *    a film is only ever looked up once unless you ask for a refresh.
 */

const BASE = "https://www.blu-ray.com";

// A real browser string: the site serves a different page to unknown agents.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

/** Deliberately unhurried — this is someone else's server. */
const REQUEST_GAP_MS = 1500;
let lastRequest = 0;

async function fetchPage(url: string): Promise<string> {
  const wait = lastRequest + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();

  // The site returns a 111-byte "noindex, nofollow" stub unless the request
  // looks like a browser — a full Accept header is what actually decides it.
  const response = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Blu-ray.com ${response.status} on ${url}`);
  return response.text();
}

/** The same, for the one endpoint here that answers to a form post. */
async function postPage(
  url: string,
  fields: Record<string, string>,
): Promise<string> {
  const wait = lastRequest + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "*/*",
      "Accept-Language": "en-GB,en;q=0.9",
      Referer: `${BASE}/search/`,
    },
    body: new URLSearchParams(fields),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Blu-ray.com ${response.status} on ${url}`);
  return response.text();
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type Candidate = {
  id: string;
  url: string;
  title: string;
  year?: number;
  format: "4K" | "3D" | "BD";
  /*
   * What tells two releases of the same film apart. Blu-ray.com lists a dozen
   * editions of a popular title, every one of them called "300 (2007)" — the
   * packaging, the country and the date on it are the only things that say
   * which is which, so they travel with the candidate rather than being read
   * off the page after you have already had to choose.
   */
  edition?: string;
  country?: string;
  released?: string;
  cover: string;
};

/** Every release's cover lives at a predictable address, keyed by its id. */
const coverUrl = (id: string) =>
  `https://images.static-bluray.com/movies/covers/${id}_medium.jpg`;

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

function parseSearch(html: string): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];

  const pattern =
    /href="(https:\/\/www\.blu-ray\.com\/movies\/[^"]+?\/(\d+)\/)"[^>]*title="([^"]+)"/g;

  for (const m of html.matchAll(pattern)) {
    const [, url, id, rawTitle] = m;
    if (seen.has(id)) continue;
    seen.add(id);

    const title = decode(rawTitle);
    const year = title.match(/\((\d{4})\)/)?.[1];

    out.push({
      id,
      url,
      title,
      year: year ? Number(year) : undefined,
      format: url.includes("-4K-Blu-ray/")
        ? "4K"
        : url.includes("-3D-Blu-ray/")
          ? "3D"
          : "BD",
      cover: coverUrl(id),
    });
  }

  return out;
}

/*
 * The type-ahead behind the search box, which is a different answer to the same
 * question: the grid of covers names every release "300 (2007)", while this
 * endpoint names it "300 (Best Buy Exclusive) (SteelBook)" and says where and
 * when it came out. It is a POST, it returns a fragment of HTML with the facts
 * spread across parallel JavaScript arrays, and it truncates long titles — so
 * it is used to describe the releases the grid found rather than to find them.
 */
type Detail = { edition?: string; country?: string; released?: string };

/** `var name = new Array('a', 'b');` — the shape every list in the reply takes. */
function jsArray(html: string, name: string): string[] {
  const m = html.match(new RegExp(`var ${name} = new Array\\(([^)]*)\\)`));
  return m
    ? [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((q) =>
        decode(q[1].replace(/\\'/g, "'")),
      )
    : [];
}

/**
 * The parenthesised qualifiers on a release title — "(SteelBook)", "(Best Buy
 * Exclusive)" — which is the edition, stated the way the shop states it. The
 * year is dropped: it belongs to the film, not to this pressing of it.
 */
function editionOf(title: string): string | undefined {
  const parts = [...title.matchAll(/\(([^)]+)\)/g)]
    .map((m) => m[1].trim())
    .filter((part) => !/^\d{4}(?:-\d{4})?$/.test(part));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

async function quickDetails(keyword: string): Promise<Map<string, Detail>> {
  const found = new Map<string, Detail>();

  let html: string;
  try {
    html = await postPage(`${BASE}/search/quicksearch.php`, {
      section: "bluraymovies",
      userid: "-1",
      country: "all",
      keyword,
    });
  } catch {
    // Describing the releases is worth a request but not worth a failure: the
    // list is still usable without it.
    return found;
  }

  const urls = jsArray(html, "urls");
  const countries = jsArray(html, "countrycodes");

  // The rows carry the title and the date; everything else is by position.
  const rows = [
    ...html.matchAll(
      /id="match(\d+)"[^>]*>(?:<span[^>]*>([^<]*)<\/span>)?[\s\S]*?&nbsp;([^<]*)</g,
    ),
  ];

  for (const [, index, released, rawTitle] of rows) {
    const at = Number(index);
    const id = urls[at]?.match(/\/(\d+)\/?$/)?.[1];
    if (!id) continue;

    // Long titles come back cut off at a fixed width; a half-written edition is
    // worse than none, so the truncated tail is dropped.
    const title = decode(rawTitle).replace(/…$/, "");
    found.set(id, {
      edition: rawTitle.includes("&hellip;") ? undefined : editionOf(title),
      country: countries[at] || undefined,
      released: released?.trim() || undefined,
    });
  }

  return found;
}

/** Strips the format suffix Blu-ray.com appends before comparing titles. */
const cleanTitle = (t: string) =>
  t
    .replace(/\((\d{4})\)/, "")
    .replace(/\b(4K|3D)\b/g, "")
    .trim();

export async function searchReleases(
  title: string,
  year?: number,
): Promise<Candidate[]> {
  const url =
    `${BASE}/search/?quicksearch=1&quicksearch_country=all` +
    `&quicksearch_keyword=${encodeURIComponent(title)}&section=bluraymovies`;

  const all = parseSearch(await fetchPage(url));
  const wanted = titleKey(title);

  const mine = all.filter((c) => {
    if (titleKey(cleanTitle(c.title)) !== wanted) return false;
    // Remakes share a title, so the year is what separates them.
    if (year && c.year && Math.abs(c.year - year) > 1) return false;
    return true;
  });

  return describe(mine, title);
}

/**
 * Says which release is which. Costs one more request, so it is only made when
 * there is a choice to be told apart — a single result needs no distinguishing,
 * and the automatic lookup takes the first 4K release either way.
 */
async function describe(
  candidates: Candidate[],
  keyword: string,
): Promise<Candidate[]> {
  if (candidates.length < 2) return candidates;

  const details = await quickDetails(keyword);
  return candidates.map((c) => ({ ...c, ...details.get(c.id) }));
}

// ---------------------------------------------------------------------------
// Seasons
//
// A series is not released as a series: it is released a season at a time, and
// the season is the thing a set can be compared against. Blu-ray.com files
// those sets among the films, titled "Show: The Complete Third Season", so
// finding one is a matter of reading the season out of the title.
// ---------------------------------------------------------------------------

const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth",
];

const CARDINALS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** The season a release title names, if it names one at all. */
export function seasonOf(title: string): number | undefined {
  const t = title.toLowerCase();

  // "Season 3", "Series 3", "Volume 3" — the digit form, and the commonest.
  const digits = t.match(
    /\b(?:season|series|s[ée]rie|volume|vol)\.?\s*(\d{1,2})\b/,
  );
  if (digits) return Number(digits[1]);

  // "The Complete Third Season", "Season Three".
  const ordinal = ORDINALS.findIndex((word) =>
    new RegExp(`\\b${word}\\s+(?:season|series)\\b`).test(t),
  );
  if (ordinal !== -1) return ordinal + 1;

  const cardinal = CARDINALS.findIndex((word) =>
    new RegExp(`\\b(?:season|series)\\s+${word}\\b`).test(t),
  );
  if (cardinal !== -1) return cardinal + 1;

  return undefined;
}

/** A set that covers the whole show, which for a one-season show is the show. */
const coversEverything = (title: string) =>
  /\bcomplete\s+(?:series|collection)\b|\blimited\s+series\b|\bmini[-\s]?series\b/i.test(
    title,
  );

/** The show's own name, with what a shop adds to it taken off. */
const stripSeason = (title: string) =>
  cleanTitle(title)
    .replace(/:?\s*the\s+complete\s+.*$/i, "")
    .replace(/:?\s*(?:season|series|volume|vol)\.?\s*\d{1,2}.*$/i, "")
    .replace(
      /:?\s*(?:an?\s+)?(?:hbo\s+)?(?:limited\s+series|mini[-\s]?series).*$/i,
      "",
    )
    .replace(/[:\-–]\s*$/, "")
    .trim();

/**
 * Candidate sets for one season of one show.
 *
 * Two things have to be true: the release is of this show, and it is of this
 * season. A set that names no season at all counts only when it covers the
 * whole show — "Chernobyl" is a complete miniseries, and rejecting it because
 * the box does not say "Season 1" would leave every miniseries unmatched.
 */
export async function searchSeasonReleases(
  show: string,
  season: number,
  year?: number,
): Promise<Candidate[]> {
  const url =
    `${BASE}/search/?quicksearch=1&quicksearch_country=all` +
    `&quicksearch_keyword=${encodeURIComponent(show)}&section=bluraymovies`;

  const all = parseSearch(await fetchPage(url));
  const wanted = titleKey(show);

  const mine = all.filter((c) => {
    if (titleKey(stripSeason(c.title)) !== wanted) return false;

    const named = seasonOf(c.title);
    if (named !== undefined) return named === season;

    // Unnamed: a complete set is this season only if the show is that short,
    // and anything else with a bare title is the film of the same name far
    // more often than it is the series.
    if (!coversEverything(c.title)) return false;
    return season === 1 || year === undefined || c.year === undefined
      ? season === 1
      : Math.abs(c.year - year) <= 1;
  });

  return describe(mine, show);
}

/**
 * The best set for one season: the 4K edition where one exists, the standard
 * Blu-ray otherwise. Only the chosen release is fetched.
 */
export async function lookupSeasonDisc(
  show: string,
  season: number,
  year?: number,
): Promise<DiscLookup> {
  try {
    const candidates = await searchSeasonReleases(show, season, year);
    if (candidates.length === 0) {
      return { uhdExists: false, releaseCount: 0, error: "No release found" };
    }

    const uhd = candidates.filter((c) => c.format === "4K");
    const chosen = uhd[0] ?? candidates.find((c) => c.format === "BD");
    if (!chosen) {
      return {
        uhdExists: false,
        releaseCount: candidates.length,
        error: "Only 3D editions found",
      };
    }

    return {
      uhdExists: uhd.length > 0,
      releaseCount: candidates.length,
      best: parseRelease(await fetchPage(chosen.url), chosen),
    };
  } catch (err) {
    return {
      uhdExists: false,
      releaseCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Release page
// ---------------------------------------------------------------------------

export type DiscSpec = {
  /** Absent on a ceiling typed in by hand: there is no page behind it. */
  url?: string;
  title: string;
  format: "4K" | "3D" | "BD";
  /**
   * What the best version of this film actually is. Anything scraped from
   * Blu-ray.com is a disc, which is why this is absent there and read as one —
   * but plenty of films were never pressed, and for those the ceiling is the
   * streaming master. A copy cannot fall short of a disc that does not exist.
   */
  source?: "disc" | "web";
  videoCodec?: string;
  videoBitrateMbps?: number;
  resolution?: string;
  /** False when the disc is an upscale rather than a true 4K master. */
  nativeFourK?: boolean;
  hdr: string[];
  aspectRatio?: string;
  audio: string[];
  hasAtmos: boolean;
  hasDtsX: boolean;
  hasLossless: boolean;
};

const text = (html: string) =>
  decode(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** Pulls the run of text following a section heading such as "Video". */
function section(html: string, heading: string, length = 700): string {
  const m = new RegExp(`>\\s*${heading}\\s*<`, "i").exec(html);
  return m ? text(html.slice(m.index + m[0].length, m.index + length)) : "";
}

/**
 * Turns a pasted Blu-ray.com URL into a candidate. The slug carries the format,
 * which is all that is needed before the page itself is fetched.
 */
export function candidateFromUrl(raw: string): Candidate | undefined {
  const m = raw
    .trim()
    .match(/^https?:\/\/(?:www\.)?blu-ray\.com\/movies\/([^/?#]+)\/(\d+)\/?/i);
  if (!m) return undefined;

  const [, slug, id] = m;
  return {
    id,
    url: `${BASE}/movies/${slug}/${id}/`,
    // A placeholder: the real title is read off the page once fetched.
    title: decodeURIComponent(slug).replace(/-/g, " "),
    cover: coverUrl(id),
    format: /-4K-Blu-ray$/i.test(slug)
      ? "4K"
      : /-3D-Blu-ray$/i.test(slug)
        ? "3D"
        : "BD",
  };
}

export function parseRelease(html: string, candidate: Candidate): DiscSpec {
  const video = section(html, "Video");
  const audioBlock = section(html, "Audio", 900);

  const codec = video.match(/Codec:\s*([^(]+?)\s*(?:\(|Resolution)/i)?.[1];
  const bitrate = video.match(/\(([\d.]+)\s*Mbps\)/i)?.[1];
  // Capture up to the next label — "Native 4K (2160p)" begins with a capital,
  // which a [^A-Z] run would refuse to enter.
  const resolution = video.match(
    /Resolution:\s*(.+?)\s*(?:HDR:|Aspect ratio:|Original aspect|Codec:|$)/i,
  )?.[1];
  const aspect = video.match(/Aspect ratio:\s*([\d.]+:1)/i)?.[1];

  const hdr: string[] = [];
  for (const name of ["Dolby Vision", "HDR10+", "HDR10", "HLG"]) {
    // HDR10 is a substring of HDR10+, so only take it when the other is absent.
    if (name === "HDR10" && hdr.includes("HDR10+")) continue;
    if (new RegExp(name.replace("+", "\\+"), "i").test(video)) hdr.push(name);
  }

  // Matching the format names directly is far more robust than trying to split
  // on the "Language:" prefixes — a lazy label pattern happily treats
  // "Atmos English:" as a label and leaves a bare "Dolby" behind.
  const FORMATS =
    /(Dolby Atmos|Dolby TrueHD|Dolby Digital Plus|Dolby Digital|DTS:X|DTS-HD Master Audio|DTS-HD High Resolution|DTS-ES|DTS|LPCM|PCM|Auro-3D)(\s+[\d.]+)?/g;

  const audio = [
    ...new Set(
      [...audioBlock.matchAll(FORMATS)].map((m) =>
        `${m[1]}${m[2] ? m[2] : ""}`.trim(),
      ),
    ),
  ];

  const pageTitle = decode(
    html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "",
  ).trim();

  // Blu-ray.com resolves a URL by its numeric id and ignores the slug, so a
  // pasted link can say "4K-Blu-ray" while serving a 1080p release. Trust what
  // the page actually reports over what the URL claims.
  const format: Candidate["format"] = /4K|2160p/i.test(resolution ?? "")
    ? "4K"
    : /\b4K\b/i.test(pageTitle)
      ? "4K"
      : /\b3D\b/i.test(pageTitle)
        ? "3D"
        : /1080|720|Blu-ray/i.test(`${resolution} ${pageTitle}`)
          ? "BD"
          : candidate.format;

  return {
    url: candidate.url,
    title: pageTitle || candidate.title,
    format,
    videoCodec: codec?.trim(),
    videoBitrateMbps: bitrate ? Number(bitrate) : undefined,
    resolution: resolution?.trim(),
    nativeFourK: /native\s*4k/i.test(video)
      ? true
      : /upscal/i.test(video)
        ? false
        : undefined,
    hdr,
    aspectRatio: aspect,
    audio,
    hasAtmos: /Dolby Atmos/i.test(audioBlock),
    hasDtsX: /DTS:X/i.test(audioBlock),
    hasLossless: /TrueHD|DTS-HD Master|LPCM|PCM/i.test(audioBlock),
  };
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export type DiscLookup = {
  uhdExists: boolean;
  releaseCount: number;
  best?: DiscSpec;
  error?: string;
  /** You picked this release by hand; automatic runs must leave it alone. */
  manual?: boolean;
  /**
   * Stronger than `manual`: the specs were typed in rather than picked, because
   * the search found nothing to pick. Nothing scores differently for it — it is
   * so the app can say where the ceiling came from, and offer to edit it.
   */
  entered?: boolean;
};

/** Fetches one specific release — used when you choose the edition yourself. */
export async function lookupRelease(
  candidate: Candidate,
  known?: { uhdExists: boolean; releaseCount: number },
): Promise<DiscLookup> {
  try {
    const best = parseRelease(await fetchPage(candidate.url), candidate);
    return {
      // Take it from the parsed release, not the slug, for the same reason.
      uhdExists: known?.uhdExists ?? best.format === "4K",
      releaseCount: known?.releaseCount ?? 1,
      best,
      manual: true,
    };
  } catch (err) {
    return {
      uhdExists: known?.uhdExists ?? false,
      releaseCount: known?.releaseCount ?? 0,
      error: err instanceof Error ? err.message : String(err),
      manual: true,
    };
  }
}

/**
 * Finds the best disc release for a film: a 4K edition where one exists, the
 * standard Blu-ray otherwise. Only the chosen release is fetched — a film can
 * have a dozen editions and each page is ~600 KB.
 */
export async function lookupDisc(
  title: string,
  year?: number,
): Promise<DiscLookup> {
  try {
    const candidates = await searchReleases(title, year);
    if (candidates.length === 0) {
      return { uhdExists: false, releaseCount: 0, error: "No release found" };
    }

    const uhd = candidates.filter((c) => c.format === "4K");
    const chosen = uhd[0] ?? candidates.find((c) => c.format === "BD");
    if (!chosen) {
      return {
        uhdExists: false,
        releaseCount: candidates.length,
        error: "Only 3D editions found",
      };
    }

    const spec = parseRelease(await fetchPage(chosen.url), chosen);
    return {
      uhdExists: uhd.length > 0,
      releaseCount: candidates.length,
      best: spec,
    };
  } catch (err) {
    return {
      uhdExists: false,
      releaseCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
