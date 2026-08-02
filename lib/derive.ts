/**
 * Pure derivation: MediaInfo JSON in, audit verdict out.
 *
 * Nothing here touches the disk or the database, so the whole library can be
 * re-derived in milliseconds after any change to the heuristics below.
 */

// ---------------------------------------------------------------------------
// Tuning. Edit these rather than the logic.
// ---------------------------------------------------------------------------

export const WEIGHTS = { video: 0.45, audio: 0.3, release: 0.25 };

/** Points awarded by `scoreVideo`. Rendered verbatim on the How it works page. */
export const VIDEO_POINTS = {
  resolution: { "2160p": 60, "1080p": 40, "720p": 22, SD: 10, unknown: 10 },
  hdr: { "Dolby Vision": 22, "HDR10+": 20, HDR10: 15, SDR: 0 },
  tenBit: 4,
  remux: 14,
  bppExcellent: 14,
  bppGood: 10,
  bppFair: 5,
} as const;

/** Points awarded by `scoreAudio`, judged on the single best track. */
export const AUDIO_POINTS = {
  lossless: 65,
  lossy: 35,
  objectAudio: 25,
  channels8: 10,
  channels6: 6,
} as const;

/** Fixed scores per release type, with encodes graded by bitrate density. */
export const RELEASE_POINTS = {
  REMUX: 100,
  WEBDL: 72,
  UNKNOWN: 45,
  encodeNoBpp: 55,
  encodeExcellent: 75,
  encodeGood: 62,
  encodeFair: 48,
  encodePoor: 30,
} as const;

/** Overall score bands, checked high to low. */
export const STATUS_BANDS: {
  min: number;
  status: Status;
  priority: Priority;
}[] = [
  { min: 90, status: "Reference", priority: "None" },
  { min: 78, status: "Excellent", priority: "None" },
  { min: 62, status: "Good", priority: "Low" },
  { min: 45, status: "Upgrade Recommended", priority: "Medium" },
  { min: 0, status: "Must Upgrade", priority: "High" },
];

/**
 * File duration ÷ the runtime TMDb lists. Generous on both sides: TMDb runtimes
 * are rounded to the minute and usually describe the theatrical cut, and 25fps
 * PAL transfers legitimately run about 4% short.
 */
export const RUNTIME_TOLERANCE = {
  longer: 1.07,
  shorter: 0.93,
  truncated: 0.75,
};

/**
 * How much of the expected RPU count a full pass has to find before the stream
 * counts as carrying Dolby Vision throughout. Frame counts and container
 * durations routinely disagree by a frame or two, so only a real shortfall —
 * an RPU that stops partway through the film — is worth reporting.
 */
export const RPU_COVERAGE_TOLERANCE = 0.995;

/**
 * How far the Dolby Vision grade may peak above the base layer before the
 * enhancement layer counts as reconstructing brightness rather than merely
 * refining it. Matches dovi_convert, so the two tools agree on a film.
 */
export const EL_BRIGHTNESS_MARGIN = 50;

/**
 * Assumed base layer peak when the file declares no MaxCLL. Also dovi_convert's
 * default: a UHD disc base layer is trimmed to 1000 nits far more often than
 * not, and assuming it is what makes a missing figure conservative rather than
 * unanswerable.
 */
export const ASSUMED_BL_PEAK = 1000;

/**
 * What dovi_convert renames an original to before replacing it. Its convention,
 * not ours — but both the server that restores from it and the page that offers
 * to need to agree on the name, so it is stated once here.
 *
 * Not a video extension, so the scanner walks past it and it never enters the
 * library as a film of its own.
 */
export const BACKUP_SUFFIX = ".bak.dovi_convert";

/**
 * How far a converted file's runtime may drift from the original's before the
 * mux is treated as faulty. The two hold the same frames and should agree to
 * the millisecond — what this catches is not rounding but a remux that emits
 * the stream twice and comes out at double the length.
 */
export const RUNTIME_DRIFT = 0.01;

export const runtimeDrift = (before: number, after: number) =>
  Math.abs(after - before) / before;

/**
 * Every check `detectIssues` can raise. Severity lives here rather than at each
 * call site so the engine and the documentation page cannot disagree.
 */
export const ISSUE_CATALOGUE = {
  "dv-profile-7": {
    severity: "warning",
    trigger: "Dolby Vision profile reads dvhe.07",
    why: "Dual-layer Profile 7 is a disc format. Many TVs, streaming boxes and Plex clients drop the enhancement layer or refuse the file; a Profile 8.1 version plays everywhere. The scan reads the RPU to establish whether that enhancement layer is MEL or FEL, which is what decides whether converting discards anything.",
  },
  "dv-no-fallback": {
    severity: "critical",
    trigger: "Dolby Vision profile reads dvhe.05",
    why: "Profile 5 carries no HDR10 base layer, so anything without Dolby Vision decoding renders it with badly shifted colour.",
  },
  "dv-no-compat": {
    severity: "warning",
    trigger:
      "Dolby Vision present but HDR_Format_Compatibility lists no HDR10, Blu-ray or SDR fallback",
    why: "Without a compatible base layer the file depends entirely on the player supporting Dolby Vision.",
  },
  "custom-encoder": {
    severity: "warning",
    trigger:
      "Encoder string matches neither a known professional nor a known hobbyist encoder",
    why: "Official releases come off recognisable encoders. A custom string usually marks a fan-made hybrid or an AI upscale rather than a real master.",
  },
  "fake-4k": {
    severity: "critical",
    trigger: "Frame width is 2160p class but the codec is AVC",
    why: "No commercial UHD release ships in AVC. This is almost certainly a 1080p source scaled up, so it carries 4K file size with 1080p detail.",
  },
  "8bit-4k": {
    severity: "warning",
    trigger: "2160p frame at 8-bit depth",
    why: "Genuine UHD masters are 10-bit. 8-bit at this resolution points to an upscale or a re-encode that discarded precision.",
  },
  "low-bitrate": {
    severity: "warning",
    trigger: "An encode below the 'fair' bits-per-pixel-per-frame threshold",
    why: "Below this density, expect banding in gradients and smeared detail in motion.",
  },
  "atmos-mislabelled": {
    severity: "warning",
    trigger: "Filename says Atmos but no track carries the Atmos extension",
    why: "The file is not what its name claims. The underlying track is plain TrueHD or Dolby Digital Plus.",
  },
  "dtsx-mislabelled": {
    severity: "warning",
    trigger: "Filename says DTS:X but no track carries the DTS:X extension",
    why: "Same as above — usually plain DTS-HD Master Audio underneath.",
  },
  "lossy-remux": {
    severity: "warning",
    trigger: "Classified REMUX but no lossless audio track present",
    why: "A disc remux should carry the disc's lossless track. Its absence suggests the audio was replaced or the release is mislabelled.",
  },
  "no-audio": {
    severity: "critical",
    trigger: "No audio track at all",
    why: "Either a broken file or a video-only stream.",
  },
  "no-english-subs": {
    severity: "info",
    trigger: "Subtitle tracks exist but none is English",
    why: "Informational only — it does not affect the score.",
  },
  "disc-better-resolution": {
    severity: "warning",
    trigger: "A 4K disc exists and this copy is not 2160p",
    why: "The single largest upgrade available. A native 4K transfer carries detail no 1080p master has.",
  },
  "disc-better-hdr": {
    severity: "warning",
    trigger: "The disc carries a dynamic-range format this copy lacks",
    why: "Usually Dolby Vision on the disc against HDR10, or HDR against SDR, in your file.",
  },
  "disc-better-audio": {
    severity: "warning",
    trigger:
      "The disc carries object audio (Atmos or DTS:X) that this copy lacks",
    why: "Either the release you have dropped the object track, or it was encoded from a lossy source.",
  },
  "disc-higher-bitrate": {
    severity: "info",
    trigger: "The file's video bitrate is well below the disc's",
    why: "Expected on an encode. On something claiming to be a remux it suggests the stream was re-compressed.",
  },
  "runtime-longer": {
    severity: "info",
    trigger: `File runs more than ${Math.round((RUNTIME_TOLERANCE.longer - 1) * 100)}% longer than the runtime TMDb lists`,
    why: "Usually an extended or director's cut, since TMDb lists the theatrical runtime. Worth confirming the edition is the one you wanted.",
  },
  "runtime-shorter": {
    severity: "warning",
    trigger: `File runs more than ${Math.round((1 - RUNTIME_TOLERANCE.shorter) * 100)}% shorter than the runtime TMDb lists`,
    why: "Could be a cut version, a different edition, or the wrong film. PAL transfers also run about 4% short by design.",
  },
  "runtime-truncated": {
    severity: "critical",
    trigger: `File runs under ${Math.round(RUNTIME_TOLERANCE.truncated * 100)}% of the runtime TMDb lists`,
    why: "A gap this large usually means an incomplete download or a damaged file rather than an alternate cut.",
  },
} as const satisfies Record<
  string,
  { severity: Severity; trigger: string; why: string }
