import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUDIO_OPTIONS,
  audioChoices,
  entryFromSpec,
  qualityLabel,
  readEntry,
  specFromEntry,
  type DiscEntry,
} from "../lib/disc-entry";

/**
 * A ceiling typed in by hand has to come out shaped exactly like a scraped one,
 * because everything downstream — the scorer, the gap list, the panels — reads
 * it without knowing which it got. These tests are that promise.
 */

const entry = (over: Partial<DiscEntry> = {}): DiscEntry => ({
  title: "Solaris (Criterion)",
  source: "disc",
  resolution: "2160p",
  hdr: "SDR",
  audio: [],
  ...over,
});

test("resolution decides the format, which decides the bit depth downstream", () => {
  assert.equal(specFromEntry(entry()).format, "4K");
  assert.equal(specFromEntry(entry({ resolution: "1080p" })).format, "BD");
  assert.equal(specFromEntry(entry({ resolution: "720p" })).format, "BD");
});

test("a Dolby Vision disc carries an HDR10 base layer", () => {
  assert.deepEqual(specFromEntry(entry({ hdr: "SDR" })).hdr, []);
  assert.deepEqual(specFromEntry(entry({ hdr: "HDR10" })).hdr, ["HDR10"]);
  assert.deepEqual(specFromEntry(entry({ hdr: "HDR10+" })).hdr, [
    "HDR10",
    "HDR10+",
  ]);
  assert.deepEqual(specFromEntry(entry({ hdr: "Dolby Vision" })).hdr, [
    "HDR10",
    "Dolby Vision",
  ]);
});

test("object audio and losslessness are read off the track names", () => {
  const spec = specFromEntry(
    entry({ audio: ["Dolby TrueHD 7.1", "Dolby Atmos", "Dolby Digital 5.1"] }),
  );
  assert.equal(spec.hasAtmos, true);
  assert.equal(spec.hasDtsX, false);
  assert.equal(spec.hasLossless, true);

  const lossy = specFromEntry(entry({ audio: ["Dolby Digital Plus 5.1"] }));
  assert.equal(lossy.hasLossless, false);
  assert.equal(lossy.hasAtmos, false);

  assert.equal(specFromEntry(entry({ audio: ["DTS:X"] })).hasDtsX, true);
  assert.equal(specFromEntry(entry({ audio: ["DTS-X 7.1"] })).hasDtsX, true);
});

test("no url, because there is no page behind a typed-in ceiling", () => {
  assert.equal(specFromEntry(entry()).url, undefined);
});

test("an empty title falls back rather than naming the panel nothing", () => {
  assert.equal(specFromEntry(entry({ title: "   " })).title, "Entered by hand");
});

test("blank optional fields are absent rather than empty", () => {
  const spec = specFromEntry(
    entry({ videoCodec: "  ", aspectRatio: "", videoBitrateMbps: 0 }),
  );
  assert.equal(spec.videoCodec, undefined);
  assert.equal(spec.aspectRatio, undefined);
  assert.equal(spec.videoBitrateMbps, undefined);
});

test("a film never pressed says so, and is labelled as what it is", () => {
  const web = specFromEntry(entry({ source: "web" }));
  assert.equal(web.source, "web");
  assert.equal(qualityLabel(web), "4K WEB-DL");
  assert.equal(
    qualityLabel(specFromEntry(entry({ source: "web", resolution: "1080p" }))),
    "WEB-DL",
  );
});

test("a disc is named by the format it was pressed on", () => {
  assert.equal(qualityLabel(specFromEntry(entry())), "4K");
  assert.equal(
    qualityLabel(specFromEntry(entry({ resolution: "1080p" }))),
    "BD",
  );
  // Everything the scraper produces predates the field and is a disc.
  assert.equal(qualityLabel({ format: "4K" }), "4K");
});

test("a spec reads back as the entry that would produce it", () => {
  const original = entry({
    source: "web",
    hdr: "Dolby Vision",
    videoCodec: "HEVC",
    videoBitrateMbps: 72.4,
    aspectRatio: "2.39:1",
    audio: ["Dolby TrueHD 7.1", "Dolby Atmos"],
  });
  assert.deepEqual(entryFromSpec(specFromEntry(original)), original);
});

test("a scraped release reads back too, so half-right specs can be corrected", () => {
  assert.deepEqual(
    entryFromSpec({
      url: "https://www.blu-ray.com/movies/x/1/",
      title: "Heat 4K",
      format: "4K",
      resolution: "Native 4K (2160p)",
      hdr: ["HDR10"],
      audio: ["DTS-HD Master Audio 5.1"],
      hasAtmos: false,
      hasDtsX: false,
      hasLossless: true,
    }),
    {
      title: "Heat 4K",
      source: "disc",
      resolution: "2160p",
      hdr: "HDR10",
      videoCodec: undefined,
      videoBitrateMbps: undefined,
      aspectRatio: undefined,
      audio: ["DTS-HD Master Audio 5.1"],
    },
  );
});

