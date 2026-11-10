import * as assert from "node:assert/strict";
import { codeLineSentences, codeToSentences, plainToSentences } from "../../../text/plain";
import { assertInvariants, texts } from "./invariants";

function plain(source: string): string[] {
  const sentences = plainToSentences(source);
  assertInvariants(source, sentences);
  return texts(sentences);
}

function code(source: string): string[] {
  const sentences = codeToSentences(source);
  assertInvariants(source, sentences);
  return texts(sentences);
}

describe("plainToSentences", () => {
  it("returns nothing for empty input", () => {
    assert.deepEqual(plain(""), []);
    assert.deepEqual(plain("\n \n\t\n"), []);
  });

  it("treats blank lines as block breaks", () => {
    assert.deepEqual(plain("No end\n\n\nNext one. Two"), ["No end", "Next one.", "Two"]);
  });

  it("joins wrapped lines with one space", () => {
    assert.deepEqual(plain("  wrapped\n   line.  "), ["wrapped line."]);
  });

  it("handles CRLF and old Mac line endings", () => {
    assert.deepEqual(plain("a\r\nb\r\n\r\nc\rd"), ["a b", "c d"]);
  });

  it("does not read markdown specially", () => {
    assert.deepEqual(plain("# not a heading"), ["# not a heading"]);
  });
});

describe("codeToSentences", () => {
  it("strips comment markers and skips punctuation-only lines", () => {
    const source = "/**\n * Adds two numbers.\n */\nfunction add(a, b) {\n  return a + b; // sum\n}\n";
    assert.deepEqual(code(source), ["Adds two numbers.", "function add(a, b) {", "return a + b; // sum"]);
  });

  it("never runs a comment into the code under it", () => {
    const source = "// Reads aloud.\n// Never sends text away\nexport function read(): void {\n  speak(text);\n}";
    assert.deepEqual(code(source), [
      "Reads aloud.",
      "Never sends text away",
      "export function read(): void {",
      "speak(text);",
    ]);
  });

  it("knows the common comment markers", () => {
    const source = '# python\n\n-- sql\n\n;; lisp\n\n<!-- html -->\n\n/// rust\n\n"""doc"""\n\n/* c */';
    assert.deepEqual(code(source), ["python", "sql", "lisp", "html", "rust", "doc", "c"]);
  });

  it("treats an empty comment line as a block break", () => {
    assert.deepEqual(code("// one\n//\n// two"), ["one", "two"]);
  });

  it("does not split camelCase", () => {
    assert.deepEqual(code("readAloud2Me()"), ["readAloud2Me()"]);
  });
});

describe("codeLineSentences", () => {
  it("falls back to a synthetic piece when a line is not found", () => {
    const sentences = codeLineSentences("missing", "abc", 0, 3);
    assert.deepEqual(
      sentences.map((s) => [s.text, s.sourceStart, s.sourceEnd, s.pieces[0]?.kind]),
      [["missing", 0, 3, "synthetic"]],
    );
  });
});
