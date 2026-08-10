import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSUMED_BL_PEAK,
  EL_BRIGHTNESS_MARGIN,
  ISSUE_CATALOGUE,
  RUNTIME_DRIFT,
  STATUS_BANDS,
  classifyEnhancementLayer,
  derive,
  languageName,
  openIssues,
  parseEpisode,
  parseName,
  runtimeDrift,
  scoreDisc,
  titleKey,
  type DoviScan,
} from "../lib/derive";

// ---------------------------------------------------------------------------
// Duplicate grouping
// ---------------------------------------------------------------------------

test("the same film groups despite differing quality tokens", () => {
  // A real case: one copy's container title read "Skyfall (2012) 4K".
  assert.equal(titleKey("Skyfall", 2012), titleKey("Skyfall (2012) 4K", 2012));
});

test("a year in the title still separates different films", () => {
  assert.notEqual(titleKey("Blade Runner", 1982), titleKey("Blade Runner 2049", 2017));
});

// ---------------------------------------------------------------------------
// Invariants the How it works page renders from
// ---------------------------------------------------------------------------

test("each sub-score equals the sum of its breakdown lines", () => {
  // The detail page presents the lines as the explanation for the score, so a
  // score computed by any other route would be a lie.
  const d = derive(
    "/m/Test/Test.2020.2160p.BluRay.REMUX.mkv",
    50e9,
    {
      media: {
        track: [
          { "@type": "General", Duration: "7200", Encoded_Application: "mkvmerge" },
          {
            "@type": "Video",
            Width: "3840",
            Height: "2160",
            FrameRate: "23.976",
            Format: "HEVC",
            BitDepth: "10",
            HDR_Format: "SMPTE ST 2086",
          },
          {
            "@type": "Audio",
            Format: "DTS",
            Format_Commercial_IfAny: "DTS-HD Master Audio",
            Channels: "6",
          },
        ],
      },
    },
  );

  const sum = (lines: { points: number }[]) =>
    lines.reduce((t, l) => t + l.points, 0);

  assert.equal(sum(d.breakdown.video), d.scores.video);
  assert.equal(sum(d.breakdown.audio), d.scores.audio);
  assert.equal(sum(d.breakdown.release), d.scores.release);

  // "Out of 100" must be literally true, or the headroom figures mislead.
  const max = (lines: { max: number }[]) => lines.reduce((t, l) => t + l.max, 0);
  assert.equal(max(d.breakdown.video), 100);
  assert.equal(max(d.breakdown.audio), 100);
  assert.equal(max(d.breakdown.release), 100);
});

test("the video ceiling is reported when it binds", () => {
  const d = derive(
    "/m/LOTR/The.Two.Towers.2002.1080p.BluRay.REMUX.mkv",
    30e9,
    {
      media: {
        track: [
          { "@type": "General", Duration: "7200", Encoded_Application: "mkvmerge" },
          { "@type": "Video", Width: "1920", Height: "1080", FrameRate: "23.976", Format: "AVC" },
          {
            "@type": "Audio",
            Format: "MLP FBA",
            Format_Commercial_IfAny: "Dolby TrueHD with Dolby Atmos",
            Channels: "8",
          },
        ],
      },
    },
  );

  assert.equal(d.breakdown.cappedByVideo, true);
  assert.ok(d.breakdown.weighted > d.breakdown.ceiling);
  assert.equal(d.scores.overall, d.breakdown.ceiling);
});

// ---------------------------------------------------------------------------
// TMDb runtime cross-check
// ---------------------------------------------------------------------------

/** A plain 2160p remux whose duration is set by the caller. */
function withDuration(seconds: number) {
  return {
    media: {
      track: [
        { "@type": "General", Duration: String(seconds), Encoded_Application: "mkvmerge" },
        { "@type": "Video", Width: "3840", Height: "2160", FrameRate: "23.976", Format: "HEVC" },
        { "@type": "Audio", Format: "MLP FBA", Channels: "8" },
      ],
    },
  };
}

const facts = (
  runtimeMinutes: number,
  confidence: "high" | "medium" | "low" = "high",
) => ({ id: 1, title: "Test", runtimeMinutes, confidence });

test("a matching runtime raises nothing", () => {
  const d = derive("/m/T/T.2020.mkv", 40e9, withDuration(120 * 60), facts(120));
  assert.ok(!d.issues.some((i) => i.code.startsWith("runtime-")));
});

