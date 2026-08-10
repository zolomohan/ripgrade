import assert from "node:assert/strict";
import { test } from "node:test";

import { appendOutput, visibleOutput } from "../lib/job-output";

/*
 * The two things this has to get right are the two things a naive split gets
 * wrong: a line that arrives in pieces, and a line that writes over itself.
 */

test("a chunk that ends mid-line leaves the line open for the next one", () => {
  let out = appendOutput([], "Converting the");
  out = appendOutput(out, " video stream\n");

  assert.deepEqual(visibleOutput(out), ["Converting the video stream"]);
});

test("a newline starts a line; the buffer keeps the ones before it", () => {
  const out = appendOutput([], "first\nsecond\nthird\n");

  assert.deepEqual(visibleOutput(out), ["first", "second", "third"]);
});

test("a carriage return writes over its line rather than adding one", () => {
  let out = appendOutput([], "kept\n");
  out = appendOutput(out, "\r[1/3] Converting 1s");
  out = appendOutput(out, "\r[1/3] Converting 2s");
  out = appendOutput(out, "\r[1/3] Converting 3s");

  assert.deepEqual(visibleOutput(out), ["kept", "[1/3] Converting 3s"]);
});

test("a spinner cannot push the lines above it out of the buffer", () => {
  let out = appendOutput([], "the line that explains the failure\n");
  for (let i = 0; i < 500; i++) {
    out = appendOutput(out, `\r[1/3] Converting... (${i}s)`);
  }

  assert.equal(visibleOutput(out)[0], "the line that explains the failure");
  assert.equal(visibleOutput(out).length, 2);
});

test("colour and cursor control are dropped", () => {
  const out = appendOutput([], "[31mError: not found[0m\n");

  assert.deepEqual(visibleOutput(out), ["Error: not found"]);
});

test("a bracket that is not an escape sequence survives", () => {
  // The reason ANSI is anchored on the escape character: this reads exactly
  // like a control sequence to a pattern that does not insist on one.
  const out = appendOutput([], "1917.2019.UHD.[2160p].REMUX.mkv\n");

  assert.deepEqual(visibleOutput(out), ["1917.2019.UHD.[2160p].REMUX.mkv"]);
});

test("the buffer holds only the last lines, and holds the newest of them", () => {
  let out: string[] = [];
  for (let i = 0; i < 100; i++) out = appendOutput(out, `line ${i}\n`, 5);

  // Five held, and the line still open is one of the five — so four to read.
  assert.equal(out.length, 5);
  assert.deepEqual(visibleOutput(out), [
    "line 96",
    "line 97",
    "line 98",
    "line 99",
  ]);
});

test("nothing read yet reads as nothing to show", () => {
  assert.deepEqual(visibleOutput(undefined), []);
  assert.deepEqual(visibleOutput([]), []);
  assert.deepEqual(visibleOutput([""]), []);
});
