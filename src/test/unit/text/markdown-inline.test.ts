import * as assert from "node:assert/strict";
import type { Nodes } from "mdast";
import { BlockBuilder } from "../../../text/builder";
import { appendInline, domainOf } from "../../../text/markdown-inline";

function at(
  start: number,
  end: number,
): { start: { line: number; column: number; offset: number }; end: { line: number; column: number; offset: number } } {
  return { start: { line: 1, column: start + 1, offset: start }, end: { line: 1, column: end + 1, offset: end } };
}

function speak(nodes: Nodes[], source: string): string {
  const builder = new BlockBuilder();
  appendInline(nodes, source, builder);
  return builder.build().text;
}

describe("appendInline", () => {
  it("is silent for nodes without a position", () => {
    const nodes: Nodes[] = [
      { type: "text", value: "lost" },
      { type: "inlineCode", value: "lost" },
      { type: "link", url: "https://x.com", children: [{ type: "text", value: "https://x.com" }] },
    ];
    assert.equal(speak(nodes, ""), "");
  });

  it("is silent for block nodes in phrasing position", () => {
    assert.equal(speak([{ type: "thematicBreak", position: at(0, 3) }], "---"), "");
  });

  it("falls back to a synthetic piece when inline code does not align", () => {
    const builder = new BlockBuilder();
    appendInline([{ type: "inlineCode", value: "zz", position: at(0, 4) }], "`ab`", builder);
    assert.deepEqual(builder.build().pieces, [
      { spokenStart: 0, spokenEnd: 2, sourceStart: 0, sourceEnd: 4, kind: "synthetic" },
    ]);
  });

  it("strips shortcodes from synthetic fallbacks too", () => {
    assert.equal(speak([{ type: "text", value: "hi :wave: x", position: at(0, 3) }], "abc"), "hi x");
  });
});

describe("domainOf", () => {
  it("drops the scheme, www., path, query and port", () => {
    assert.equal(domainOf("https://www.github.com/foo/bar"), "github.com");
    assert.equal(domainOf("www.x.com?q=1"), "x.com");
    assert.equal(domainOf("http://localhost:8080/a"), "localhost");
  });
});
