import * as assert from "node:assert/strict";
import { mapSpokenOffset, mapSpokenRange } from "../../../text/offset-map";
import type { Sentence } from "../../../text/types";

// "See github.com now": "See" verbatim at 10, a synthetic domain for source 14..40, "now" at 41.
const SENTENCE: Sentence = {
  text: "See github.com now",
  sourceStart: 10,
  sourceEnd: 44,
  pieces: [
    { spokenStart: 0, spokenEnd: 3, sourceStart: 10, sourceEnd: 13, kind: "verbatim" },
    { spokenStart: 4, spokenEnd: 14, sourceStart: 14, sourceEnd: 40, kind: "synthetic" },
    { spokenStart: 15, spokenEnd: 18, sourceStart: 41, sourceEnd: 44, kind: "verbatim" },
  ],
};

describe("mapSpokenOffset", () => {
  it("maps verbatim offsets one to one", () => {
    assert.equal(mapSpokenOffset(SENTENCE, 0), 10);
    assert.equal(mapSpokenOffset(SENTENCE, 2), 12);
    assert.equal(mapSpokenOffset(SENTENCE, 16), 42);
  });

  it("maps synthetic offsets to the piece start", () => {
    assert.equal(mapSpokenOffset(SENTENCE, 4), 14);
    assert.equal(mapSpokenOffset(SENTENCE, 9), 14);
  });

  it("maps a gap to the nearest piece", () => {
    assert.equal(mapSpokenOffset(SENTENCE, 3), 14);
    assert.equal(mapSpokenOffset(SENTENCE, 14), 41);
  });

  it("maps a wide gap to whichever side is nearer", () => {
    const wide: Sentence = {
      text: "a     b",
      sourceStart: 0,
      sourceEnd: 9,
      pieces: [
        { spokenStart: 0, spokenEnd: 1, sourceStart: 0, sourceEnd: 1, kind: "verbatim" },
        { spokenStart: 6, spokenEnd: 7, sourceStart: 8, sourceEnd: 9, kind: "verbatim" },
      ],
    };
    assert.equal(mapSpokenOffset(wide, 1), 1);
    assert.equal(mapSpokenOffset(wide, 5), 8);
  });

  it("clamps offsets outside the text", () => {
    assert.equal(mapSpokenOffset(SENTENCE, -5), 10);
    assert.equal(mapSpokenOffset(SENTENCE, 99), 44);
  });

  it("falls back to the sentence start when there are no pieces", () => {
    assert.equal(mapSpokenOffset({ text: "x", sourceStart: 7, sourceEnd: 8, pieces: [] }, 0), 7);
  });
});

describe("mapSpokenRange", () => {
  it("maps a verbatim word", () => {
    assert.deepEqual(mapSpokenRange(SENTENCE, 0, 3), { start: 10, end: 13 });
    assert.deepEqual(mapSpokenRange(SENTENCE, 15, 3), { start: 41, end: 44 });
  });

  it("maps any part of a synthetic piece to its whole range", () => {
    assert.deepEqual(mapSpokenRange(SENTENCE, 4, 6), { start: 14, end: 40 });
    assert.deepEqual(mapSpokenRange(SENTENCE, 4, 10), { start: 14, end: 40 });
  });

  it("spans across pieces", () => {
    assert.deepEqual(mapSpokenRange(SENTENCE, 0, 18), { start: 10, end: 44 });
  });

  it("ends at the piece before a gap", () => {
    assert.deepEqual(mapSpokenRange(SENTENCE, 0, 4), { start: 10, end: 13 });
  });

  it("returns an empty range for zero length", () => {
    assert.deepEqual(mapSpokenRange(SENTENCE, 1, 0), { start: 11, end: 11 });
  });

  it("stays inside the sentence", () => {
    assert.deepEqual(mapSpokenRange(SENTENCE, 10, 50), { start: 14, end: 44 });
    assert.deepEqual(mapSpokenRange({ text: "x", sourceStart: 5, sourceEnd: 6, pieces: [] }, 0, 1), {
      start: 5,
      end: 5,
    });
  });
});
