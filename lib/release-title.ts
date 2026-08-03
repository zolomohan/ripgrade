import {
  scoreFacts,
  STATUS_BANDS,
  type AudioTrack,
  type HdrKind,
  type ReleaseType,
  type ScorableFacts,
  type Status,
} from "./derive";

/**
 * Reading a release name as if it were a file.
 *
 * An indexer gives you a name and a byte count, and nothing else. Everywhere
 * else in this app a verdict comes from probing the actual video, so this is
 * the one place that guesses — and the guess is only worth making because
 * release names follow a convention strict enough to be parsed:
 *
 *   Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD.Atmos.7.1-FraMeSToR
 *
 * What comes out is scored through `scoreFacts`, the same rubric the library
 * uses, so a predicted 94 and a measured 94 mean the same thing and the two can
 * sit next to each other. What comes out is still a claim someone typed: a name
 * saying REMUX over an x265 encode is a lie this cannot detect, which is why
 * every score from here is labelled as predicted and `known` records which
 * dimensions were actually stated rather than assumed.
 */

export type ReleaseTags = {
  /** The film or show name, with the metadata stripped off. */
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  /** Set when the name covers a whole season rather than one episode. */
  seasonPack: boolean;
  edition?: string;
  /** The scene group, which is the part after the final dash. */
  group?: string;
  videoCodec?: string;
  repack: boolean;
  proper: boolean;
  /** A disc and a streaming source muxed together — usually for the DV layer. */
  hybrid: boolean;
};

/** Which dimensions the name actually stated, as opposed to defaulted to. */
export type KnownDimension = "resolution" | "hdr" | "release" | "audio";

export type ReleaseGuess = {
  tags: ReleaseTags;
  facts: ScorableFacts;
  /** An array rather than a Set so a guess survives the trip to the browser. */
  known: KnownDimension[];
  scores: { video: number; audio: number; release: number; overall: number };
  status: Status;
  /**
   * How much of the name we could actually read, 0–1. A bare "Dune 2024 1080p"
   * states one dimension out of four; ranking it against a name that states all
   * four needs that difference to be visible.
   */
  confidence: number;
};

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * Release names separate tokens with dots, spaces or underscores. Matching on
 * those boundaries rather than `\b` is what keeps "DV" from firing on the "dv"
 * inside a group name, and "NF" from firing inside "NFT".
 */
const token = (pattern: string) =>
  new RegExp(`(?:^|[.\\s_\\-\\[\\(])(?:${pattern})(?=$|[.\\s_\\-\\]\\)])`, "i");

const has = (name: string, pattern: string) => token(pattern).test(name);

/**
 * The same, but tolerating a channel count glued to the format: "DDP5.1" and
 * "DD5.1" are written without a separator far more often than with one.
 */
const hasAudio = (name: string, pattern: string) =>
  new RegExp(
    `(?:^|[.\\s_\\-\\[\\(])(?:${pattern})(?=$|[.\\s_\\-\\]\\)]|\\d)`,
    "i",
  ).test(name);

const RESOLUTIONS: [RegExp, ScorableFacts["resolution"]][] = [
  [token("2160p|4k|uhd"), "2160p"],
  [token("1080[pi]"), "1080p"],
  [token("720p"), "720p"],
  [token("576[pi]|480[pi]|dvdrip|dvd5|dvd9|ntsc|pal"), "SD"],
];

/**
 * Tags that name a streaming source. Deliberately the short service codes and
 * nothing else — the same restraint `classifyRelease` shows, and for the same
 * reason: a bare "max" matches "Mad Max".
 */
const WEB_SOURCES = "web-?dl|webrip|amzn|nf|dsnp|atvp|hmax|hulu|pcok";

// "UHD" and "4K" are resolution tokens, not source tokens — a UHD BluRay and a
// UHD WEB-DL are both 2160p, and only the second word says where it came from.
const DISC_SOURCES = "blu-?ray|bdrip|brrip|bdremux|bd25|bd50|bd66|bd100|dvdrip";

/**
 * Encoder signatures, not codec names. "x265" is a piece of software someone
 * ran; "HEVC" and "H.265" are what the stream is, and a remux and a WEB-DL are
 * both entitled to say so.
 */
