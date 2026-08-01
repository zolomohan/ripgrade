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
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
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
};

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
    });
  }

  return out;
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

  return all.filter((c) => {
    if (titleKey(cleanTitle(c.title)) !== wanted) return false;
    // Remakes share a title, so the year is what separates them.
    if (year && c.year && Math.abs(c.year - year) > 1) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Release page
// ---------------------------------------------------------------------------

export type DiscSpec = {
  url: string;
  title: string;
  format: "4K" | "3D" | "BD";
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
  decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Pulls the run of text following a section heading such as "Video". */
function section(html: string, heading: string, length = 700): string {
  const m = new RegExp(`>\\s*${heading}\\s*<`, "i").exec(html);
  return m ? text(html.slice(m.index + m[0].length, m.index + length)) : "";
}

export function parseRelease(
  html: string,
  candidate: Candidate,
): DiscSpec {
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

  return {
    url: candidate.url,
    title: candidate.title,
    format: candidate.format,
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
};

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
