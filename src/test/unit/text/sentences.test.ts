import * as assert from "node:assert/strict";
import { BlockBuilder } from "../../../text/builder";
import { splitSentences, wholeSentence } from "../../../text/sentences";
import { assertInvariants, texts } from "./invariants";

function split(source: string): string[] {
  const builder = new BlockBuilder();
  builder.appendVerbatim(source, 0);
  const sentences = splitSentences(builder.build());
  assertInvariants(source, sentences);
  return texts(sentences);
}

describe("splitSentences", () => {
  it("splits on sentence ends", () => {
    assert.deepEqual(split("One here. Two there! Three?"), ["One here.", "Two there!", "Three?"]);
  });

  it("merges after titles", () => {
    assert.deepEqual(split("Dr. Smith is in. Mr. Jones and Prof. Lee too."), [
      "Dr. Smith is in.",
      "Mr. Jones and Prof. Lee too.",
    ]);
  });

  it("merges after figure and number labels", () => {
    assert.deepEqual(split("See Fig. 3 and No. 5. Done."), ["See Fig. 3 and No. 5.", "Done."]);
  });

  it("keeps No. as a sentence end before a capital", () => {
    assert.deepEqual(split("He said No. Then he left."), ["He said No.", "Then he left."]);
  });

  it("does not split e.g., versions, file names or U.S.", () => {
    assert.deepEqual(split("Use e.g. v1.2 in index.ts here. Ok."), ["Use e.g. v1.2 in index.ts here.", "Ok."]);
  });

  it("treats etc. at a true sentence end as the end", () => {
    assert.deepEqual(split("Apples, pears, etc. Then more."), ["Apples, pears, etc.", "Then more."]);
  });

  it("merges etc. and Inc. when the next part starts lowercase", () => {
    assert.deepEqual(split("Apples etc. are fine. Acme Inc. sells."), ["Apples etc. are fine.", "Acme Inc. sells."]);
  });

  it("collapses whitespace and line breaks with exact offsets", () => {
    const source = "First  line\nsecond. \n\n Third";
    assert.deepEqual(split(source), ["First line second.", "Third"]);
  });

  it("maps sentence source ranges", () => {
    const builder = new BlockBuilder();
    builder.appendVerbatim("Ab. Cd.", 4);
    const [first, second] = splitSentences(builder.build());
    assert.deepEqual([first?.sourceStart, first?.sourceEnd], [4, 7]);
    assert.deepEqual([second?.sourceStart, second?.sourceEnd, second?.pieces[0]?.spokenStart], [8, 11, 0]);
  });

  it("keeps a synthetic piece's whole range when a sentence cuts it", () => {
    const builder = new BlockBuilder();
    builder.appendSynthetic("Hi. There", 0, 50);
    const sentences = splitSentences(builder.build());
    assert.deepEqual(
      sentences.map((s) => [s.text, s.sourceStart, s.sourceEnd]),
      [
        ["Hi.", 0, 50],
        ["There", 0, 50],
      ],
    );
  });

  it("returns nothing for an empty block", () => {
    assert.deepEqual(split(""), []);
    assert.deepEqual(wholeSentence(new BlockBuilder().build()), []);
  });

  it("keeps a whole block as one sentence when asked", () => {
    const builder = new BlockBuilder();
    builder.appendVerbatim("A. B.", 0);
    assert.deepEqual(texts(wholeSentence(builder.build())), ["A. B."]);
  });
});
