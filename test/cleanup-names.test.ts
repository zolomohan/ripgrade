import assert from "node:assert/strict";
import { test } from "node:test";

import { artefactOf, isSidecar, stemOf } from "../lib/cleanup-names";
import { AUDIO_BACKUP_SUFFIX, BACKUP_SUFFIX } from "../lib/derive";

/*
 * What the cleanup list is allowed to offer up for deletion.
 *
 * This decides, from a filename alone, whether a file on the drive is an
 * original this app set aside, wreckage from a job that died, or a film. The
 * cost of a false positive is somebody's only copy of a 90 GB remux, so the
 * cases below are mostly about what must *not* match — a film whose own name
 * happens to look like an artefact is the whole risk here.
 */

const FILM = "Dune.2021.2160p.BluRay.REMUX.mkv";

// ---------------------------------------------------------------------------
// The originals a rewrite keeps
// ---------------------------------------------------------------------------

test("a conversion's original names the film it was made from", () => {
  const found = artefactOf(FILM + BACKUP_SUFFIX);

  assert.equal(found?.kind, "dovi-backup");
  // The film's whole name, extension and all: the suffix is appended to it.
  assert.equal(found?.base, FILM);
  assert.equal(found?.fromStem, false);
});

test("a track removal's original is told apart from a conversion's", () => {
  const found = artefactOf(FILM + AUDIO_BACKUP_SUFFIX);

  assert.equal(found?.kind, "audio-backup");
  assert.equal(found?.base, FILM);
});

// ---------------------------------------------------------------------------
// The wreckage
// ---------------------------------------------------------------------------

test("dovi_convert's working files are named from the stem, not the file", () => {
  for (const name of ["Dune.2021.p81.hevc", "Dune.2021.p81.tmp"]) {
    const found = artefactOf(name);
    assert.equal(found?.kind, "leftover", name);
    assert.equal(found?.base, "Dune.2021", name);
    // Which is what stops it being looked up as a film path: no extension.
    assert.equal(found?.fromStem, true, name);
  }
});

test("mkvmerge's working file keeps the film's whole name", () => {
  const found = artefactOf(`${FILM}.audio-strip.tmp`);

  assert.equal(found?.kind, "leftover");
  assert.equal(found?.base, FILM);
  assert.equal(found?.fromStem, false);
});

test("a rebuild's working files are named from the stem too", () => {
  for (const name of [
    "Dune.2021_bl.hevc",
    "Dune.2021_bl_clean.hevc",
    "Dune.2021_el.hevc",
    "Dune.2021_restored.hevc",
  ]) {
    const found = artefactOf(name);
    assert.equal(found?.kind, "leftover", name);
    assert.equal(found?.base, "Dune.2021", name);
    assert.equal(found?.fromStem, true, name);
  }
});

test("a rebuilt film left unrenamed is wreckage, not a film", () => {
  // The one leftover that is a playable Matroska file. It exists only where a
  // rebuild was killed between the mux and the rename, and the film it was
  // built from is still sitting beside it under its own name.
  const found = artefactOf("Dune.2021.restored.mkv");

  assert.equal(found?.kind, "leftover");
  assert.equal(found?.base, "Dune.2021");
  assert.equal(found?.fromStem, true);
});

test("the kept enhancement layer is never wreckage", () => {
  // It is the point of the conversion being reversible, and it outlives the
  // original on purpose. Offering it up for deletion beside the junk would be
  // offering the only way back to Profile 7.
  assert.equal(artefactOf("Dune.2021.dovi"), undefined);
});

test("a restore that died between its two renames leaves an aside", () => {
  const found = artefactOf(`${FILM}.restoring-4821`);

  assert.equal(found?.kind, "leftover");
  assert.equal(found?.base, FILM);
});

// ---------------------------------------------------------------------------
// Everything that must not match
// ---------------------------------------------------------------------------

test("a film is not an artefact", () => {
  for (const name of [
    FILM,
    "The.Batman.2022.UHD.BluRay.2160p.DV.HEVC.REMUX.mkv",
    "poster.jpg",
    ".DS_Store",
    "Dune.2021.p81.mkv",
  ]) {
    assert.equal(artefactOf(name), undefined, name);
  }
});

test("a film whose own name ends in a word we look for is still a film", () => {
  // Anchored at the end, so none of these is a match: the suffix has to be the
  // end of the name, not a fragment of a title or a release group.
  for (const name of [
    "The.Restoring-1988.mkv",
    "Restoring.Hope.2019.restoring-12.mkv",
    "Backup.2020.bak.dovi_convert.mkv",
    "Something.audio-strip.tmp.mkv",
    // A film with "restored" in its title, and one with the word as its own
    // last segment but the wrong extension.
    "The.Restored.2018.2160p.mkv",
    "Dune.2021.restored.mp4",
  ]) {
    assert.equal(artefactOf(name), undefined, name);
  }
});

test("a restore aside is only one with a process id after it", () => {
  assert.equal(artefactOf(`${FILM}.restoring-`), undefined);
  assert.equal(artefactOf(`${FILM}.restoring-abc`), undefined);
});

test("macOS metadata is never offered, whatever it is named after", () => {
  const sidecar = `._${FILM}${BACKUP_SUFFIX}`;

  assert.equal(isSidecar(sidecar), true);
  // Without the guard this reads as a 4 KB "Profile 7 original" of its own.
  assert.equal(artefactOf(sidecar), undefined);
  assert.equal(isSidecar(FILM), false);
});

// ---------------------------------------------------------------------------

test("a stem is the name without its final extension", () => {
  assert.equal(
    stemOf("/films/Dune (2021)/Dune.2021.mkv"),
    "/films/Dune (2021)/Dune.2021",
  );
  // Nothing to remove, rather than the folder losing its dotted segment.
  assert.equal(stemOf("/films/Dune (2021)/Dune"), "/films/Dune (2021)/Dune");
});
