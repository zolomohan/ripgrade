import assert from "node:assert/strict";
import { test } from "node:test";

import { STATUS_BANDS } from "../lib/derive";
import {
  estimateBpp,
  guessFromTitle,
  parseReleaseTitle,
} from "../lib/release-title";

/**
 * The names below are real ones, copied verbatim from indexer results. The
 * parser exists to read what people actually publish, so inventing tidy
 * examples would test the wrong thing.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test("a dotted release name splits into title, year and group", () => {
  const tags = parseReleaseTitle(
    "Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD.Atmos.7.1-FraMeSToR",
  );
  assert.equal(tags.title, "Dune Part Two");
  assert.equal(tags.year, 2024);
  assert.equal(tags.group, "FraMeSToR");
});

test("a year inside the title does not become the release year", () => {
  const tags = parseReleaseTitle("Blade.Runner.2049.2017.2160p.BluRay.REMUX-GRP");
  assert.equal(tags.title, "Blade Runner 2049");
  assert.equal(tags.year, 2017);
});

test("2160p is not read as the year 2160", () => {
  const tags = parseReleaseTitle("Sicario.2015.2160p.BluRay.REMUX-XYZ");
  assert.equal(tags.year, 2015);
});

test("a name ending in a resolution has no group", () => {
  assert.equal(parseReleaseTitle("Heat.1995.BluRay.1080p").group, undefined);
});

test("an edition is lifted out rather than left in the title", () => {
  const tags = parseReleaseTitle(
    "Blade.Runner.1982.Final.Cut.2160p.UHD.BluRay.REMUX.HDR-GRP",
  );
  assert.equal(tags.edition, "Final Cut");
  assert.equal(tags.title, "Blade Runner");
});

test("episodes and season packs are told apart", () => {
  const episode = parseReleaseTitle("Severance.S02E05.2160p.ATVP.WEB-DL.DDP5.1-NTb");
  assert.equal(episode.season, 2);
  assert.equal(episode.episode, 5);
  assert.equal(episode.seasonPack, false);

  const pack = parseReleaseTitle("Severance.S02.2160p.ATVP.WEB-DL.DDP5.1.Atmos-NTb");
  assert.equal(pack.season, 2);
  assert.equal(pack.episode, undefined);
  assert.equal(pack.seasonPack, true);
});

// ---------------------------------------------------------------------------
// Quality dimensions
// ---------------------------------------------------------------------------

test("a UHD remux reads as 2160p Dolby Vision lossless object audio", () => {
  const { facts, known } = guessFromTitle(
    "Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD.Atmos.7.1-FraMeSToR",
  );
  assert.equal(facts.resolution, "2160p");
  assert.equal(facts.hdr, "Dolby Vision");
  assert.equal(facts.releaseType, "REMUX");
  assert.equal(facts.audio[0].lossless, true);
  assert.equal(facts.audio[0].atmos, true);
  assert.equal(facts.audio[0].channels, 8);
  assert.equal(known.length, 4);
});

test("DV alongside HDR10 reads as Dolby Vision, not HDR10", () => {
  // Names list the fallback layer too; the stronger claim is the real one.
  assert.equal(guessFromTitle("X.2024.2160p.DV.HDR10.REMUX-G").facts.hdr, "Dolby Vision");
});

test("HDR10+ is not flattened into HDR10", () => {
  assert.equal(guessFromTitle("X.2024.2160p.HDR10+.WEB-DL-G").facts.hdr, "HDR10+");
});

test("a streaming pull reads as WEB-DL", () => {
  const { facts } = guessFromTitle(
    "Severance.S02E05.2160p.ATVP.WEB-DL.DDP5.1.Atmos.HDR.HEVC-NTb",
  );
  assert.equal(facts.releaseType, "WEB-DL");
  assert.equal(facts.audio[0].lossless, false);
  assert.equal(facts.audio[0].atmos, true);
});

test("a hobbyist codec beats a REMUX claim in the same name", () => {
  // "REMUX" over an x265 stream is a contradiction, and the codec is the
  // harder fact — the same order classifyRelease uses on a real file.
  assert.equal(
    guessFromTitle("X.2024.2160p.BluRay.REMUX.x265.HDR-G").facts.releaseType,
    "ENCODE",
  );
});

test("a disc-sourced encode is not mistaken for a remux", () => {
  assert.equal(
    guessFromTitle("Heat.1995.1080p.BluRay.x264.DTS-HD.MA.5.1-GRP").facts.releaseType,
    "ENCODE",
  );
});

test("a film with a source word in its title is not read as that source", () => {
  // The two that actually bite: "Mad Max" against the HBO Max tag, and
  // "Charlotte's Web" against the bare WEB tag.
  assert.equal(
    guessFromTitle("Mad.Max.Fury.Road.2015.2160p.UHD.BluRay.REMUX.HDR-G").facts.releaseType,
    "REMUX",
  );
  assert.equal(
    guessFromTitle("Charlottes.Web.2006.1080p.BluRay.x264.DTS-G").facts.releaseType,
    "ENCODE",
  );
});

test("a bare WEB tag still reads as a pull when nothing else claims it", () => {
  assert.equal(
    guessFromTitle("Show.S01E01.2160p.WEB.H265.DDP5.1-G").facts.releaseType,
    "WEB-DL",
  );
});

test("a codec name is not an encoder signature", () => {
  // Streaming services encode in H.264; saying so does not make a WEB-DL into
  // somebody's x264 rip, and a remux may carry the codec name too.
  assert.equal(
    guessFromTitle("Show.S01E01.1080p.AMZN.WEB-DL.H.264.DDP5.1-NTb").facts.releaseType,
    "WEB-DL",
  );
  assert.equal(
    guessFromTitle("X.2024.2160p.UHD.BluRay.REMUX.HEVC.DV.TrueHD.7.1.Atmos-G").facts.releaseType,
    "REMUX",
  );
});

test("DTS-HD MA is lossless and plain DTS is not", () => {
  assert.equal(
    guessFromTitle("X.2020.1080p.BluRay.DTS-HD.MA.5.1-G").facts.audio[0].lossless,
    true,
  );
  assert.equal(
    guessFromTitle("X.2020.1080p.BluRay.DTS.5.1-G").facts.audio[0].lossless,
    false,
  );
});

test("a format spelled in plain words is the same format", () => {
  // Some groups punctuate nothing: "DTS HD MA 5 1" is the same track as
  // "DTS-HD.MA.5.1", but the spaced spelling used to fall through to plain
  // lossy DTS and lose the release its own lossless bonus.
  const facts = guessFromTitle(
    "Quantum of Solace 2008 2160p UHD BluRay REMUX DoVi HEVC DTS HD MA 5 1 SYS",
  ).facts;
  assert.equal(facts.audio[0].format, "DTS-HD MA");
  assert.equal(facts.audio[0].lossless, true);
  assert.equal(facts.audio[0].channels, 6);

  assert.equal(
    guessFromTitle("X 2020 1080p BluRay TRUE HD 7 1 G").facts.audio[0].format,
    "TrueHD",
  );
});

test("DD+ is lossy and TrueHD is lossless", () => {
  assert.equal(guessFromTitle("X.2020.1080p.WEB-DL.DDP5.1-G").facts.audio[0].lossless, false);
  assert.equal(guessFromTitle("X.2020.1080p.BluRay.TrueHD.7.1-G").facts.audio[0].lossless, true);
});

test("an unlabelled UHD remux is read as the HDR10 it must be", () => {
  // Ultra HD Blu-ray mandates an HDR10 base layer, so a 2160p remux that never
  // says so is not SDR. Read as SDR it lost the HDR criterion and the ten-bit
  // point together — the twenty-six video points between predicting 91 for this
  // release and scanning it at 100 once it landed.
  const guess = guessFromTitle(
    "Captain America The First Avenger 2011 UHD BluRay 2160p TrueHD Atmos 7 1 HEVC REMUX-FraMeSToR",
  );
  assert.equal(guess.facts.hdr, "HDR10");
  assert.equal(guess.facts.bitDepth, 10);

  // Inferred, not stated: the name still never said, and confidence has to go
  // on saying so.
  assert.ok(!guess.known.includes("hdr"));
});

test("only a UHD disc source gets the benefit of that doubt", () => {
  // Being 2160p says nothing about mastering on its own, and plenty of streams
  // and hobby encodes at that resolution really are SDR.
  for (const name of [
    "X 2020 2160p WEB-DL DDP5 1 H 265-G",
    "X 2020 2160p BluRay x265 DTS-HD MA 5 1-G",
    "X 2020 1080p BluRay REMUX AVC DTS-HD MA 5 1-G",
  ]) {
    assert.equal(guessFromTitle(name).facts.hdr, "SDR", name);
  }

  // And a name that does state it is still read, not assumed over.
  assert.equal(
    guessFromTitle("X 2020 2160p UHD BluRay REMUX DV HDR HEVC TrueHD 7 1-G")
      .facts.hdr,
    "Dolby Vision",
  );
});

test("HDR implies 10-bit without the name having to say so", () => {
  assert.equal(guessFromTitle("X.2024.2160p.HDR.WEB-DL-G").facts.bitDepth, 10);
});

// ---------------------------------------------------------------------------
// What the guess admits it does not know
// ---------------------------------------------------------------------------

test("a bare name states nothing and says so", () => {
  const { known, confidence } = guessFromTitle("Some.Film.2019");
  assert.equal(known.length, 0);
  assert.equal(confidence, 0);
});

test("an unlabelled release is not scored as if it were silent", () => {
  // An empty track list would score zero for audio and sink the overall score
  // below anything comparable — worse than the mid-range guess it deserves.
  const { scores } = guessFromTitle("Some.Film.2019.1080p.BluRay.x264-GRP");
  assert.ok(scores.audio > 0);
});

test("confidence rises with each dimension the name states", () => {
  const bare = guessFromTitle("X.2020.1080p").confidence;
  const full = guessFromTitle(
    "X.2020.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD.Atmos.7.1-G",
  ).confidence;
  assert.ok(full > bare);
  assert.equal(full, 1);
});

// ---------------------------------------------------------------------------
// Scoring on the library's own scale
// ---------------------------------------------------------------------------

test("a UHD DV remux outscores a 1080p SDR encode of the same film", () => {
  const best = guessFromTitle(
    "Dune.2021.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD.Atmos.7.1-FraMeSToR",
  );
  const worst = guessFromTitle("Dune.2021.1080p.BluRay.x264.AC3-GRP", {
    sizeBytes: 2 * 1024 ** 3,
    runtimeMinutes: 155,
  });
  assert.ok(best.scores.overall > worst.scores.overall);
});

test("a top remux lands in the top band, as a measured one would", () => {
  const { scores, status } = guessFromTitle(
    "Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD.Atmos.7.1-FraMeSToR",
  );
  assert.ok(scores.overall >= STATUS_BANDS[0].min, `scored ${scores.overall}`);
  assert.equal(status, "Reference");
});

test("size and runtime separate a good 4K encode from a bad one", () => {
  const name = "X.2024.2160p.BluRay.x265.HDR.DTS-HD.MA.5.1-G";
  const generous = guessFromTitle(name, {
    sizeBytes: 60 * 1024 ** 3,
    runtimeMinutes: 120,
  });
  const stingy = guessFromTitle(name, {
    sizeBytes: 6 * 1024 ** 3,
    runtimeMinutes: 120,
  });
  assert.ok(generous.scores.overall > stingy.scores.overall);
});

test("a season pack's size is not read as one episode's bitrate", () => {
  // Ten episodes of runtime in the byte count, one episode's runtime in the
  // divisor, would report a bitrate an order of magnitude too high.
  const pack = guessFromTitle("Show.S01.2160p.WEB-DL.x265.HDR.DDP5.1-G", {
    sizeBytes: 80 * 1024 ** 3,
    runtimeMinutes: 55,
  });
  assert.equal(pack.facts.bpp, undefined);
});

test("bitrate cannot be inferred without a runtime", () => {
  assert.equal(estimateBpp("2160p", [], 40 * 1024 ** 3, undefined), undefined);
});

test("a size smaller than its own audio track yields no bitrate", () => {
  const lossless = [
    { label: "TrueHD", format: "TrueHD", channels: 8, lossless: true, atmos: true, dtsx: false },
  ];
  assert.equal(estimateBpp("2160p", lossless, 100 * 1024 ** 2, 120), undefined);
});
