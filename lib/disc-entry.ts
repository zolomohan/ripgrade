import type { DiscSpec } from "./bluray";

/**
 * A ceiling typed in by hand.
 *
 * Blu-ray.com does not know about everything. A boutique label, a disc too new
 * or too obscure to be listed, a film released only abroad — the search comes
 * back empty and the copy on the drive is then scored on the rubric alone,
 * which is a different scale from every other film in the library.
 *
 * So the specs can be entered instead. What comes out the other side is an
 * ordinary `DiscSpec`: the scorer, the gap list and the panels cannot tell a
 * typed-in ceiling from a scraped one, and should not — the only difference is
 * that there is no page to link to, and that the app says who said so.
 *
 * Deliberately fewer fields than the scraper produces. These are the ones that
 * change a score; the rest are decoration, and asking for them would make the
 * form look like paperwork.
 */

export const ENTRY_RESOLUTIONS = ["2160p", "1080p", "720p"] as const;
export const ENTRY_HDR = ["SDR", "HDR10", "HDR10+", "Dolby Vision"] as const;
export const ENTRY_SOURCES = ["disc", "web"] as const;

export type EntryResolution = (typeof ENTRY_RESOLUTIONS)[number];
export type EntryHdr = (typeof ENTRY_HDR)[number];
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export type DiscEntry = {
  /** What you are comparing against — a release name, or just the film's. */
  title: string;
  /**
   * Whether a disc of this exists at all. The field that matters most and the
   * only one with no sensible guess behind it: a streaming original has no
   * disc, and calling its master one would hold every copy of it short of a
   * remux that can never be made.
   */
  source: EntrySource;
  resolution: EntryResolution;
  /** The top format the disc carries; the rest is implied. */
  hdr: EntryHdr;
  videoCodec?: string;
  videoBitrateMbps?: number;
  aspectRatio?: string;
  /**
   * One label per track, as a disc lists them: "Dolby TrueHD 7.1". Empty is
   * "unknown", which is a real answer rather than a missing one — a ceiling
   * whose sound nobody has stated holds no copy short on sound.
   */
  audio: string[];
};

/**
 * What to call the best release in one chip's worth of space.
 *
 * A disc is named by the format it was pressed on. A stream was pressed on
 * nothing, so "BD" — which is what its resolution would otherwise map to — is
 * simply untrue, and the 4K worth knowing about rides along with the name.
 */
export function qualityLabel(spec: {
  format: "4K" | "3D" | "BD";
  source?: "disc" | "web";
}): string {
  if (spec.source !== "web") return spec.format;
  return spec.format === "4K" ? "4K WEB-DL" : "WEB-DL";
}

/** The same test the scraper applies to a release's audio block. */
const LOSSLESS = /TrueHD|DTS-HD Master|LPCM|PCM/i;

/** How many tracks are worth keeping — a disc lists a dozen at the outside. */
const MAX_TRACKS = 16;

/**
 * The tracks worth offering, best first.
 *
 * Typed in free-hand, this field was the one that could quietly cost you the
 * score: the rubric reads losslessness and object audio off the track's name,
 * so "TrueHD Atmos" and "Dolby TrueHD 7.1 with Dolby Atmos" are not the same
 * answer to a machine, and only one of them counts the Atmos. Picking from a
 * list means every name is one the scorer recognises.
 *
 * Written the way Blu-ray.com writes them, since those are the names the
 * scraper produces and a hand-entered disc has to sit beside a scraped one.
 * Not a closed set: a release with something odd on it keeps whatever it
 * already has, and the form offers that alongside these.
 */
export const AUDIO_OPTIONS = [
  "Dolby TrueHD 7.1 with Dolby Atmos",
  "Dolby TrueHD 7.1",
  "Dolby TrueHD 5.1",
  "DTS-HD Master Audio 7.1 with DTS:X",
  "DTS-HD Master Audio 7.1",
  "DTS-HD Master Audio 5.1",
  "LPCM 5.1",
  "LPCM 2.0",
  "Dolby Digital Plus 5.1 with Dolby Atmos",
  "Dolby Digital Plus 5.1",
  "Dolby Digital 5.1",
  "Dolby Digital 2.0",
  "AAC 2.0",
] as const;

/**
 * A Dolby Vision or HDR10+ disc carries an HDR10 base layer, and both the
 * scorer and the gap list read the list rather than a single field. Saying so
 * here keeps a typed-in disc shaped exactly like a scraped one.
 */