const HOBBY_ENCODERS = "x264|x265|xvid|divx";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Everything from here on is metadata, not part of the title. */
const TAG_START =
  /(?:^|[.\s_])(2160p|1080[pi]|720p|576[pi]|480[pi]|4K|UHD|BluRay|Blu-ray|BDRip|BRRip|BDRemux|WEB-?DL|WEBRip|WEB|REMUX|HDTV|DVDRip|DVDScr|COMPLETE|REPACK|PROPER|LIMITED|EXTENDED|IMAX|HYBRID|S\d{2}(E\d{2})?)(?=$|[.\s_\-])/i;

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

/** S01E02 · S01 · Season 1 · 1x02 */
const EPISODE = /(?:^|[.\s_])s(\d{1,2})(?:e(\d{1,3}))?(?=$|[.\s_\-])/i;
const SEASON_WORD = /(?:^|[.\s_])season[.\s_]*(\d{1,2})(?=$|[.\s_\-])/i;
const NUMERIC_EPISODE = /(?:^|[.\s_])(\d{1,2})x(\d{2})(?=$|[.\s_\-])/i;

/**
 * The trailing `-GROUP`, which is the only reliable marker of who made the
 * release. Rejected when it looks like a resolution or a codec, because a name
 * ending "…-1080p" has no group at all.
 */
function groupOf(name: string): string | undefined {
  const match = name.match(/-([A-Za-z0-9_.]{2,})(?:\.[a-z0-9]{2,4})?$/);
  if (!match) return undefined;

  const candidate = match[1].replace(/\.(mkv|mp4|avi|m2ts|ts)$/i, "");
  if (
    /^(1080p?|720p?|2160p?|4k|uhd|hdr|dv|x26[45]|h26[45]|remux|bluray|web|dl|repack|proper)$/i.test(
      candidate,
    )
  ) {
    return undefined;
  }
  return candidate;
}