test("an extended cut is flagged as longer, and says so", () => {
  const d = derive(
    "/m/T/T.2020.Extended.mkv",
    40e9,
    withDuration(150 * 60),
    facts(120),
  );
  const issue = d.issues.find((i) => i.code === "runtime-longer");
  assert.ok(issue);
  assert.match(issue!.message, /Extended/);
  // Informational only: a longer cut is not a defect.
  assert.equal(issue!.severity, "info");
});

test("confirming the extended cut answers the length, and nothing else", () => {
  const d = derive("/m/T/T.2020.mkv", 40e9, withDuration(150 * 60), facts(120));
  // Something else wrong with the same file, to prove the answer is narrow.
  const issues = [
    ...d.issues,
    { code: "no-audio", severity: "critical" as const, message: "No audio." },
  ];

  assert.ok(issues.some((i) => i.code === "runtime-longer"));

  const open = openIssues({ issues, extendedCut: true });
  assert.ok(!open.some((i) => i.code === "runtime-longer"));
  assert.ok(open.some((i) => i.code === "no-audio"));
});

test("answering no leaves the length standing", () => {
  const d = derive("/m/T/T.2020.mkv", 40e9, withDuration(150 * 60), facts(120));
  // The distinction the stored answer exists for: "no" must read as the
  // unanswered question does, not as an acceptance of the file.
  assert.deepEqual(openIssues({ issues: d.issues, extendedCut: false }), d.issues);
  assert.deepEqual(openIssues({ issues: d.issues }), d.issues);
});

test("a badly short file is critical", () => {
  const d = derive("/m/T/T.2020.mkv", 40e9, withDuration(60 * 60), facts(120));
  assert.ok(d.issues.some((i) => i.code === "runtime-truncated"));
  assert.equal(d.status, "Must Upgrade");
});

test("a 4% PAL speed-up does not trip the shorter check", () => {
  // 25fps PAL transfers legitimately run ~4% short of the listed runtime.
  const d = derive("/m/T/T.1990.mkv", 40e9, withDuration(120 * 60 * 0.96), facts(120));
  assert.ok(!d.issues.some((i) => i.code.startsWith("runtime-")));
});

test("runtime is not checked on a low-confidence match", () => {
  // The whole point: a wrong film would invent a convincing discrepancy.
  const d = derive(
    "/m/T/T.2020.mkv",
    40e9,
    withDuration(60 * 60),
    facts(120, "low"),
  );
  assert.ok(!d.issues.some((i) => i.code.startsWith("runtime-")));
});

test("a high-confidence match overrides the parsed title", () => {
  const d = derive(
    "/m/T/Some.Badly.Named.File.2020.mkv",
    40e9,
    withDuration(120 * 60),
    { id: 9, title: "The Real Title", year: 1999, confidence: "high" },
  );
  assert.equal(d.title, "The Real Title");
  assert.equal(d.year, 1999);
});

test("a low-confidence match leaves the parsed title alone", () => {
  const d = derive(
    "/m/T/Ford.v.Ferrari.2019.mkv",
    40e9,
    withDuration(120 * 60),
    { id: 9, title: "Wrong Film", year: 1999, confidence: "low" },
  );
  assert.equal(d.title, "Ford v Ferrari");
  assert.equal(d.year, 2019);
});

test("status bands descend and reach zero", () => {
  // The page derives each band's upper bound from the previous entry's min, so
  // an out-of-order or gapped list would render nonsense ranges.
  const mins = STATUS_BANDS.map((b) => b.min);
  assert.deepEqual(mins, [...mins].sort((a, b) => b - a));
  assert.equal(mins.at(-1), 0);
});

test("issue severities come from the catalogue, not the call site", () => {
  const d = derive(
    "/m/Fake/Fake.2015.2160p.mkv",
    10e9,
    {
      media: {
        track: [
          { "@type": "General", Duration: "7200" },
          { "@type": "Video", Width: "3840", Height: "2160", FrameRate: "23.976", Format: "AVC" },
        ],
      },
    },
  );
  const raised = d.issues.find((i) => i.code === "fake-4k");
  assert.equal(raised?.severity, ISSUE_CATALOGUE["fake-4k"].severity);
});

// ---------------------------------------------------------------------------
// Filename parsing
// ---------------------------------------------------------------------------

test("takes the release year, not the resolution tag", () => {
  // `20\d{2}` matches the 2160 in 2160p if the pattern is careless.
  const r = parseName("Insidious 2010 UHD 4K BluRay 2160p HDR DoVi.mkv", "Insidious");
  assert.equal(r.year, 2010);
});