function hdrLayers(hdr: EntryHdr): string[] {
  switch (hdr) {
    case "SDR":
      return [];
    case "HDR10":
      return ["HDR10"];
    case "HDR10+":
      return ["HDR10", "HDR10+"];
    case "Dolby Vision":
      return ["HDR10", "Dolby Vision"];
  }
}

/**
 * The tracks to offer for a release, which is the catalogue plus whatever this
 * one already carries — a scraped disc's "Auro-3D 11.1" is not on the list, and
 * opening the form on it should not be how you lose it.
 */
export function audioChoices(current: string[]): string[] {
  return [...AUDIO_OPTIONS, ...current.filter((t) => !isCatalogued(t))];
}

const isCatalogued = (track: string): boolean =>
  (AUDIO_OPTIONS as readonly string[]).includes(track);

export function specFromEntry(entry: DiscEntry): DiscSpec {
  const audio = entry.audio.map((track) => track.trim()).filter(Boolean);

  return {
    // No `url`: there is no page behind this one, which is also how the panels
    // know to print the title rather than link it.
    title: entry.title.trim() || "Entered by hand",
    source: entry.source,
    format: entry.resolution === "2160p" ? "4K" : "BD",
    videoCodec: entry.videoCodec?.trim() || undefined,
    videoBitrateMbps:
      entry.videoBitrateMbps && entry.videoBitrateMbps > 0
        ? entry.videoBitrateMbps
        : undefined,
    resolution: entry.resolution,
    hdr: hdrLayers(entry.hdr),
    aspectRatio: entry.aspectRatio?.trim() || undefined,
    audio,
    hasAtmos: audio.some((track) => /atmos/i.test(track)),
    // Looser than the scraper's, which only ever sees Blu-ray.com's own
    // "DTS:X" — someone typing the name is as likely to write DTS-X or DTSX.
    hasDtsX: audio.some((track) => /DTS[-:\s]?X/i.test(track)),
    hasLossless: audio.some((track) => LOSSLESS.test(track)),
  };
}

/**
 * The way back, so the form opens on what is already there rather than on
 * blanks. A scraped release reads back too — correcting one field of a disc the
 * scraper got half right beats retyping all of it.
 */
export function entryFromSpec(spec: DiscSpec): DiscEntry {
  const resolution: EntryResolution =
    spec.format === "4K" || /2160|4K/i.test(spec.resolution ?? "")
      ? "2160p"
      : /720/.test(spec.resolution ?? "")
        ? "720p"
        : "1080p";

  const hdr: EntryHdr = spec.hdr.includes("Dolby Vision")
    ? "Dolby Vision"
    : spec.hdr.includes("HDR10+")
      ? "HDR10+"
      : spec.hdr.includes("HDR10")
        ? "HDR10"
        : "SDR";

  return {
    title: spec.title,
    // Anything scraped is a disc, which is why the scraper never says so.
    source: spec.source ?? "disc",
    resolution,
    hdr,
    videoCodec: spec.videoCodec,
    videoBitrateMbps: spec.videoBitrateMbps,
    aspectRatio: spec.aspectRatio,
    audio: spec.audio,
  };
}

/**
 * What arrives from the browser is whatever the browser felt like sending — a
 * server action is a public endpoint. Everything is checked and clamped here so
 * that nothing downstream has to wonder.
 */
export function readEntry(raw: unknown): DiscEntry | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;

  const string = (key: string) =>
    typeof value[key] === "string"
      ? (value[key] as string).trim().slice(0, 200) || undefined
      : undefined;

  const resolution = ENTRY_RESOLUTIONS.find((r) => r === value.resolution);
  const hdr = ENTRY_HDR.find((h) => h === value.hdr);
  if (!resolution || !hdr) return undefined;

  // The one field that falls back rather than refusing: a form written before
  // this existed sends nothing, and a disc is what it used to mean.
  const source = ENTRY_SOURCES.find((s) => s === value.source) ?? "disc";

  const bitrate = Number(value.videoBitrateMbps);

  return {
    title: string("title") ?? "",
    source,
    resolution,
    hdr,
    videoCodec: string("videoCodec"),
    videoBitrateMbps:
      Number.isFinite(bitrate) && bitrate > 0
        ? Math.round(Math.min(bitrate, 1000) * 10) / 10
        : undefined,
    aspectRatio: string("aspectRatio"),
    audio: Array.isArray(value.audio)
      ? value.audio
          .filter((track): track is string => typeof track === "string")
          .map((track) => track.trim().slice(0, 100))
          .filter(Boolean)
          .slice(0, MAX_TRACKS)
      : [],
  };
}