>;

export type IssueCode = keyof typeof ISSUE_CATALOGUE;

/**
 * Bits per pixel per frame — bitrate normalised across resolution and frame
 * rate, so a 1080p and a 2160p encode can be compared on the same scale.
 * Remuxes typically land above 0.20; heavy encodes below 0.06 show artefacts.
 */
export const BPP = { excellent: 0.18, good: 0.1, fair: 0.06 };

/** How far the overall score may exceed the video score. See scoring note below. */
export const VIDEO_CEILING_BONUS = 15;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReleaseType = "REMUX" | "WEB-DL" | "ENCODE" | "UNKNOWN";
export type HdrKind = "Dolby Vision" | "HDR10+" | "HDR10" | "SDR";
export type Severity = "critical" | "warning" | "info";
export type Status =
  | "Best Available"
  | "Reference"
  | "Excellent"
  | "Good"
  | "Upgrade Recommended"
  | "Must Upgrade";
export type Priority = "Critical" | "High" | "Medium" | "Low" | "None";

export type Issue = { code: string; severity: Severity; message: string };

/**
 * One criterion's contribution to a sub-score. `max` is what the criterion pays
 * at best, so `max - points` is exactly the headroom left on the table — which
 * is what makes a score of 93 explainable rather than mysterious.
 */
export type ScoreLine = {
  label: string;
  detail: string;
  points: number;
  max: number;
  /** How to close the gap, when there is one. */
  note?: string;
};

export type Breakdown = {
  /** True when the overall score is measured against a disc rather than the rubric. */
  relative: boolean;
  /** The disc's own score — the denominator when `relative`. */
  discScore?: number;
  /** The absolute rubric score, kept for reference either way. */
  absolute: number;
  video: ScoreLine[];
  audio: ScoreLine[];
  release: ScoreLine[];
  /** The weighted total before the video ceiling is applied. */
  weighted: number;
  /** video score + VIDEO_CEILING_BONUS. */
  ceiling: number;
  cappedByVideo: boolean;
};

export type AudioTrack = {
  label: string;
  format: string;
  channels: number;
  language?: string;
  bitrateKbps?: number;
  lossless: boolean;
  atmos: boolean;
  dtsx: boolean;
};

/**
 * Facts supplied by TMDb. Identity only — nothing here influences the quality
 * scores, which stay derived purely from the file.
 */
export type TmdbFacts = {
  id: number;
  title: string;
  year?: number;
  runtimeMinutes?: number;
  imdbId?: string;
  collection?: string;
  genres?: string[];
  posterPath?: string;
  overview?: string;
  /** Only "high" is trusted enough to raise runtime issues. */
  confidence: "high" | "medium" | "low";
};

/**
 * What the best commercial disc offers, and where your copy falls short.
 * Purely comparative — it changes the verdict, never the technical score.
 */
export type DiscFacts = {
  url?: string;
  releaseTitle?: string;
  format?: "4K" | "3D" | "BD";
  uhdExists: boolean;
  nativeFourK?: boolean;
  hdr: string[];
  hasAtmos: boolean;
  hasDtsX: boolean;
  videoBitrateMbps?: number;
  /** Every way the disc beats this file. Empty means you have the best of it. */
  gaps: string[];
  /** Nothing better exists to buy. */
  bestAvailable: boolean;
  /** What the disc itself scores on the same rubric — the ceiling. */
  discScore?: number;
  /** Per-dimension ceilings, so each meter can show where the disc sits. */
  discParts?: { video: number; audio: number; release: number };
};

export type Derived = {
  path: string;
  fileName: string;
  folder: string;
  title: string;
  year?: number;
  edition?: string;
  imdbId?: string;
  /** TMDb id written into the container by the muxer, if any. */
  tmdbIdHint?: number;
  tmdb?: TmdbFacts;

  sizeBytes: number;
  durationSec?: number;

  width?: number;
  height?: number;
  resolution: "2160p" | "1080p" | "720p" | "SD" | "unknown";
  videoCodec?: string;
  bitDepth?: number;
  videoBitrateKbps?: number;
  frameRate?: number;
  aspectRatio?: number;
  bpp?: number;
  crf?: number;
  encoder?: string;

  hdr: HdrKind;
  dvProfile?: number;
  dvHasHdr10Fallback?: boolean;
  /**
   * Static HDR10 metadata on the base layer. On a dual-layer file this is what
   * a player without Dolby Vision sees, which makes it the thing the Dolby
   * Vision grade has to be compared against.
   */
  hdr10?: Hdr10Static;
  /** Present once a scan has read the RPU out of the video stream itself. */
  dovi?: DoviScan;

  audio: AudioTrack[];
  subtitleLanguages: string[];

  releaseType: ReleaseType;
  disc?: DiscFacts;
  issues: Issue[];
  scores: { video: number; audio: number; release: number; overall: number };
  breakdown: Breakdown;
  status: Status;
  priority: Priority;
  reasons: string[];
};

// ---------------------------------------------------------------------------
// MediaInfo access helpers. Every field is optional and string-typed, and
// values vary between files, so read defensively rather than validating.
// ---------------------------------------------------------------------------

type Track = Record<string, unknown>;

