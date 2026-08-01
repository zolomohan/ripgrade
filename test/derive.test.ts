import assert from "node:assert/strict";
import { test } from "node:test";

import { ISSUE_CATALOGUE, STATUS_BANDS, derive, parseName, titleKey } from "../lib/derive";

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

function mediainfo(general: FakeTrack, video: FakeTrack, audio: FakeTrack[] = []) {
  return {
    media: {
      track: [
        { "@type": "General", Duration: "7200", ...general },
        { "@type": "Video", Width: "3840", Height: "2160", FrameRate: "23.976", ...video },
        ...audio.map((a) => ({ "@type": "Audio", ...a })),
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