function titleAndYear(name: string): { title: string; year?: number } {
  // Strip a trailing group first, so a group with a year in its name cannot be
  // mistaken for the film's year.
  const group = groupOf(name);
  let base = group ? name.slice(0, name.lastIndexOf(`-${group}`)) : name;
  base = base.replace(/\.(mkv|mp4|avi|m2ts|ts)$/i, "");

  // `20\d{2}` also matches the 2160 in "2160p", so resolution tags are excluded.
  // The last candidate wins: "Blade Runner 2049 2017" releases in 2017.
  const years = [
    ...base.matchAll(/(?:^|[.\s_(\[])((?:19|20)\d{2})(?=$|[.\s_)\]])/g),
  ]
    // `new Date()` would make this impure and untestable; releases are never
    // more than a year or so ahead of the film, and 2099 is a safe ceiling.
    .filter((m) => Number(m[1]) <= 2099);
  const yearMatch = years.length > 0 ? years[years.length - 1] : undefined;

  let head = yearMatch ? base.slice(0, yearMatch.index) : base;
  const tagMatch = head.match(TAG_START);
  if (tagMatch?.index !== undefined) head = head.slice(0, tagMatch.index);

  const title = head
    .replace(/[._]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/[-([{\s]+$/, "")
    .trim();

  return { title, year: yearMatch ? Number(yearMatch[1]) : undefined };
}

function editionOf(name: string): string | undefined {
  return EDITIONS.find((e) =>
    new RegExp(
      `(?:^|[.\\s_])${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s/g, "[.\\s_]")}(?=$|[.\\s_\\-])`,
      "i",
    ).test(name),
  );
}

function resolutionOf(name: string): {
  resolution: ScorableFacts["resolution"];
  stated: boolean;
} {
  for (const [pattern, resolution] of RESOLUTIONS) {
    if (pattern.test(name)) return { resolution, stated: true };
  }
  return { resolution: "unknown", stated: false };
}

function hdrOf(name: string): {
  hdr: HdrKind;
  dvProfile?: number;
  stated: boolean;
} {
  // Checked strongest first: a name reading "DV.HDR10" is a Dolby Vision
  // release advertising its fallback layer, not an HDR10 one.
  if (has(name, "dv|dovi|dolby.?vision|dolbyvision")) {
    // Profile 5 is the streaming-only single-layer encoding, and names that
    // bother to say so are the ones worth knowing about.
    const profile = name.match(
      /(?:^|[.\s_])dvhe\.(\d{2})|(?:^|[.\s_])p([578])(?=$|[.\s_\-])/i,
    );
    return {
      hdr: "Dolby Vision",
      dvProfile: profile ? Number(profile[1] ?? profile[2]) : undefined,
      stated: true,
    };
  }
  if (has(name, "hdr10\\+|hdr10plus|hdrplus|hdr\\+")) {
    return { hdr: "HDR10+", stated: true };
  }
  if (has(name, "hdr10|hdr|hlg|pq")) return { hdr: "HDR10", stated: true };
  return { hdr: "SDR", stated: false };
}

/**
 * Ordered the way `classifyRelease` orders its equivalent checks on a real
 * file: the source tag first, then the encoder, and only then the disc tags.
 */
function releaseOf(name: string): { type: ReleaseType; stated: boolean } {
  if (has(name, WEB_SOURCES)) return { type: "WEB-DL", stated: true };

  // A name claiming REMUX over x265 is claiming one stream both copied and
  // re-compressed. Having run an encoder is the harder fact, so it wins.
  if (has(name, HOBBY_ENCODERS)) return { type: "ENCODE", stated: true };

  if (has(name, "remux|bdremux")) return { type: "REMUX", stated: true };
  if (has(name, DISC_SOURCES)) return { type: "ENCODE", stated: true };

  // Last, because "Charlotte's Web" is a film and "WEB" is also a tag. By this
  // point a disc tag would have claimed it, so what is left really is a pull.
  if (has(name, "web")) return { type: "WEB-DL", stated: true };
  if (has(name, "hdtv")) return { type: "ENCODE", stated: true };

  return { type: "UNKNOWN", stated: false };
}

// --- Audio ------------------------------------------------------------------

/**
 * The single best track the name mentions.
 *
 * The rubric already scores only the best track, so there is no point trying to
 * reconstruct the full list — and a name that says "TrueHD.Atmos.7.1.DD5.1"
 * is listing a fallback, not a better option.
 */
function audioOf(name: string): { audio: AudioTrack[]; stated: boolean } {
  const atmos = has(name, "atmos");
  const dtsx = has(name, "dts-?x");

  const channels = name.match(/(?:^|[.\s_])([1-9])[.\s_]([01])(?=$|[.\s_\-])/);
  const channelCount = channels
    ? Number(channels[1]) + Number(channels[2])
    : undefined;

  const formats: [string, string, boolean][] = [
    // [pattern, label, lossless]
    ["truehd|true-?hd", "TrueHD", true],
    ["dts-?hd[.\\s_-]?ma|dtshd[.\\s_-]?ma|dts-?ma", "DTS-HD MA", true],
    ["dts-?x", "DTS:X", true],
    ["flac", "FLAC", true],
    ["lpcm|pcm", "LPCM", true],
    ["dts-?hd[.\\s_-]?hra?|dts-?hr", "DTS-HD HRA", false],
    ["e-?ac-?3|ddp|dd\\+|eac3", "E-AC-3", false],
    ["dts-?es|dts", "DTS", false],
    ["ac-?3|dd(?![p+])", "AC-3", false],
    ["aac", "AAC", false],
    ["opus", "Opus", false],
    ["mp3", "MP3", false],
  ];

  const found = formats.find(([pattern]) => hasAudio(name, pattern));

  if (!found && !atmos && !dtsx) {
    // Nothing stated. An empty list would score zero for audio and drag the
    // overall down as if the release were silent, so a mid-range lossy 5.1 —
    // what an unlabelled release almost always turns out to be — stands in.
    return {
      audio: [
        {
          label: "Assumed 5.1",
          format: "unknown",
          channels: 6,
          lossless: false,
          atmos: false,
          dtsx: false,
        },
      ],
      stated: false,
    };
  }

  const [, label, lossless] = found ?? ["", "TrueHD", true];

  return {
    audio: [
      {
        label,
        format: label,
        // Atmos is carried on TrueHD and is 7.1 far more often than not; an
        // unstated channel count on a lossless track is not 2.0.
        channels: channelCount ?? (atmos || dtsx ? 8 : lossless ? 6 : 6),
        lossless,
        atmos,
        dtsx,
      },
    ],
    stated: true,
  };
}

// --- Bitrate ----------------------------------------------------------------

const PIXELS: Record<ScorableFacts["resolution"], number> = {
  "2160p": 3840 * 2160,
  "1080p": 1920 * 1080,
  "720p": 1280 * 720,
  SD: 720 * 480,
  unknown: 0,
};

/** Nearly every film is 23.976; the error from assuming it is small. */
const ASSUMED_FPS = 24;

/** Rough overheads subtracted before the video bitrate is inferred. */
const AUDIO_KBPS = { lossless: 3500, lossy: 640 };

/**
 * Bits per pixel per frame, inferred from the file size.
 *
 * The rubric grades encodes on this, and an indexer does give a byte count — so
 * the one number that separates a good 4K encode from a bad one is recoverable
 * as long as the runtime is known. It is an estimate twice over: the audio
 * overhead is assumed, and a release carrying five dub tracks will look denser
 * than it is. Returns undefined rather than a bad number when the runtime is
 * unknown, which leaves the rubric scoring it as "bitrate unknown".
 */
export function estimateBpp(
  resolution: ScorableFacts["resolution"],
  audio: AudioTrack[],
  sizeBytes?: number,
  runtimeMinutes?: number,
): number | undefined {
  const pixels = PIXELS[resolution];
  if (!sizeBytes || !runtimeMinutes || !pixels) return undefined;

  const totalKbps = (sizeBytes * 8) / (runtimeMinutes * 60) / 1000;
  const overhead = audio.some((t) => t.lossless)
    ? AUDIO_KBPS.lossless
    : AUDIO_KBPS.lossy;

  const videoKbps = totalKbps - overhead;
  if (videoKbps <= 0) return undefined;

  return (videoKbps * 1000) / (pixels * ASSUMED_FPS);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Splits a release name into its parts without scoring it. */
export function parseReleaseTitle(name: string): ReleaseTags {
  const { title, year } = titleAndYear(name);

  const episodeMatch = name.match(EPISODE);
  const numeric = name.match(NUMERIC_EPISODE);
  const seasonWord = name.match(SEASON_WORD);

  const season = episodeMatch
    ? Number(episodeMatch[1])
    : numeric
      ? Number(numeric[1])
      : seasonWord
        ? Number(seasonWord[1])
        : undefined;

  const episode = episodeMatch?.[2]
    ? Number(episodeMatch[2])
    : numeric
      ? Number(numeric[2])
      : undefined;

  const codec = name.match(
    /(?:^|[.\s_])(x26[45]|h\.?26[45]|hevc|avc|av1|vp9|xvid|divx)(?=$|[.\s_\-])/i,
  );

  return {
    title,
    year,
    season,
    episode,
    seasonPack: season !== undefined && episode === undefined,
    edition: editionOf(name),
    group: groupOf(name),
    videoCodec: codec ? codec[1].toUpperCase() : undefined,
    repack: has(name, "repack"),
    proper: has(name, "proper"),
    hybrid: has(name, "hybrid"),
  };
}

/**
 * A release name and a byte count, scored on the library's own rubric.
 *
 * `runtimeMinutes` is what makes an encode's score meaningful — without it the
 * bitrate cannot be inferred and every encode lands on the same "bitrate
 * unknown" points. Pass TMDb's runtime whenever the caller knows the film.
 */
export function guessFromTitle(
  name: string,
  options: { sizeBytes?: number; runtimeMinutes?: number } = {},
): ReleaseGuess {
  const tags = parseReleaseTitle(name);

  const { resolution, stated: resolutionStated } = resolutionOf(name);
  const { hdr, dvProfile, stated: hdrStated } = hdrOf(name);
  const { type: releaseType, stated: releaseStated } = releaseOf(name);
  const { audio, stated: audioStated } = audioOf(name);

  // A season pack's size covers every episode in it, so dividing it by one
  // episode's runtime would report a bitrate several times too high.
  const sizeBytes = tags.seasonPack ? undefined : options.sizeBytes;

  const facts: ScorableFacts = {
    resolution,
    hdr,
    dvProfile,
    releaseType,
    // HDR is 10-bit by definition, so a name that states one states the other.
    bitDepth: hdr !== "SDR" ? 10 : has(name, "10-?bit") ? 10 : undefined,
    bpp: estimateBpp(resolution, audio, sizeBytes, options.runtimeMinutes),
    audio,
  };

  const known: KnownDimension[] = [];
  if (resolutionStated) known.push("resolution");
  if (hdrStated) known.push("hdr");
  if (releaseStated) known.push("release");
  if (audioStated) known.push("audio");

  const { scores } = scoreFacts(facts);
  const band = STATUS_BANDS.find((b) => scores.overall >= b.min);

  return {
    tags,
    facts,
    known,
    scores,
    status: band?.status ?? "Must Upgrade",
    confidence: known.length / 4,
  };
}
