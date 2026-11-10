import * as assert from "node:assert/strict";
import { textKindForLanguage, toSentences } from "../../../text/prepare";
import { assertInvariants, texts } from "./invariants";

const OPTIONS = { skipCodeBlocks: true };

describe("toSentences", () => {
  it("dispatches on kind", () => {
    assert.deepEqual(texts(toSentences("# Hi", "markdown", OPTIONS)), ["Hi."]);
    assert.deepEqual(texts(toSentences("# Hi", "plain", OPTIONS)), ["# Hi"]);
    assert.deepEqual(texts(toSentences("# Hi", "code", OPTIONS)), ["Hi"]);
  });

  it("shifts every offset by baseOffset", () => {
    const document = "xxxxx Hello **there**. Bye.";
    const base = 6;
    const sentences = toSentences(document.slice(base), "markdown", OPTIONS, base);
    assertInvariants(document, sentences);
    assert.deepEqual(
      sentences.map((s) => [s.sourceStart, s.sourceEnd]),
      [
        [6, 22],
        [23, 27],
      ],
    );
  });

  it("returns nothing for empty input", () => {
    assert.deepEqual(toSentences("", "markdown", OPTIONS, 10), []);
  });
});

describe("textKindForLanguage", () => {
  it("maps language ids to cleaners", () => {
    assert.equal(textKindForLanguage("markdown"), "markdown");
    assert.equal(textKindForLanguage("mdx"), "markdown");
    assert.equal(textKindForLanguage("plaintext"), "plain");
    assert.equal(textKindForLanguage("latex"), "plain");
    assert.equal(textKindForLanguage("typescript"), "code");
    assert.equal(textKindForLanguage("python"), "code");
  });
});