test("prefers the last year when the title contains one", () => {
  const r = parseName("Blade Runner 2049 2017 2160p UHD BluRay.mkv", "Blade Runner 2049");
  assert.equal(r.year, 2017);
  assert.equal(r.title, "Blade Runner 2049");
});

test("strips release tags from the title", () => {
  const r = parseName("Ford.v.Ferrari.2019.UHD.BluRay.2160p.REMUX-FraMeSToR.mkv", "Ford v Ferrari");
  assert.equal(r.title, "Ford v Ferrari");
  assert.equal(r.year, 2019);
});

test("falls back to the folder name when the file has no year or tags", () => {
  const r = parseName("Troy Directors Cut.mkv", "Troy");
  assert.equal(r.title, "Troy");
  assert.equal(r.year, undefined);
  assert.equal(r.edition, "Directors Cut");
});

test("restores the colon that exFAT-safe folder names replace", () => {
  const r = parseName("movie.mkv", "Mad Max꞉ Fury Road");
  assert.equal(r.title, "Mad Max: Fury Road");
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

type FakeTrack = Record<string, string | Record<string, string>>;

function mediainfo(
  general: FakeTrack,
  video: FakeTrack,
  audio: FakeTrack[] = [],
  text: FakeTrack[] = [],
) {
  return {
    media: {
      track: [
        { "@type": "General", Duration: "7200", ...general },
        { "@type": "Video", Width: "3840", Height: "2160", FrameRate: "23.976", ...video },
        ...audio.map((a) => ({ "@type": "Audio", ...a })),
        ...text.map((t) => ({ "@type": "Text", ...t })),
      ],
    },
  };
}

test("no encoder library on the video stream means remux", () => {
  const d = derive(
    "/m/Titanic/Titanic.1997.UHD.BluRay.2160p.REMUX.mkv",
    70e9,
    mediainfo({ Encoded_Application: "mkvmerge v99.0" }, { Format: "HEVC" }),
  );
  assert.equal(d.releaseType, "REMUX");
});

test("a professional encoder on a disc release is still a remux", () => {
  // Studio UHD masters are cut on ATEME, and the remux inherits that string.
  const d = derive(
    "/m/300/300.2006.2160p.BluRay.REMUX.DV.HDR.mkv",
    50e9,
    mediainfo({ Encoded_Application: "mkvmerge v99.0" }, { Format: "HEVC", Encoded_Library: "ATEME Titan File" }),
  );
  assert.equal(d.releaseType, "REMUX");
});

test("a professional encoder without a disc tag is a web pull", () => {
  const d = derive(
    "/m/Abyss/The.Abyss.1989.2160p.AMZN.WEB-DL.DDP5.1.mkv",
    20e9,
    mediainfo({}, { Format: "HEVC", Encoded_Library: "ATEME Titan File" }),
  );
  assert.equal(d.releaseType, "WEB-DL");
});

test("x265 beats a REMUX tag in the filename", () => {
  const d = derive(
    "/m/Fake/Fake.2020.2160p.REMUX.mkv",
    8e9,
    mediainfo({}, { Format: "HEVC", Encoded_Library: "x265 - 3.5" }),
  );
  assert.equal(d.releaseType, "ENCODE");
});

test("'Mad Max' is not mistaken for an HBO Max release", () => {
  const d = derive(
    "/m/Mad Max/Mad.Max.Fury.Road.2015.BluRay.REMUX.DV.HDR.mkv",
    60e9,
    mediainfo({ Encoded_Application: "mkvmerge v99.0" }, { Format: "HEVC" }),
  );
  assert.equal(d.releaseType, "REMUX");
});

test("an unrecognised encoder is flagged as a likely fan hybrid", () => {
  const d = derive(
    "/m/Memento/Memento.2000.2160p.HDR.AI.Enhanced.mkv",
    15e9,
    mediainfo({}, { Format: "HEVC", Encoded_Library: "4K-HDR.by.BLKFLX" }),
  );
  assert.equal(d.releaseType, "UNKNOWN");
  assert.ok(d.issues.some((i) => i.code === "custom-encoder"));
});

// ---------------------------------------------------------------------------
// Resolution, HDR and issues
// ---------------------------------------------------------------------------

test("scope films are classified on width, not height", () => {
  // 3840x1600 is a 2.40:1 UHD transfer, not a 1080p one.
  const d = derive(
    "/m/Dune/Dune.2021.2160p.mkv",
    50e9,
    mediainfo({}, { Format: "HEVC", Width: "3840", Height: "1600" }),
  );
  assert.equal(d.resolution, "2160p");
});

test("Dolby Vision profile and HDR10 fallback are read from the HDR fields", () => {
  const d = derive(
    "/m/Dune/Dune.2021.2160p.mkv",
    50e9,
    mediainfo({}, {
      Format: "HEVC",
      HDR_Format: "Dolby Vision / SMPTE ST 2086",
      HDR_Format_Profile: "dvhe.07 / ",
      HDR_Format_Compatibility: "HDR10 / HDR10",
    }),
  );
  assert.equal(d.hdr, "Dolby Vision");
  assert.equal(d.dvProfile, 7);
  assert.equal(d.dvHasHdr10Fallback, true);
  assert.ok(d.issues.some((i) => i.code === "dv-profile-7"));
});

test("2160p AVC is reported as an upscale", () => {
  const d = derive(
    "/m/Fake/Fake.2015.2160p.mkv",
    10e9,
    mediainfo({}, { Format: "AVC", BitDepth: "8" }),
  );
  assert.ok(d.issues.some((i) => i.code === "fake-4k"));
  assert.equal(d.status, "Must Upgrade");
});

test("an Atmos claim with no Atmos track is flagged", () => {
  const d = derive(
    "/m/Fake/Fake.2015.2160p.TrueHD.Atmos.mkv",
    10e9,
    mediainfo({}, { Format: "HEVC" }, [{ Format: "MLP FBA", Channels: "8" }]),
  );
  assert.ok(d.issues.some((i) => i.code === "atmos-mislabelled"));
});

test("perfect audio cannot lift a 1080p SDR file into the top tier", () => {
  const d = derive(
    "/m/LOTR/The.Two.Towers.2002.1080p.BluRay.REMUX.mkv",
    30e9,
    mediainfo({ Encoded_Application: "mkvmerge" }, { Format: "AVC", Width: "1920", Height: "1080" }, [
      { Format: "MLP FBA", Format_Commercial_IfAny: "Dolby TrueHD with Dolby Atmos", Channels: "8" },
    ]),
  );
  assert.equal(d.scores.audio, 100);
  assert.equal(d.scores.release, 100);
  assert.ok(d.scores.overall < 75, `expected capped score, got ${d.scores.overall}`);
});

// ---------------------------------------------------------------------------
// Subtitle tracks
// ---------------------------------------------------------------------------

test("text tracks are read per track, and the language list follows them", () => {
  const d = derive(
    "/m/Arrival/Arrival.2016.2160p.mkv",
    50e9,
    mediainfo({}, { Format: "HEVC" }, [], [
      { Format: "PGS", Language: "en", Default: "Yes", ElementCount: "1420" },
      { Format: "PGS", Language: "en", Title: "English SDH" },
      { Format: "UTF-8", Language: "fr", Forced: "Yes", Title: "Forced" },
      { Format: "PGS", Language: "en" },
    ]),
  );

  assert.equal(d.subtitles?.length, 4);
  assert.deepEqual(d.subtitles?.[0], {
    format: "PGS",
    language: "en",
    title: undefined,
    forced: false,
    default: true,
    sdh: false,
    cues: 1420,
  });
  // An SRT is only "UTF-8" to MediaInfo.
  assert.equal(d.subtitles?.[2].format, "SubRip");
  assert.equal(d.subtitles?.[2].forced, true);
  assert.equal(d.subtitles?.[1].sdh, true);
  // Deduped, in the order the file lists them.
  assert.deepEqual(d.subtitleLanguages, ["en", "fr"]);
});

test("a track named for the hearing is SDH; one merely named 'Hi there' is not", () => {
  const d = derive(
    "/m/Heat/Heat.1995.2160p.mkv",
    40e9,
    mediainfo({}, { Format: "HEVC" }, [], [
      { Format: "PGS", Language: "en", Title: "Closed Captions" },
      { Format: "PGS", Language: "en", Title: "Hi there, commentary" },
    ]),
  );
  assert.equal(d.subtitles?.[0].sdh, true);
  assert.equal(d.subtitles?.[1].sdh, false);
});

test("language codes are shown by name, whichever spelling the muxer used", () => {
  assert.equal(languageName("en"), "English");
  assert.equal(languageName("eng"), "English");
  assert.equal(languageName("pt-BR"), "Brazilian Portuguese");
  // Nothing to name it by: the code itself is more use than "root".
  assert.equal(languageName("und"), "und");
  // Malformed tags throw inside Intl rather than falling back.
  assert.equal(languageName("en_US"), "en_US");
});

test("a file with no text tracks has an empty subtitle list, not a missing one", () => {
  const d = derive("/m/Fake/Fake.2020.2160p.mkv", 10e9, mediainfo({}, { Format: "HEVC" }));
  assert.deepEqual(d.subtitles, []);
  assert.deepEqual(d.subtitleLanguages, []);
});

// ---------------------------------------------------------------------------
// Audio tracks: what identifies one, and what it costs
// ---------------------------------------------------------------------------

test("an audio track carries the two numberings its tools use", () => {
  // MediaInfo counts every stream from zero in StreamOrder — which is what
  // mkvmerge calls a track ID — and numbers Matroska tracks from one in ID,
  // which mkvmerge reports as `properties.number`. Removing the right track
  // rests on not confusing the two, so both are kept under their own name.
  const d = derive(
    "/m/Dune/Dune.2021.2160p.BluRay.REMUX.mkv",
    60e9,
    mediainfo({}, { Format: "HEVC", StreamOrder: "0", ID: "1" }, [
      { StreamOrder: "1", ID: "2", Format: "MLP FBA", Language: "en" },
      { StreamOrder: "2", ID: "3", Format: "AC-3", Language: "fr" },
    ]),
  );

  assert.equal(d.audio[0].id, 1);
  assert.equal(d.audio[0].number, 2);
  assert.equal(d.audio[1].id, 2);
  assert.equal(d.audio[1].number, 3);
});

test("a counted stream size is taken as it stands", () => {
  const d = derive(
    "/m/Dune/Dune.2021.2160p.mkv",
    60e9,
    mediainfo({}, { Format: "HEVC" }, [
      { Format: "MLP FBA", StreamSize: "5492714864", BitRate: "7827129", Duration: "5614" },
    ]),
  );

  assert.equal(d.audio[0].sizeBytes, 5492714864);
  assert.equal(d.audio[0].sizeEstimated, false);
});

test("a track MediaInfo could not count falls back to bitrate × runtime", () => {
  // A VBR track it did not fully parse reports no size at all. The estimate is
  // near enough to decide whether the track is worth keeping, and says so.
  const d = derive(
    "/m/Dune/Dune.2021.2160p.mkv",
    60e9,
    mediainfo({}, { Format: "HEVC" }, [
      { Format: "FLAC", BitRate: "1000000", Duration: "3600" },
    ]),
  );

  assert.equal(d.audio[0].sizeBytes, 450e6);
  assert.equal(d.audio[0].sizeEstimated, true);
});

test("a track with neither a size nor a bitrate reports no size at all", () => {
  // Not zero: the page words an unknown as "at least", and a silent zero would
  // promise a figure the file cannot be held to.
  const d = derive(
    "/m/Dune/Dune.2021.2160p.mkv",
    60e9,
    mediainfo({}, { Format: "HEVC" }, [{ Format: "AAC", Duration: "3600" }]),
  );

  assert.equal(d.audio[0].sizeBytes, undefined);
  assert.equal(d.audio[0].sizeEstimated, undefined);
});

test("an audio track's name and flags are read the way a subtitle's are", () => {
  const d = derive(
    "/m/Alien/Alien.1979.2160p.mkv",
    40e9,
    mediainfo({}, { Format: "HEVC" }, [
      { Format: "MLP FBA", Language: "en", Default: "Yes" },
      { Format: "AC-3", Language: "en", Title: "Commentary by Ridley Scott" },
    ]),
  );

  assert.equal(d.audio[0].default, true);
  assert.equal(d.audio[0].forced, false);
  assert.equal(d.audio[0].title, undefined);
  assert.equal(d.audio[1].title, "Commentary by Ridley Scott");
  assert.equal(d.audio[1].default, false);
});

// ---------------------------------------------------------------------------
// Enhancement layer classification
//
// The numbers are from real files: The Godfather is a 4000-nit grade over a
// 1000-nit base layer, La La Land measures 1500 nits over the same, and Dune
// declares its own MaxCLL rather than leaving it to the default.
// ---------------------------------------------------------------------------

const rpu = (over: Partial<DoviScan> = {}): DoviScan => ({
  depth: "full",
  scannedAt: 0,
  frames: 100000,
  profile: 7,
  elType: "FEL",
  summary: "",
  ...over,
});

test("a MEL is safe whatever the brightness figures say", () => {
  const v = classifyEnhancementLayer(
    rpu({ elType: "MEL", l1: { maxCll: 4000, maxFall: 90 } }),
    { maxCll: 1000 },
  );
  assert.equal(v?.kind, "mel");
  assert.equal(v?.provisional, false);
});

test("a FEL grading above the base layer is brightness expansion", () => {
  const v = classifyEnhancementLayer(
    rpu({ l1: { maxCll: 4008.77, maxFall: 92.36 } }),
    { masteringMax: 1000 },
  );
  assert.equal(v?.kind, "complex-fel");
  // No MaxCLL in the file, so the base layer peak is the assumed default.
  assert.equal(v?.blPeak, ASSUMED_BL_PEAK);
  assert.equal(v?.blPeakAssumed, true);
});

test("a FEL inside the base layer's range is only refinement", () => {
  const v = classifyEnhancementLayer(rpu({ l1: { maxCll: 708, maxFall: 12 } }), {
    maxCll: 1000,
  });
  assert.equal(v?.kind, "simple-fel");
  assert.equal(v?.blPeakAssumed, false);
});

test("the margin is inclusive at its edge", () => {
  const at = classifyEnhancementLayer(
    rpu({ l1: { maxCll: 1000 + EL_BRIGHTNESS_MARGIN, maxFall: 10 } }),
    { maxCll: 1000 },
  );
  const over = classifyEnhancementLayer(
    rpu({ l1: { maxCll: 1000 + EL_BRIGHTNESS_MARGIN + 0.01, maxFall: 10 } }),
    { maxCll: 1000 },
  );
  assert.equal(at?.kind, "simple-fel");
  assert.equal(over?.kind, "complex-fel");
});

test("a declared MaxCLL below 100 nits is not believed", () => {
  // Some muxers write 0. Falling back to the default is what stops that
  // turning every FEL into brightness expansion.
  const v = classifyEnhancementLayer(rpu({ l1: { maxCll: 900, maxFall: 10 } }), {
    maxCll: 0,
  });
  assert.equal(v?.blPeak, ASSUMED_BL_PEAK);
  assert.equal(v?.kind, "simple-fel");
});

test("a clean sample is provisional but a dirty one is conclusive", () => {
  // Finding expansion in 300 frames proves it exists; not finding it proves
  // only that the opening is clean.
  const clean = classifyEnhancementLayer(
    rpu({ depth: "head", frames: 301, l1: { maxCll: 700, maxFall: 10 } }),
    { maxCll: 1000 },
  );
  const dirty = classifyEnhancementLayer(
    rpu({ depth: "head", frames: 301, l1: { maxCll: 4000, maxFall: 10 } }),
    { maxCll: 1000 },
  );
  assert.equal(clean?.provisional, true);
  assert.equal(dirty?.provisional, false);
});

test("nothing is claimed without a reading, or for other profiles", () => {
  assert.equal(classifyEnhancementLayer(undefined, { maxCll: 1000 }), undefined);
  assert.equal(classifyEnhancementLayer(rpu({ profile: 8 }), {}), undefined);
  // A FEL with no measured light level cannot be judged either way.
  assert.equal(classifyEnhancementLayer(rpu({ l1: undefined }), {})?.kind, "unknown");
});

test("the Profile 7 issue text names what a conversion would cost", () => {
  const d = derive(
    "/m/GF/The.Godfather.1972.2160p.BluRay.REMUX.mkv",
    90e9,
    mediainfo(
      {},
      {
        Format: "HEVC",
        HDR_Format: "Dolby Vision",
        HDR_Format_Profile: "dvhe.07 / ",
        HDR_Format_Compatibility: "HDR10",
      },
    ),
    undefined,
    undefined,
    rpu({ l1: { maxCll: 4008.77, maxFall: 92.36 } }),
  );
  const issue = d.issues.find((i) => i.code === "dv-profile-7");
  assert.ok(issue?.message.includes("4009 nits"), issue?.message);
  assert.ok(issue?.message.includes("clip"), issue?.message);
});

// ---------------------------------------------------------------------------
// Runtime drift after a conversion
// ---------------------------------------------------------------------------

test("a doubled runtime is caught, a rounding difference is not", () => {
  const film = 8580; // 2h 23m, Skyfall
  assert.ok(runtimeDrift(film, film * 2) > RUNTIME_DRIFT, "doubled must fail");
  assert.ok(runtimeDrift(film, film + 0.4) < RUNTIME_DRIFT, "0.4s must pass");
  // Direction does not matter: a truncated file is as wrong as a doubled one.
  assert.ok(runtimeDrift(film, film / 2) > RUNTIME_DRIFT, "halved must fail");
  assert.equal(runtimeDrift(film, film), 0);
});

// ---------------------------------------------------------------------------
// Episode detection
//
// The only test that really matters is the negative one: a film wrongly read
// as an episode disappears from the movie library into a show that does not
// exist, and 2160p / 1080p / years are all digit-pairs a loose pattern eats.
// ---------------------------------------------------------------------------

const episodeCases: [string, string[], string, number, number][] = [
  ["Breaking.Bad.S01E02.2160p.BluRay.REMUX.mkv", [], "Breaking Bad", 1, 2],
  ["The.Wire.s03e07.Back.Burners.1080p.WEB-DL.mkv", [], "The Wire", 3, 7],
  ["Chernobyl.1x02.Please.Remain.Calm.2160p.mkv", [], "Chernobyl", 1, 2],
  ["Severance.S02E05.mkv", [], "Severance", 2, 5],
  ["Show Name - S01E09 - Title.mkv", [], "Show Name", 1, 9],
  // Leads with the marker: the show comes from the folder above the season.
  ["S01E04.1080p.mkv", ["Andor", "Season 1", "S01E04.1080p.mkv"], "Andor", 1, 4],
];

for (const [file, segments, show, season, number] of episodeCases) {
  test(`reads ${file} as an episode`, () => {
    const info = parseEpisode(file, segments);
    assert.ok(info, `expected an episode from ${file}`);
    assert.equal(info.showTitle, show);
    assert.equal(info.season, season);
    assert.equal(info.episode, number);
  });
}

test("a double episode keeps both numbers", () => {
  const info = parseEpisode("Show.S01E01-E02.1080p.mkv", []);
  assert.equal(info?.episode, 1);
  assert.equal(info?.episodeEnd, 2);
});

test("the episode's own title is kept, without the quality tags", () => {
  const info = parseEpisode(
    "The.Wire.s03e07.Back.Burners.1080p.WEB-DL.DD5.1.mkv",
    [],
  );
  assert.equal(info?.episodeTitle, "Back Burners");
});

for (const film of [
  "Dune.2021.2160p.BluRay.REMUX.HEVC.DTS-HD.MA.TrueHD.7.1.Atmos-FGT.mkv",
  "Blade.Runner.2049.2017.2160p.UHD.BluRay.REMUX.mkv",
  "1917.2019.2160p.UHD.BluRay.x265.mkv",
  "Se7en.1995.2160p.UHD.BluRay.REMUX.HEVC.mkv",
  "The.Hateful.Eight.2015.1080p.BluRay.x264.mkv",
  "Skyfall.2012.UHD.BluRay.2160p.DTS-HD.MA.5.1.DV.HEVC.REMUX-FraMeSToR.mkv",
]) {
  test(`does not read ${film.split(".")[0]} as an episode`, () => {
    assert.equal(parseEpisode(film, []), undefined);
  });
}

// ---------------------------------------------------------------------------
// What the ceiling is
// ---------------------------------------------------------------------------

/**
 * Plenty of films were never pressed. Scoring a streaming original against a
 * disc that does not exist leaves every copy of it permanently short of a
 * remux nobody can make — so the ceiling has to be able to say it is a stream.
 */

/** A 4K release with no HDR and one lossy track, as a disc unless told else. */
const ceiling = (over: Record<string, unknown> = {}) => ({
  uhdExists: true,
  best: {
    title: "The Master",
    format: "4K" as const,
    hdr: [] as string[],
    hasAtmos: false,
    hasDtsX: false,
    audioTracks: ["Dolby Digital Plus 5.1"],
    ...over,
  },
});

/** A 4K WEB-DL of it: the best copy of a film that was never on a disc. */
const webPull = (disc: ReturnType<typeof ceiling>) =>
  derive(
    "/m/Fake/Fake.2024.2160p.NF.WEB-DL.DDP5.1.mkv",
    12e9,
    mediainfo(
      {},
      { Format: "HEVC", BitDepth: "10", Encoded_Library: "ATEME Titan File" },
      [{ Format: "E-AC-3", Channels: "6" }],
    ),
    undefined,
    disc,
  );

test("a WEB-DL ceiling scores as the compressed master it is", () => {
  const asDisc = scoreDisc(ceiling().best);
  const asWeb = scoreDisc(ceiling({ source: "web" }).best);

  assert.ok(asWeb.release < asDisc.release);
  assert.ok(asWeb.overall < asDisc.overall);
  // A disc's bitrate is a known quantity and a stream's is not, so the web
  // ceiling claims no density it cannot show — which is what lets a faithful
  // pull of that stream reach it.
  assert.ok(asWeb.video < asDisc.video);
  // The sound is the same either way; only the source moved.
  assert.equal(asWeb.audio, asDisc.audio);
});

test("a WEB-DL is not held short of a disc that was never pressed", () => {
  const d = webPull(ceiling({ source: "web" }));

  assert.equal(d.releaseType, "WEB-DL");
  assert.deepEqual(d.disc?.gaps, []);
  assert.equal(d.disc?.bestAvailable, true);
  assert.equal(d.scores.overall, 100);
  assert.equal(d.status, "Best Available");
});

test("the same file against a real disc is still one source short of it", () => {
  const d = webPull(ceiling());

  assert.deepEqual(d.disc?.gaps, [
    "Disc is the untouched source; this copy is a WEB-DL",
  ]);
  assert.equal(d.disc?.bestAvailable, false);
  assert.ok(d.scores.overall < 100);
});

test("a WEB-DL ceiling still names the gaps a copy really has", () => {
  const d = derive(
    "/m/Fake/Fake.2024.1080p.x264-GRP.mkv",
    4e9,
    mediainfo(
      { Duration: "7200" },
      {
        Width: "1920",
        Height: "1080",
        Format: "AVC",
        Encoded_Library: "x264 - core 164",
      },
      [{ Format: "E-AC-3", Channels: "6" }],
    ),
    undefined,
    ceiling({ source: "web", hdr: ["HDR10", "Dolby Vision"], hasAtmos: true }),
  );

  assert.equal(d.releaseType, "ENCODE");
  assert.deepEqual(d.disc?.gaps, [
    "A 4K release exists; this copy is 1080p",
    "The WEB-DL has Dolby Vision; this copy is SDR",
    "The WEB-DL has Dolby Atmos; this copy has neither",
    "The WEB-DL is the provider's own master; this copy is a ENCODE",
  ]);
});

test("a stated bitrate is what earns a stream its density line", () => {
  const blank = scoreDisc(ceiling({ source: "web" }).best);
  // 13.8 Mbps at 2160p is 0.069 bpp — the "some loss" band, 5 of 14.
  const stated = scoreDisc(
    ceiling({ source: "web", videoBitrateMbps: 13.8 }).best,
  );
  const dense = scoreDisc(
    ceiling({ source: "web", videoBitrateMbps: 40 }).best,
  );

  assert.equal(stated.video - blank.video, 5);
  assert.ok(dense.video > stated.video);
  // Nothing else moves: it is one line of the video score.
  assert.equal(stated.audio, blank.audio);
  assert.equal(stated.release, blank.release);
});

test("a disc's bitrate does not move it: a remux is untouched by definition", () => {
  assert.deepEqual(
    scoreDisc(ceiling({ videoBitrateMbps: 72 }).best),
    scoreDisc(ceiling().best),
  );
});

test("a copy no denser than the master it came from does not exceed it", () => {
  // The real case: a 13.8 Mbps 4K pull of a 13.8 Mbps master. Before the
  // ceiling could read the bitrate, the copy scored 5 above it on video.
  const master = ceiling({
    source: "web",
    videoBitrateMbps: 13.8,
    hdr: ["HDR10", "Dolby Vision"],
    hasAtmos: true,
    audioTracks: ["Dolby Digital Plus 5.1 with Dolby Atmos"],
  });

  const d = derive(
    "/m/Fake/Fake.2026.2160p.DSNP.WEB-DL.DV.HDR.mkv",
    12e9,
    mediainfo(
      { Duration: "7200" },
      {
        Format: "HEVC",
        BitDepth: "10",
        HDR_Format: "Dolby Vision",
        BitRate: "13818000",
        Encoded_Library: "ATEME Titan File",
      },
      [
        {
          Format: "E-AC-3",
          Channels: "6",
          Format_Commercial_IfAny: "Dolby Digital Plus with Dolby Atmos",
        },
      ],
    ),
    undefined,
    master,
  );

  assert.equal(d.scores.video, scoreDisc(master.best).video);
  assert.equal(d.scores.overall, 100);
  assert.deepEqual(d.disc?.gaps, []);
});
