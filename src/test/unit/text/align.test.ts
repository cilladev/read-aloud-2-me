import * as assert from "node:assert/strict";
import { alignValue } from "../../../text/align";

describe("alignValue", () => {
  it("returns one verbatim segment when value equals the slice", () => {
    assert.deepEqual(alignValue("abc", "xabc", 1, 4), [
      { kind: "verbatim", valueStart: 0, text: "abc", sourceStart: 1, sourceEnd: 4 },
    ]);
  });

  it("skips backslashes before punctuation", () => {
    const segments = alignValue("a*b", "a\\*b", 0, 4);
    assert.deepEqual(
      segments?.map((s) => [s.text, s.sourceStart, s.sourceEnd]),
      [
        ["a", 0, 1],
        ["*b", 2, 4],
      ],
    );
  });

  it("maps surrogate-pair references to two code units", () => {
    const segments = alignValue("😀!", "&#x1F600;!", 0, 10);
    assert.deepEqual(segments?.[0], { kind: "synthetic", valueStart: 0, text: "😀", sourceStart: 0, sourceEnd: 9 });
  });

  it("skips blockquote prefixes and matches differing whitespace", () => {
    const segments = alignValue("a b", "a\n> b", 0, 5);
    assert.deepEqual(
      segments?.map((s) => s.kind),
      ["verbatim", "space", "verbatim"],
    );
  });

  it("fails when the value runs past the source or cannot be matched", () => {
    assert.equal(alignValue("abcd", "abc", 0, 3), undefined);
    assert.equal(alignValue("ax", "ay", 0, 2), undefined);
  });
});