function tracks(mediainfo: unknown): Track[] {
  const media = (mediainfo as { media?: { track?: unknown } })?.media;
  return Array.isArray(media?.track) ? (media.track as Track[]) : [];
}

const str = (t: Track | undefined, key: string): string | undefined => {
  const value = t?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

const num = (t: Track | undefined, key: string): number | undefined => {
  const value = str(t, key);
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

// ---------------------------------------------------------------------------
// Filename parsing
// ---------------------------------------------------------------------------

const EDITIONS = [
  "Extended Cut",
  "Extended",
  "Directors Cut",
  "Director's Cut",
  "Theatrical",
  "Unrated",
  "Remastered",
  "Final Cut",
  "Ultimate Edition",
  "Open Matte",
  "IMAX",
];

/** Tags that mark where the title ends and release metadata begins. */
const TAG_START =
  /\b(2160p|1080p|720p|480p|UHD|BluRay|Blu-ray|BDRip|BRRip|WEB-?DL|WEBRip|REMUX|Remux|HDTV|DVDRip|COMPLETE|REPACK|PROPER)\b/i;

export function parseName(
  fileName: string,
  folderName: string,
): { title: string; year?: number; edition?: string } {
  const base = fileName.replace(/\.[^.]+$/, "");

  // `20\d{2}` also matches the 2160 in "2160p", so resolution tags are excluded
  // explicitly. The *last* candidate wins, because titles can contain a year of
  // their own — "Blade Runner 2049 2017" releases in 2017, not 2049.
  const years = [...base.matchAll(/\b(19\d{2}|20\d{2})\b(?!p)/g)].filter(
    (m) => Number(m[1]) <= new Date().getFullYear() + 2,
  );
  const yearMatch = years.length > 0 ? years[years.length - 1] : undefined;
  const year = yearMatch ? Number(yearMatch[1]) : undefined;

  let head = yearMatch ? base.slice(0, yearMatch.index) : base;
  const tagMatch = head.match(TAG_START);
  if (tagMatch?.index !== undefined) head = head.slice(0, tagMatch.index);

  let title = head.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  title = title.replace(/[-([{\s]+$/, "").trim();

  // "Troy Directors Cut.mkv" has no year and no tags, so fall back to the
  const editionPattern = (e: string) =>
    new RegExp(
      `\\b${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s/g, "[.\\s_]")}\\b`,
      "i",
    );
  const edition = EDITIONS.find((e) => editionPattern(e).test(base));

  // "Troy Directors Cut" is the film Troy in its Directors Cut, so the edition
  // belongs in its own field rather than glued onto the title.
  if (edition) title = title.replace(editionPattern(edition), "").trim();

  const folderTitle = folderName.replace(/[._]+/g, " ").trim();

  // Generic filenames ("movie.mkv") carry no title at all. In a per-movie folder
  // layout the folder name is then the best source available.
  const uninformative =
    title.length < 2 ||
    (!year && !TAG_START.test(base) && folderTitle.length > title.length);
  if (uninformative && folderTitle.length >= 2) title = folderTitle;

  // exFAT-safe folder names substitute U+A789 for a colon.
  title = title.replace(/꞉/g, ":").replace(/\s+/g, " ").trim();

  return { title, year, edition };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function resolutionOf(width?: number, height?: number): Derived["resolution"] {
  // Scope films are letterboxed into the frame (3840x1600), so width is the
  // reliable axis — height alone would call a 2160p scope transfer "1080p".
  const w = width ?? 0;
  if (w >= 3000) return "2160p";
  if (w >= 1800) return "1080p";
  if (w >= 1200) return "720p";
  if (w > 0 || (height ?? 0) > 0) return "SD";
  return "unknown";
}

/** Professional encoders indicate a streaming master, not a re-encode. */
const PRO_ENCODERS = /^(ATEME|Elemental|Beamr|AWS|Harmonic)/i;
const HOBBY_ENCODERS = /^(x264|x265|SVT-AV1|libaom|HandBrake|MeGUI)/i;

// Deliberately no bare "max" (HBO Max): it matches "Mad Max".
const WEB_TAGS = /\b(web-?dl|webrip|amzn|nf|dsnp|atvp|hmax|hulu|pcok)\b/;
const DISC_TAGS = /\b(remux|bluray|blu-ray|uhd|bdrip|brrip)\b/;

function classifyRelease(
  general: Track,
  video: Track,
  fileName: string,
): { type: ReleaseType; encoder?: string } {
  const encoder = str(video, "Encoded_Library");
  const name = fileName.toLowerCase();

  if (WEB_TAGS.test(name)) return { type: "WEB-DL", encoder };

  // No encoder library on the video stream means the stream was copied, not
  // re-compressed — the defining property of a remux.
  if (!encoder) return { type: "REMUX" };

  // A filename claiming REMUX over an x265 stream is lying, so hobbyist
  // encoders are checked before the disc tags.
  if (HOBBY_ENCODERS.test(encoder)) return { type: "ENCODE", encoder };

  // Studio UHD masters are themselves cut on professional encoders, and a remux
  // inherits that string from the source. So ATEME alone cannot separate a disc
  // remux from a streaming pull — the disc tag is what distinguishes them.
  if (DISC_TAGS.test(name)) return { type: "REMUX", encoder };
  if (PRO_ENCODERS.test(encoder)) return { type: "WEB-DL", encoder };

  return { type: "UNKNOWN", encoder };
}

function hdrOf(video: Track): {
  hdr: HdrKind;
  dvProfile?: number;
  dvHasHdr10Fallback?: boolean;
} {
  const format = str(video, "HDR_Format") ?? "";
  const compat = str(video, "HDR_Format_Compatibility") ?? "";
  const profileStr = str(video, "HDR_Format_Profile") ?? "";

  if (/dolby vision/i.test(format)) {
    const match = profileStr.match(/dvhe\.(\d+)/i);
    return {
      hdr: "Dolby Vision",
      dvProfile: match ? Number(match[1]) : undefined,
      dvHasHdr10Fallback: /HDR10|Blu-ray|SDR/i.test(compat),
    };
  }
  if (/HDR10\+/i.test(format) || /HDR10\+/i.test(compat))
    return { hdr: "HDR10+" };
  if (/SMPTE ST 2086|HDR10/i.test(format)) return { hdr: "HDR10" };
  return { hdr: "SDR" };
}

/**
 * The base layer's own light levels. MaxCLL is written as a bare number by some
 * muxers and with its unit by others, and the mastering display arrives as one
 * string holding both ends of the range.
 */
function hdr10Of(video: Track): Hdr10Static | undefined {
  const luminance = str(video, "MasteringDisplay_Luminance") ?? "";
  const min = luminance.match(/min:\s*([\d.]+)/i);
  const max = luminance.match(/max:\s*([\d.]+)/i);

  const hdr10: Hdr10Static = {
    maxCll: num(video, "MaxCLL"),
    maxFall: num(video, "MaxFALL"),
    masteringMin: min ? Number(min[1]) : undefined,
    masteringMax: max ? Number(max[1]) : undefined,
  };

  return Object.values(hdr10).some((v) => v !== undefined) ? hdr10 : undefined;
}

const LOSSLESS = /MLP FBA|TrueHD|DTS-HD Master|PCM|FLAC|ALAC/i;

function audioOf(track: Track): AudioTrack {
  const commercial = str(track, "Format_Commercial_IfAny");
  const format = str(track, "Format") ?? "unknown";
  const extra = str(track, "Format_AdditionalFeatures") ?? "";
  const label = commercial ?? format;

  return {
    label,
    format,
    channels: num(track, "Channels") ?? 0,
    language: str(track, "Language"),
    bitrateKbps: num(track, "BitRate")
      ? Math.round(num(track, "BitRate")! / 1000)
      : undefined,
    lossless: LOSSLESS.test(label) || LOSSLESS.test(format),
    atmos: /atmos/i.test(label),
    dtsx: /DTS:?X/i.test(label) || /XLL X/i.test(extra),
  };
}

// ---------------------------------------------------------------------------
// Issue detection
// ---------------------------------------------------------------------------

function detectIssues(
  d: Omit<
    Derived,
    "issues" | "scores" | "breakdown" | "status" | "priority" | "reasons"
  >,
): Issue[] {
  const issues: Issue[] = [];
  const name = d.fileName.toLowerCase();

  const raise = (code: IssueCode, message: string) =>
    issues.push({ code, severity: ISSUE_CATALOGUE[code].severity, message });

  if (d.dvProfile === 7) {
    // What a conversion to 8.1 would actually cost is the first thing you want
    // to know here, so it goes in the sentence rather than only on the page.
    const verdict = classifyEnhancementLayer(d.dovi, d.hdr10);
    const cost =
      verdict?.kind === "mel"
        ? " Its enhancement layer is MEL, which carries no picture data — converting discards nothing."
        : verdict?.kind === "simple-fel"
          ? ` Its enhancement layer is a FEL, but the grade stays within the base layer's ${verdict.blPeak} nits, so converting costs refinement rather than picture.`
          : verdict?.kind === "complex-fel"
            ? ` Its enhancement layer reconstructs brightness — the grade peaks at ${Math.round(verdict.elPeak!)} nits against a base layer of ${verdict.blPeak} — so converting would clip those highlights.`
            : "";

    raise(
      "dv-profile-7",
      "Dolby Vision Profile 7 (dual-layer). Many TVs, Apple TV and Plex clients ignore or refuse the enhancement layer — a Profile 8.1 version plays everywhere." +
        cost,
    );
  }
  if (d.dvProfile === 5) {
    raise(
      "dv-no-fallback",
      "Dolby Vision Profile 5 has no HDR10 base layer. On any non-DV display this renders with badly shifted colour.",
    );
  }
  if (d.hdr === "Dolby Vision" && d.dvHasHdr10Fallback === false) {
    raise(
      "dv-no-compat",
      "Dolby Vision layer reports no HDR10-compatible fallback.",
    );
  }
  if (d.releaseType === "UNKNOWN" && d.encoder) {
    raise(
      "custom-encoder",
      `Non-standard encoder string "${d.encoder}" — likely a fan-made hybrid rather than an official release.`,
    );
  }
  if (d.resolution === "2160p" && d.videoCodec === "AVC") {
    raise(
      "fake-4k",
      "2160p frame encoded in AVC — almost certainly an upscale from a 1080p source.",
    );
  }
  if (d.resolution === "2160p" && d.bitDepth === 8) {
    raise(
      "8bit-4k",
      "2160p at 8-bit depth. Genuine UHD masters are 10-bit; this suggests an upscale.",
    );
  }
  if (d.bpp !== undefined && d.bpp < BPP.fair && d.releaseType === "ENCODE") {
    raise(
      "low-bitrate",
      `Very low bitrate for this resolution (${d.bpp.toFixed(3)} bits/pixel/frame). Expect banding and smeared detail in motion.`,
    );
  }
  if (/atmos/.test(name) && !d.audio.some((a) => a.atmos)) {
    raise(
      "atmos-mislabelled",
      "Filename claims Atmos but no track carries an Atmos extension.",
    );
  }
  if (/dts[.\-_]?x/.test(name) && !d.audio.some((a) => a.dtsx)) {
    raise(
      "dtsx-mislabelled",
      "Filename claims DTS:X but no track carries a DTS:X extension.",
    );
  }
  if (
    d.audio.length > 0 &&
    !d.audio.some((a) => a.lossless) &&
    d.releaseType === "REMUX"
  ) {
    raise(
      "lossy-remux",
      "Remuxed from disc but carries no lossless audio track.",
    );
  }
  if (d.audio.length === 0) {
    raise("no-audio", "No audio track found.");
  }
  if (d.subtitleLanguages.length > 0 && !d.subtitleLanguages.includes("en")) {
    raise("no-english-subs", "No English subtitle track.");
  }

  // Runtime is only compared on high-confidence matches. A wrong film would
  // otherwise manufacture a convincing but meaningless discrepancy.
  const listed =
    d.tmdb?.confidence === "high" ? d.tmdb.runtimeMinutes : undefined;
  if (listed && listed > 0 && d.durationSec) {
    const actual = d.durationSec / 60;
    const ratio = actual / listed;
    const delta = `file runs ${actual.toFixed(0)} min against TMDb's ${listed} min`;

    if (ratio < RUNTIME_TOLERANCE.truncated) {
      raise(
        "runtime-truncated",
        `Only ${Math.round(ratio * 100)}% of the expected length — ${delta}.`,
      );
    } else if (ratio < RUNTIME_TOLERANCE.shorter) {
      raise("runtime-shorter", `Shorter than expected — ${delta}.`);
    } else if (ratio > RUNTIME_TOLERANCE.longer) {
      raise(
        "runtime-longer",
        d.edition
          ? `Longer than TMDb's theatrical runtime, consistent with the ${d.edition} — ${delta}.`
          : `Longer than expected — ${delta}. Likely an extended cut.`,
      );
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Disc comparison
// ---------------------------------------------------------------------------

/**
 * Scores the disc itself on the very same rubric, so a file can be expressed as
 * a fraction of what is actually purchasable.
 *
 * This is what makes a perfect copy of a modest disc score 100: the ceiling is
 * the disc, not an abstract ideal no release for this film ever reached.
 */
function scoreDisc(best: NonNullable<DiscInput["best"]>): {
  video: number;
  audio: number;
  release: number;
  overall: number;
} {
  const resolution: Derived["resolution"] =
    best.format === "4K"
      ? "2160p"
      : /720p/.test(best.resolution ?? "")
        ? "720p"
        : "1080p";

  const hdr: HdrKind = best.hdr.includes("Dolby Vision")
    ? "Dolby Vision"
    : best.hdr.includes("HDR10+")
      ? "HDR10+"
      : best.hdr.includes("HDR10")
        ? "HDR10"
        : "SDR";

  // Reconstruct the disc's audio as tracks so the same scorer can read it.
  //
  // Blu-ray.com lists "Dolby Atmos" and "Dolby TrueHD 7.1" as separate lines,
  // but they are one track — Atmos rides on the TrueHD stream. Taken literally
  // the best track looks like plain TrueHD, which under-scores the disc.
  const audio: AudioTrack[] = best.audioTracks.map((label) => ({
    label,
    format: label,
    channels: Number(label.match(/(\d)\.\d/)?.[1] ?? 0) + 1,
    lossless: LOSSLESS.test(label),
    atmos: /atmos/i.test(label) || (best.hasAtmos && LOSSLESS.test(label)),
    dtsx: /DTS:?X/i.test(label) || (best.hasDtsX && LOSSLESS.test(label)),
  }));

  const shape = {
    resolution,
    hdr,
    // UHD discs are 10-bit by specification; standard Blu-ray is 8-bit.
    bitDepth: best.format === "4K" ? 10 : 8,
    bpp: undefined,
    // The disc is the source, so it scores as an untouched stream.
    releaseType: "REMUX" as ReleaseType,
    dvProfile: undefined,
  };

  const video = total(videoLines(shape));
  const audioScore = total(audioLines(audio));
  const release = total(releaseLines("REMUX"));

  const weighted =
    video * WEIGHTS.video +
    audioScore * WEIGHTS.audio +
    release * WEIGHTS.release;

  return {
    video,
    audio: audioScore,
    release,
    overall: Math.round(Math.min(weighted, video + VIDEO_CEILING_BONUS)),
  };
}

/** How far below the disc's bitrate a file has to sit before it is worth saying. */
export const BITRATE_SHORTFALL = 0.6;

type DiscInput = {
  uhdExists: boolean;
  best?: {
    url: string;
    title: string;
    format: "4K" | "3D" | "BD";
    nativeFourK?: boolean;
    hdr: string[];
    hasAtmos: boolean;
    hasDtsX: boolean;
    videoBitrateMbps?: number;
    resolution?: string;
    audioTracks: string[];
  };
};

/**
 * How deeply the RPU was read. `head` parses the first few hundred frames,
 * which is everything authored once and fixed — profile, EL type, CM version,
 * L6. `full` parses every frame, which is what the light levels and the frame
 * count need before they mean anything.
 */
/**
 * The issues still standing on a film: everything it raised, less the ones you
 * resolved individually, and none at all once the film is accepted wholesale.
 */
export function openIssues(m: {
  issues: Issue[];
  acknowledged?: boolean;
  resolved?: string[];
}): Issue[] {
  if (m.acknowledged) return [];
  const resolved = m.resolved ?? [];
  return m.issues.filter((i) => !resolved.includes(i.code));
}

/** Nits, as MediaInfo reports them from the stream's SEI messages. */
export type Hdr10Static = {
  maxCll?: number;
  maxFall?: number;
  masteringMin?: number;
  masteringMax?: number;
};

export type DoviDepth = "head" | "full";

/**
 * What is inside the Dolby Vision RPU, which MediaInfo does not read — it
 * reports the profile from the container's configuration record and stops.
 * Populated by `lib/dovi.ts`; every field is optional because it is parsed from
 * a summary dovi_tool prints for people rather than for programs.
 */
export type DoviScan = {
  depth: DoviDepth;
  scannedAt: number;
  /** Frames actually parsed — the sample every measured number describes. */
  frames: number;
  profile?: number;
  /**
   * Profile 7 only, and the whole question when converting to 8.1: a minimum
   * enhancement layer carries no picture data, a full one carries real detail.
   */
  elType?: "MEL" | "FEL";
  /** "CM v2.9" or "CM v4.0" — v4.0 is what adds the L8/L9/L11 trims. */
  cmVersion?: string;
  scenes?: number;
  /** Mastering display the RPU declares, in nits. */
  mastering?: { min: number; max: number };
  /** Measured, so only meaningful once the whole file has been read. */
  l1?: { maxCll: number; maxFall: number };
  /** Static fallback metadata, authored once — right even from a head scan. */
  l6?: { min: number; max: number; maxCll: number; maxFall: number };
  /** Letterbox bars the RPU declares, in pixels. */
  l5?: { top: number; bottom: number; left: number; right: number };
  /** Target displays the trims were authored for, in nits. */
  l2Trims?: number[];
  l8Trims?: number[];
  /** CM v4.0 extras, kept as printed rather than parsed further. */
  l9?: string;
  l11?: string;
  hdr10plus?: boolean;
  /** The raw summary, so a field added later costs no rescan to recover. */
  summary: string;
  error?: string;
};

/**
 * What a Profile 7 file's enhancement layer is actually doing, and so what
 * discarding it would cost. Three answers, following dovi_convert:
 *
 *   mel         nothing in the layer at all — converting is lossless
 *   simple-fel  real data, but the grade stays within the base layer's range,
 *               so what is lost is refinement rather than picture
 *   complex-fel the grade peaks above what the base layer holds. The layer is
 *               reconstructing brightness the base layer does not have, and
 *               discarding it clips those highlights
 *
 * The comparison is the Dolby Vision grade's measured peak against the base
 * layer's own peak. The textbook complex case is a film mastered at 4000 nits
 * whose HDR10 base was trimmed to 1000: the missing 3000 nits live in the
 * enhancement layer, and a conversion throws them away.
 */
export type ElVerdict = {
  kind: "mel" | "simple-fel" | "complex-fel" | "unknown";
  /** Peak the base layer itself declares, in nits. */
  blPeak: number;
  /** True when the file declared no MaxCLL and the default stood in. */
  blPeakAssumed: boolean;
  /** Peak the Dolby Vision grade reaches across the frames read, in nits. */
  elPeak?: number;
  /**
   * Set when only a sample was read and the answer could still change. Finding
   * expansion in a sample proves it exists; not finding it proves nothing, so
   * this is only ever true of a "simple" verdict.
   */
  provisional: boolean;
};

export function classifyEnhancementLayer(
  dovi: DoviScan | undefined,
  hdr10: Hdr10Static | undefined,
): ElVerdict | undefined {
  if (!dovi || dovi.profile !== 7) return undefined;

  // Below 100 nits the figure is not a real content light level — some muxers
  // write 0 when they have nothing. dovi_convert discards those too.
  const declared =
    hdr10?.maxCll !== undefined && hdr10.maxCll >= 100 ? hdr10.maxCll : undefined;
  const blPeak = declared ?? ASSUMED_BL_PEAK;
  const base = {
    blPeak,
    blPeakAssumed: declared === undefined,
    elPeak: dovi.l1?.maxCll,
  };

  if (dovi.elType === "MEL") {
    return { ...base, kind: "mel", provisional: false };
  }
  if (dovi.elType !== "FEL" || dovi.l1?.maxCll === undefined) {
    return { ...base, kind: "unknown", provisional: false };
  }

  return dovi.l1.maxCll > blPeak + EL_BRIGHTNESS_MARGIN
    ? { ...base, kind: "complex-fel", provisional: false }
    : { ...base, kind: "simple-fel", provisional: dovi.depth === "head" };
}

const HDR_ORDER = ["SDR", "HDR10", "HDR10+", "Dolby Vision"];

/**
 * Compares a file against the best disc that exists. Every gap is something you
 * could actually buy your way out of — which is what makes "Best Available"
 * meaningful rather than just a high score.
 */
function compareToDisc(
  d: Pick<
    Derived,
    "resolution" | "hdr" | "audio" | "videoBitrateKbps" | "releaseType"
  >,
  disc: DiscInput,
): DiscFacts {
  const best = disc.best;
  const gaps: string[] = [];

  if (disc.uhdExists && d.resolution !== "2160p") {
    gaps.push("A 4K disc exists; this copy is " + d.resolution);
  }

  if (best) {
    const discTop = best.hdr.reduce(
      (top, h) => (HDR_ORDER.indexOf(h) > HDR_ORDER.indexOf(top) ? h : top),
      "SDR",
    );
    if (HDR_ORDER.indexOf(discTop) > HDR_ORDER.indexOf(d.hdr)) {
      gaps.push(`Disc has ${discTop}; this copy is ${d.hdr}`);
    }

    const fileObject = d.audio.some((a) => a.atmos || a.dtsx);
    if ((best.hasAtmos || best.hasDtsX) && !fileObject) {
      gaps.push(
        `Disc has ${best.hasAtmos ? "Dolby Atmos" : "DTS:X"}; this copy has neither`,
      );
    }

    if (d.releaseType !== "REMUX") {
      gaps.push(
        `Disc is the untouched source; this copy is a ${
          d.releaseType === "UNKNOWN"
            ? "re-encode of unknown origin"
            : d.releaseType
        }`,
      );
    }

    if (
      best.videoBitrateMbps &&
      d.videoBitrateKbps &&
      d.videoBitrateKbps / 1000 < best.videoBitrateMbps * BITRATE_SHORTFALL
    ) {
      gaps.push(
        `Disc runs at ${best.videoBitrateMbps} Mbps; this copy at ${Math.round(
          d.videoBitrateKbps / 1000,
        )} Mbps`,
      );
    }
  }

  return {
    url: best?.url,
    releaseTitle: best?.title,
    format: best?.format,
    uhdExists: disc.uhdExists,
    nativeFourK: best?.nativeFourK,
    hdr: best?.hdr ?? [],
    hasAtmos: best?.hasAtmos ?? false,
    hasDtsX: best?.hasDtsX ?? false,
    videoBitrateMbps: best?.videoBitrateMbps,
    gaps,
    // Only a claim we can stand behind when a disc was actually found.
    bestAvailable: Boolean(best) && gaps.length === 0,
    discScore: best ? scoreDisc(best).overall : undefined,
    discParts: best
      ? (({ video, audio, release }) => ({ video, audio, release }))(
          scoreDisc(best),
        )
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Each sub-score is the sum of its lines, so the two can never disagree. */
const total = (lines: ScoreLine[]) =>
  Math.max(
    0,
    Math.min(100, Math.round(lines.reduce((sum, l) => sum + l.points, 0))),
  );

const gap = (points: number, max: number, how: string) =>
  points < max ? `${how} (+${max - points})` : undefined;

const BEST_RESOLUTION = Math.max(...Object.values(VIDEO_POINTS.resolution));
const BEST_HDR = Math.max(...Object.values(VIDEO_POINTS.hdr));
const BEST_DENSITY = Math.max(VIDEO_POINTS.remux, VIDEO_POINTS.bppExcellent);

function videoLines(
  d: Pick<
    Derived,
    "resolution" | "hdr" | "bitDepth" | "bpp" | "releaseType" | "dvProfile"
  >,
): ScoreLine[] {
  const resolution = VIDEO_POINTS.resolution[d.resolution];
  const hdr = VIDEO_POINTS.hdr[d.hdr];
  const tenBit = d.bitDepth && d.bitDepth >= 10 ? VIDEO_POINTS.tenBit : 0;

  // Remuxes carry the disc bitrate by definition, so bpp only discriminates
  // between encodes.
  let density = 0;
  let densityDetail: string;
  if (d.releaseType === "REMUX") {
    density = VIDEO_POINTS.remux;
    densityDetail = "Disc bitrate, untouched";
  } else if (d.bpp === undefined) {
    densityDetail = "Bitrate unknown";
  } else {
    densityDetail = `${d.bpp.toFixed(3)} bits/pixel/frame`;
    if (d.bpp >= BPP.excellent) density = VIDEO_POINTS.bppExcellent;
    else if (d.bpp >= BPP.good) density = VIDEO_POINTS.bppGood;
    else if (d.bpp >= BPP.fair) density = VIDEO_POINTS.bppFair;
  }

  return [
    {
      label: "Resolution",
      detail: d.resolution,
      points: resolution,
      max: BEST_RESOLUTION,
      note: gap(resolution, BEST_RESOLUTION, "A 2160p transfer would score"),
    },
    {
      label: "Dynamic range",
      detail:
        d.hdr === "Dolby Vision"
          ? `Dolby Vision P${d.dvProfile ?? "?"}`
          : d.hdr,
      points: hdr,
      max: BEST_HDR,
      note: gap(hdr, BEST_HDR, "Dolby Vision would score"),
    },
    {
      label: "Bit depth",
      detail: d.bitDepth ? `${d.bitDepth}-bit` : "unknown",
      points: tenBit,
      max: VIDEO_POINTS.tenBit,
      note: gap(tenBit, VIDEO_POINTS.tenBit, "10-bit would score"),
    },
    {
      label: "Bitrate density",
      detail: densityDetail,
      points: density,
      max: BEST_DENSITY,
      note: gap(
        density,
        BEST_DENSITY,
        "A remux or a high-bitrate encode would score",
      ),
    },
  ];
}

function bestTrack(audio: AudioTrack[]): AudioTrack | undefined {
  // Lossless outranks object audio, which outranks channel count.
  return audio.reduce<AudioTrack | undefined>((best, track) => {
    const rank = (t: AudioTrack) =>
      (t.lossless ? 100 : 0) + (t.atmos || t.dtsx ? 30 : 0) + t.channels;
    return !best || rank(track) > rank(best) ? track : best;
  }, undefined);
}

function audioLines(audio: AudioTrack[]): ScoreLine[] {
  const best = bestTrack(audio);

  if (!best) {
    return [
      {
        label: "Codec",
        detail: "No audio track",
        points: 0,
        max: AUDIO_POINTS.lossless,
      },
      {
        label: "Object audio",
        detail: "None",
        points: 0,
        max: AUDIO_POINTS.objectAudio,
      },
      {
        label: "Channels",
        detail: "None",
        points: 0,
        max: AUDIO_POINTS.channels8,
      },
    ];
  }

  const codec = best.lossless ? AUDIO_POINTS.lossless : AUDIO_POINTS.lossy;
  const object = best.atmos || best.dtsx ? AUDIO_POINTS.objectAudio : 0;
  const channels =
    best.channels >= 8
      ? AUDIO_POINTS.channels8
      : best.channels >= 6
        ? AUDIO_POINTS.channels6
        : 0;

  return [
    {
      label: "Codec",
      detail: `${best.label}${best.lossless ? " — lossless" : " — lossy"}`,
      points: codec,
      max: AUDIO_POINTS.lossless,
      note: gap(codec, AUDIO_POINTS.lossless, "A lossless track would score"),
    },
    {
      label: "Object audio",
      detail: best.atmos ? "Dolby Atmos" : best.dtsx ? "DTS:X" : "None",
      points: object,
      max: AUDIO_POINTS.objectAudio,
      note: gap(object, AUDIO_POINTS.objectAudio, "Atmos or DTS:X would score"),
    },
    {
      label: "Channels",
      detail: best.channels ? `${best.channels} channels` : "unknown",
      points: channels,
      max: AUDIO_POINTS.channels8,
      note: gap(
        channels,
        AUDIO_POINTS.channels8,
        "8 channels or more would score",
      ),
    },
  ];
}

function releaseLines(type: ReleaseType, bpp?: number): ScoreLine[] {
  let points: number;
  let detail: string;

  switch (type) {
    case "REMUX":
      points = RELEASE_POINTS.REMUX;
      detail = "REMUX — untouched disc stream";
      break;
    case "WEB-DL":
      points = RELEASE_POINTS.WEBDL;
      detail = "WEB-DL — provider's compressed master";
      break;
    case "ENCODE":
      if (bpp === undefined) {
        points = RELEASE_POINTS.encodeNoBpp;
        detail = "Encode, bitrate unknown";
      } else if (bpp >= BPP.excellent) {
        points = RELEASE_POINTS.encodeExcellent;
        detail = `Encode at ${bpp.toFixed(3)} bpp — near-transparent`;
      } else if (bpp >= BPP.good) {
        points = RELEASE_POINTS.encodeGood;
        detail = `Encode at ${bpp.toFixed(3)} bpp — very hard to fault`;
      } else if (bpp >= BPP.fair) {
        points = RELEASE_POINTS.encodeFair;
        detail = `Encode at ${bpp.toFixed(3)} bpp — some loss`;
      } else {
        points = RELEASE_POINTS.encodePoor;
        detail = `Encode at ${bpp.toFixed(3)} bpp — heavy compression`;
      }
      break;
    default:
      points = RELEASE_POINTS.UNKNOWN;
      detail = "Unrecognised encoder";
  }

  return [
    {
      label: "Source",
      detail,
      points,
      max: RELEASE_POINTS.REMUX,
      note: gap(points, RELEASE_POINTS.REMUX, "A disc remux would score"),
    },
  ];
}

function verdict(
  overall: number,
  issues: Issue[],
  disc?: DiscFacts,
): { status: Status; priority: Priority } {
  // A critical issue overrides everything: a fake 4K upscale is a problem no
  // matter what the disc looks like.
  if (issues.some((i) => i.severity === "critical")) {
    return { status: "Must Upgrade", priority: "Critical" };
  }

  if (disc?.discScore) {
    // Missing an entire 4K release is a different order of gap from missing
    // Atmos, so it escalates regardless of where the score lands.
    if (disc.gaps.some((g) => g.startsWith("A 4K disc exists"))) {
      return { status: "Must Upgrade", priority: "High" };
    }

    // Otherwise the relative score is the verdict. Banding it here rather than
    // keying off "are there any gaps" is what stops a 91 with one gap ranking
    // below a 76 with none.
    if (overall >= 100) return { status: "Best Available", priority: "None" };
    if (overall >= 85) return { status: "Good", priority: "Low" };
    if (overall >= 65)
      return { status: "Upgrade Recommended", priority: "Medium" };
    return { status: "Must Upgrade", priority: "High" };
  }

  const band = STATUS_BANDS.find((b) => overall >= b.min);
  return band
    ? { status: band.status, priority: band.priority }
    : { status: "Must Upgrade", priority: "High" };
}

/** Trailing quality tokens muxers append to the container title. */
const TRAILING_QUALITY =
  /[\s.]*\b(4K|UHD|HDR10?\+?|DV|Dolby\s*Vision|Remux|BluRay)\b[\s.]*$/i;

function tidyContainerTitle(raw: string, year?: number): string {
  let title = raw;
  let previous: string;
  // Repeat because a title can end in several of them: "Dune (2024) 4K".
  do {
    previous = title;
    title = title
      .replace(TRAILING_QUALITY, "")
      // Drop a trailing year only when it matches the release year, so
      // "Wonder Woman 1984" keeps the year that is part of its title.
      .replace(/[\s.]*\(?((19|20)\d{2})\)?[\s.]*$/, (match, y) =>
        Number(y) === year ? "" : match,
      )
      .trim();
  } while (title !== previous);

  return title.replace(/\s+/g, " ").trim();
}

/**
 * Grouping key for duplicate detection. Two files of the same film can carry
 * very different titles ("Skyfall" vs "Skyfall (2012) 4K"), so quality tokens
 * and bracketed years are stripped before comparison. Bare years are kept —
 * they distinguish "Blade Runner" from "Blade Runner 2049".
 */
export function titleKey(title: string, year?: number): string {
  const normalised = title
    .toLowerCase()
    .replace(/\((19|20)\d{2}\)/g, " ")
    .replace(
      /\b(4k|uhd|hdr10?\+?|dv|dolby vision|remux|bluray|2160p|1080p)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]/g, "");

  return `${normalised}|${year ?? ""}`;
}

function explain(d: Omit<Derived, "reasons">): string[] {
  const reasons: string[] = [];

  reasons.push(
    `${d.resolution} ${d.videoCodec ?? "video"}${d.bitDepth ? ` ${d.bitDepth}-bit` : ""}, ${d.hdr}${
      d.dvProfile ? ` (Profile ${d.dvProfile})` : ""
    }`,
  );
  reasons.push(
    d.releaseType === "REMUX"
      ? "Untouched disc video stream — no re-encoding loss."
      : d.releaseType === "WEB-DL"
        ? "Streaming master, compressed by the provider before delivery."
        : `Re-encoded${d.encoder ? ` with ${d.encoder}` : ""}${
            d.bpp ? ` at ${d.bpp.toFixed(3)} bits/pixel/frame` : ""
          }.`,
  );

  const best = d.audio[0];
  if (best) {
    reasons.push(
      `Primary audio ${best.label}${best.channels ? ` ${best.channels}ch` : ""}${
        best.lossless ? ", lossless" : ", lossy"
      }.`,
    );
  }
  if (d.hdr === "SDR" && d.resolution === "2160p") {
    reasons.push("2160p but SDR — a HDR grade would be a visible upgrade.");
  }
  if (d.hdr === "SDR" && d.resolution === "1080p") {
    reasons.push("1080p SDR — the lowest tier in this library.");
  }

  return reasons;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function derive(
  filePath: string,
  sizeBytes: number,
  mediainfo: unknown,
  tmdb?: TmdbFacts,
  disc?: DiscInput,
  dovi?: DoviScan,
): Derived {
  const all = tracks(mediainfo);
  const general = all.find((t) => t["@type"] === "General") ?? {};
  const video = all.find((t) => t["@type"] === "Video") ?? {};
  const audioTracks = all.filter((t) => t["@type"] === "Audio").map(audioOf);
  const textTracks = all.filter((t) => t["@type"] === "Text");

  const segments = filePath.split("/");
  const fileName = segments[segments.length - 1] ?? filePath;
  const folder = segments[segments.length - 2] ?? "";

  const parsed = parseName(fileName, folder);
  const containerTitle = str(general, "Movie") ?? str(general, "Title");

  const width = num(video, "Width");
  const height = num(video, "Height");
  const frameRate = num(video, "FrameRate");
  const videoBitrate = num(video, "BitRate");

  const bpp =
    videoBitrate && width && height && frameRate
      ? videoBitrate / (width * height * frameRate)
      : undefined;

  const settings = str(video, "Encoded_Library_Settings") ?? "";
  const crfMatch = settings.match(/\bcrf=([\d.]+)/i);

  const { type: releaseType, encoder } = classifyRelease(
    general,
    video,
    fileName,
  );
  const { hdr, dvProfile, dvHasHdr10Fallback } = hdrOf(video);

  const extra = general["extra"] as Record<string, string> | undefined;

  // Muxers often paste the full release name into the container title, which is
  // worse than the parsed filename. Only trust it when it reads like a title.
  const cleanContainerTitle =
    containerTitle &&
    !TAG_START.test(containerTitle) &&
    !/\b(x26[45]|HEVC|AVC|DDP?5|TrueHD|Atmos|DTS)\b/i.test(containerTitle) &&
    // Muxers sometimes sign the title field — "Release by …", "www.…".
    !/\b(released?\s+by|encoded\s+by|rip\s+by|torrent|www\.|\.com)\b/i.test(
      containerTitle,
    ) &&
    (containerTitle.match(/\./g) ?? []).length < 3
      ? tidyContainerTitle(containerTitle, parsed.year)
      : undefined;

  // Muxers write ids like "movie/597" into the container's extra fields.
  const tmdbHint = extra?.TMDB?.match(/movie\/(\d+)/)?.[1];

  const base = {
    path: filePath,
    fileName,
    folder,
    // A confirmed match beats every parsing heuristic; anything less does not.
    title:
      tmdb?.confidence === "high"
        ? tmdb.title
        : cleanContainerTitle || parsed.title,
    year:
      tmdb?.confidence === "high" ? (tmdb.year ?? parsed.year) : parsed.year,
    edition: parsed.edition,
    imdbId: extra?.IMDB ?? tmdb?.imdbId,
    tmdbIdHint: tmdbHint ? Number(tmdbHint) : undefined,
    tmdb,

    sizeBytes,
    durationSec: num(general, "Duration"),

    width,
    height,
    resolution: resolutionOf(width, height),
    videoCodec: str(video, "Format"),
    bitDepth: num(video, "BitDepth"),
    videoBitrateKbps: videoBitrate
      ? Math.round(videoBitrate / 1000)
      : undefined,
    frameRate,
    aspectRatio: num(video, "DisplayAspectRatio"),
    bpp,
    crf: crfMatch ? Number(crfMatch[1]) : undefined,
    encoder,

    hdr,
    dvProfile,
    dvHasHdr10Fallback,
    hdr10: hdr10Of(video),
    // Only carried when the reading is usable; a failed pass is recorded in the
    // probe row so it is not retried, but it is not a fact about the film.
    dovi: dovi && !dovi.error ? dovi : undefined,

    audio: audioTracks,
    subtitleLanguages: [
      ...new Set(
        textTracks
          .map((t) => str(t, "Language"))
          .filter((l): l is string => !!l),
      ),
    ],

    releaseType,
  };

  const discFacts = disc ? compareToDisc(base, disc) : undefined;
  const withDisc = { ...base, disc: discFacts };

  const issues = detectIssues(withDisc);

  // Each gap becomes an issue so it shows up in the same place as everything
  // else that is wrong with a file.
  if (discFacts) {
    for (const gap of discFacts.gaps) {
      if (gap.startsWith("A 4K disc exists")) {
        issues.push({
          code: "disc-better-resolution",
          severity: ISSUE_CATALOGUE["disc-better-resolution"].severity,
          message: gap + ".",
        });
      } else if (gap.startsWith("Disc has") && /Dolby Vision|HDR/.test(gap)) {
        issues.push({
          code: "disc-better-hdr",
          severity: ISSUE_CATALOGUE["disc-better-hdr"].severity,
          message: gap + ".",
        });
      } else if (gap.startsWith("Disc has")) {
        issues.push({
          code: "disc-better-audio",
          severity: ISSUE_CATALOGUE["disc-better-audio"].severity,
          message: gap + ".",
        });
      } else {
        issues.push({
          code: "disc-higher-bitrate",
          severity: ISSUE_CATALOGUE["disc-higher-bitrate"].severity,
          message: gap + ".",
        });
      }
    }
  }

  const lines = {
    video: videoLines(base),
    audio: audioLines(audioTracks),
    release: releaseLines(releaseType, bpp),
  };

  const scores = {
    video: total(lines.video),
    audio: total(lines.audio),
    release: total(lines.release),
    overall: 0,
  };

  const weighted =
    scores.video * WEIGHTS.video +
    scores.audio * WEIGHTS.audio +
    scores.release * WEIGHTS.release;
  const ceiling = scores.video + VIDEO_CEILING_BONUS;

  // Perfect audio in a perfect container cannot rescue a weak picture: a 1080p
  // SDR remux with TrueHD Atmos would otherwise outscore a good 4K HDR encode.
  const absolute = Math.round(Math.min(weighted, ceiling));

  // Where a disc is known, the score becomes how close this file gets to it.
  // A flawless copy of a modest disc is a 100 — there is nothing better to own.
  //
  // Compared dimension by dimension, each capped at parity, rather than as one
  // ratio of totals: otherwise a surplus in one dimension silently pays for a
  // deficit in another. A file with better audio than its disc but only HDR10
  // against the disc's Dolby Vision was scoring 100 while still listing that
  // gap — beating the disc on sound does not make you Dolby Vision.
  const discParts = disc?.best ? scoreDisc(disc.best) : undefined;
  const discScore = discFacts?.discScore;

  if (discParts && discScore && discScore > 0) {
    const share = (mine: number, theirs: number) =>
      theirs > 0 ? Math.min(1, mine / theirs) : 1;

    scores.overall = Math.round(
      100 *
        (share(scores.video, discParts.video) * WEIGHTS.video +
          share(scores.audio, discParts.audio) * WEIGHTS.audio +
          share(scores.release, discParts.release) * WEIGHTS.release),
    );
  } else {
    scores.overall = absolute;
  }

  const breakdown: Breakdown = {
    ...lines,
    relative: Boolean(discScore && discScore > 0),
    discScore,
    absolute,
    weighted: Math.round(weighted * 10) / 10,
    ceiling,
    cappedByVideo: ceiling < weighted,
  };

  // Set from the final score so "Best Available" and a sub-100 score can never
  // both be true — that contradiction is what made Brave look untouchable.
  if (discFacts) discFacts.bestAvailable = scores.overall >= 100;

  const { status, priority } = verdict(scores.overall, issues, discFacts);

  return {
    ...withDisc,
    issues,
    scores,
    breakdown,
    status,
    priority,
    reasons: explain({
      ...withDisc,
      issues,
      scores,
      breakdown,
      status,
      priority,
    }),
  };
}