/**
 * The whole reason the field is a list of options: every one of these names
 * has to be read by the scorer as the thing it says it is. A label the rubric
 * does not recognise is a track that silently scores as something lesser.
 */
const READS_AS: Record<string, ["lossless" | "lossy", "atmos" | "dtsx" | ""]> =
  {
    "Dolby TrueHD 7.1 with Dolby Atmos": ["lossless", "atmos"],
    "Dolby TrueHD 7.1": ["lossless", ""],
    "Dolby TrueHD 5.1": ["lossless", ""],
    "DTS-HD Master Audio 7.1 with DTS:X": ["lossless", "dtsx"],
    "DTS-HD Master Audio 7.1": ["lossless", ""],
    "DTS-HD Master Audio 5.1": ["lossless", ""],
    "LPCM 5.1": ["lossless", ""],
    "LPCM 2.0": ["lossless", ""],
    "Dolby Digital Plus 5.1 with Dolby Atmos": ["lossy", "atmos"],
    "Dolby Digital Plus 5.1": ["lossy", ""],
    "Dolby Digital 5.1": ["lossy", ""],
    "Dolby Digital 2.0": ["lossy", ""],
    "AAC 2.0": ["lossy", ""],
  };

test("every track on offer is one the rubric reads correctly", () => {
  // No option may be added without saying what it means here.
  assert.deepEqual([...AUDIO_OPTIONS].sort(), Object.keys(READS_AS).sort());

  for (const [track, [quality, object]] of Object.entries(READS_AS)) {
    const spec = specFromEntry(entry({ audio: [track] }));
    assert.equal(spec.hasLossless, quality === "lossless", track);
    assert.equal(spec.hasAtmos, object === "atmos", track);
    assert.equal(spec.hasDtsX, object === "dtsx", track);
  }
});

test("unknown sound is no sound claimed, not silence", () => {
  const spec = specFromEntry(entry({ audio: [] }));
  assert.deepEqual(spec.audio, []);
  assert.equal(spec.hasAtmos, false);
  assert.equal(spec.hasDtsX, false);
  assert.equal(spec.hasLossless, false);
});

test("a release keeps a track the catalogue has never heard of", () => {
  const odd = "Auro-3D 11.1";
  assert.ok(audioChoices([odd]).includes(odd));
  // And the catalogue is not doubled up by what is already on the list.
  assert.deepEqual(audioChoices(["Dolby TrueHD 7.1"]), [...AUDIO_OPTIONS]);
});

test("what arrives from the browser is checked, not trusted", () => {
  assert.equal(readEntry(undefined), undefined);
  assert.equal(readEntry({ resolution: "8K", hdr: "SDR" }), undefined);
  assert.equal(readEntry({ resolution: "2160p", hdr: "HDR11" }), undefined);

  const clean = readEntry({
    title: "  Solaris  ",
    source: "web",
    resolution: "1080p",
    hdr: "HDR10",
    videoBitrateMbps: "38.26",
    audio: ["Dolby TrueHD 7.1", 7, "  "],
    extra: "ignored",
  });

  assert.deepEqual(clean, {
    title: "Solaris",
    source: "web",
    resolution: "1080p",
    hdr: "HDR10",
    videoCodec: undefined,
    // Rounded to a tenth, which is all a disc's bitrate is ever quoted to.
    videoBitrateMbps: 38.3,
    aspectRatio: undefined,
    audio: ["Dolby TrueHD 7.1"],
  });
});

test("an unrecognised source reads as a disc rather than refusing the entry", () => {
  assert.equal(readEntry({ resolution: "2160p", hdr: "SDR" })?.source, "disc");
  assert.equal(
    readEntry({ resolution: "2160p", hdr: "SDR", source: "laserdisc" })?.source,
    "disc",
  );
});

test("a nonsense bitrate is dropped rather than poisoning the gap list", () => {
  for (const videoBitrateMbps of ["", "abc", -5, Infinity, NaN]) {
    const clean = readEntry({
      resolution: "2160p",
      hdr: "SDR",
      videoBitrateMbps,
    });
    assert.equal(clean?.videoBitrateMbps, undefined);
  }

  assert.equal(
    readEntry({ resolution: "2160p", hdr: "SDR", videoBitrateMbps: 99999 })
      ?.videoBitrateMbps,
    1000,
  );
});
