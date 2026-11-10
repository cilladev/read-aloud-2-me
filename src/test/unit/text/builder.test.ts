import * as assert from "node:assert/strict";
import { BlockBuilder } from "../../../text/builder";

describe("BlockBuilder", () => {
  it("keeps single spaces inside one verbatim piece", () => {
    const builder = new BlockBuilder();
    builder.appendVerbatim("a b", 10);
    assert.deepEqual(builder.build().pieces, [
      { spokenStart: 0, spokenEnd: 3, sourceStart: 10, sourceEnd: 13, kind: "verbatim" },
    ]);
  });

  it("collapses whitespace runs into gaps and splits pieces", () => {
    const builder = new BlockBuilder();
    builder.appendVerbatim("  a  \n b ", 0);
    const block = builder.build();
    assert.equal(block.text, "a b");
    assert.deepEqual(
      block.pieces.map((p) => [p.spokenStart, p.spokenEnd, p.sourceStart, p.sourceEnd]),
      [
        [0, 1, 2, 3],
        [2, 3, 7, 8],
      ],
    );
  });

  it("merges verbatim appends that are contiguous in the source", () => {
    const builder = new BlockBuilder();
    builder.appendVerbatim("ab", 0);
    builder.appendVerbatim("cd", 2);
    assert.equal(builder.build().pieces.length, 1);
  });

  it("collapses and trims synthetic text and honours its edge spaces", () => {
    const builder = new BlockBuilder();
    builder.appendSynthetic("  ", 0, 1);
    assert.ok(builder.isEmpty);
    builder.appendSynthetic("x\n y ", 0, 5);
    builder.appendVerbatim("z", 9);
    const block = builder.build();
    assert.equal(block.text, "x y z");
    assert.equal(block.pieces[0]?.kind, "synthetic");
  });

  it("drops leading spaces and spaces at the end", () => {
    const builder = new BlockBuilder();
    builder.space();
    builder.appendVerbatim("a", 0);
    builder.space();
    assert.equal(builder.build().text, "a");
  });

  it("terminates with a synthetic period mapped to the last character", () => {
    const builder = new BlockBuilder();
    builder.appendVerbatim("Title", 2);
    builder.terminate();
    const block = builder.build();
    assert.equal(block.text, "Title.");
    assert.deepEqual(block.pieces[1], {
      spokenStart: 5,
      spokenEnd: 6,
      sourceStart: 6,
      sourceEnd: 7,
      kind: "synthetic",
    });
  });

  it("does not terminate twice, nor an empty block", () => {
    const empty = new BlockBuilder();
    empty.terminate();
    assert.equal(empty.build().text, "");
    const builder = new BlockBuilder();
    builder.appendVerbatim('Done!"', 0);
    builder.terminate();
    assert.equal(builder.build().text, 'Done!"');
  });

  it("maps a period after a synthetic piece to the whole piece", () => {
    const builder = new BlockBuilder();
    builder.appendSynthetic("github.com", 4, 30);
    builder.terminate();
    assert.deepEqual(builder.build().pieces[1], {
      spokenStart: 10,
      spokenEnd: 11,
      sourceStart: 4,
      sourceEnd: 30,
      kind: "synthetic",
    });
  });

  it("appends another block, keeping its gaps", () => {
    const inner = new BlockBuilder();
    inner.appendVerbatim("a", 0);
    inner.space();
    inner.appendVerbatim("b", 5);
    const outer = new BlockBuilder();
    outer.appendSynthetic("H:", 0, 6);
    outer.space();
    outer.appendBlock(inner.build());
    const synthetic = new BlockBuilder();
    synthetic.appendSynthetic("s", 7, 8);
    outer.appendBlock(synthetic.build());
    const block = outer.build();
    assert.equal(block.text, "H: a bs");
    assert.deepEqual(
      block.pieces.map((p) => [p.spokenStart, p.sourceStart, p.kind]),
      [
        [0, 0, "synthetic"],
        [3, 0, "verbatim"],
        [5, 5, "verbatim"],
        [6, 7, "synthetic"],
      ],
    );
  });
});
