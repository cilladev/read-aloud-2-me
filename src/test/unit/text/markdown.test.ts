import * as assert from "node:assert/strict";
import { markdownToSentences } from "../../../text/markdown";
import type { Sentence } from "../../../text/types";
import { assertInvariants, texts } from "./invariants";

const READ_CODE = { skipCodeBlocks: false };
const SKIP_CODE = { skipCodeBlocks: true };

function parse(source: string, options = READ_CODE): Sentence[] {
  const sentences = markdownToSentences(source, options);
  assertInvariants(source, sentences);
  return sentences;
}

function first(source: string): Sentence {
  const [sentence] = parse(source);
  assert.ok(sentence, "no sentence");
  return sentence;
}

function speak(source: string, options = READ_CODE): string[] {
  return texts(parse(source, options));
}

describe("markdownToSentences", () => {
  it("returns nothing for empty input", () => {
    assert.deepEqual(speak(""), []);
    assert.deepEqual(speak("  \n\n"), []);
  });

  describe("headings", () => {
    it("are their own sentence and end with a period", () => {
      assert.deepEqual(speak("# Install\nRun it."), ["Install.", "Run it."]);
    });

    it("keep their own terminal punctuation", () => {
      assert.deepEqual(speak("## Why?\n\n### Steps:\n\nSetext\n======"), ["Why?", "Steps:", "Setext."]);
    });

    it("map the added period to the last heading character", () => {
      const heading = first("## Title ##");
      assert.deepEqual(heading.pieces.at(-1), {
        spokenStart: 5,
        spokenEnd: 6,
        sourceStart: 7,
        sourceEnd: 8,
        kind: "synthetic",
      });
    });
  });

  describe("paragraphs", () => {
    it("split into sentences, merging after Dr.", () => {
      assert.deepEqual(speak("Dr. Smith is here. Use e.g. this.\nIt wraps."), [
        "Dr. Smith is here.",
        "Use e.g. this.",
        "It wraps.",
      ]);
    });

    it("never join sentences across blocks", () => {
      assert.deepEqual(speak("No end here\n\nNext block"), ["No end here", "Next block"]);
    });

    it("read hard line breaks as a space", () => {
      assert.deepEqual(speak("one  \ntwo\\\nthree"), ["one two three"]);
    });
  });

  describe("inline content", () => {
    it("drops emphasis, strong and strikethrough marks", () => {
      assert.deepEqual(speak("A *b* **c** ~~d~~ _e_."), ["A b c d e."]);
    });

    it("reads inline code verbatim, mapped inside the backticks", () => {
      const sentence = first("Run `npm ci` and `` a`b `` now.");
      assert.equal(sentence.text, "Run npm ci and a`b now.");
      const code = sentence.pieces.find((p) => p.sourceStart === 5);
      assert.equal(code?.sourceEnd, 11);
    });

    it("maps backslash escapes exactly", () => {
      const source = "Use \\*stars\\* here.";
      const sentence = first(source);
      assert.equal(sentence.text, "Use *stars* here.");
      assert.ok(sentence.pieces.every((p) => p.kind === "verbatim"));
    });

    it("maps entities as synthetic pieces", () => {
      const source = "Fish &amp; chips &#128512; &copy; ok.";
      const sentence = first(source);
      assert.equal(sentence.text, "Fish & chips 😀 © ok.");
      const amp = sentence.pieces.find((p) => p.kind === "synthetic" && p.sourceStart === 5);
      assert.deepEqual([amp?.spokenStart, amp?.spokenEnd, amp?.sourceEnd], [5, 6, 10]);
      assert.equal(sentence.pieces.find((p) => p.sourceStart === 17)?.spokenEnd, 15);
    });

    it("falls back to one synthetic piece when alignment fails", () => {
      const sentence = first("\\&amp; x");
      assert.equal(sentence.text, "&amp; x");
      assert.deepEqual(
        sentence.pieces.map((p) => p.kind),
        ["synthetic"],
      );
    });

    it("strips emoji shortcodes and keeps unicode emoji", () => {
      assert.deepEqual(speak("Great :smile: work :+1: at 10:30:45 😀."), ["Great work at 10:30:45 😀."]);
    });

    it("keeps UTF-16 offsets after emoji", () => {
      const source = "😀 Hi. 👍🏽 There.";
      const sentences = parse(source);
      assert.deepEqual(texts(sentences), ["😀 Hi.", "👍🏽 There."]);
      assert.equal(sentences[1]?.sourceStart, source.indexOf("👍"));
    });
  });

  describe("links and images", () => {
    it("read only the link label", () => {
      assert.deepEqual(speak("See [the docs](https://x.com/a 'title') and [ref][r].\n\n[r]: https://y.com"), [
        "See the docs and ref.",
      ]);
    });

    it("read a URL label as its domain, mapped to the whole URL", () => {
      const source = "Go to <https://www.github.com/foo/bar> or www.x.com/path or https://a.io.";
      const sentence = first(source);
      assert.equal(sentence.text, "Go to github.com or x.com or a.io.");
      const domain = sentence.pieces.find((p) => p.kind === "synthetic");
      assert.deepEqual([domain?.sourceStart, domain?.sourceEnd], [6, 38]);
    });

    it("read email autolinks as written", () => {
      assert.deepEqual(speak("Mail foo@bar.com or <me@x.org>."), ["Mail foo@bar.com or me@x.org."]);
    });

    it("are silent for images", () => {
      assert.deepEqual(speak("A ![logo](a.png) b ![alt][img].\n\n![only](x.png)\n\n[img]: y.png"), ["A b."]);
    });
  });

  describe("lists", () => {
    it("read items as sentences with markers, numbers and boxes silent", () => {
      assert.deepEqual(speak("- [x] done\n- [ ] todo item\n1. first\n2. second!\n   - nested"), [
        "done.",
        "todo item.",
        "first.",
        "second!",
        "nested.",
      ]);
    });

    it("read loose items with several paragraphs", () => {
      assert.deepEqual(speak("* one\n\n  more text\n\n* two"), ["one.", "more text.", "two."]);
    });
  });

  describe("tables", () => {
    const table = "| Name | Age |\n| --- | --- |\n| Ann | 3 |\n|  | 4 |\n| Bo |  |";

    it("read one sentence per row with headers folded in", () => {
      assert.deepEqual(speak(table), ["Name: Ann, Age: 3.", "Age: 4.", "Name: Bo."]);
    });

    it("map header words to the body cell being read", () => {
      const row = first(table);
      const cellStart = table.indexOf("| Ann");
      const header = row.pieces[0];
      assert.equal(header?.kind, "synthetic");
      assert.deepEqual([header.sourceStart, header.sourceEnd], [cellStart, cellStart + 6]);
    });

    it("join cells with commas when the header is empty", () => {
      assert.deepEqual(speak("|  |  |\n|---|---|\n| a | b |"), ["a, b."]);
    });
  });

  describe("silent blocks", () => {
    it("skip front matter, HTML, breaks and footnote markers", () => {
      const source = "---\ntitle: x\n---\n\n<div>html</div>\n\n***\n\nText[^1] here.\n\n[^1]: The note.";
      assert.deepEqual(speak(source), ["Text here.", "The note."]);
    });

    it("skip TOML front matter", () => {
      assert.deepEqual(speak("+++\ntitle = 'x'\n+++\n\nBody."), ["Body."]);
    });

    it("read blockquotes without a prefix", () => {
      const source = "> Quoted\n> line.\n>\n> > Deeper.";
      assert.deepEqual(speak(source), ["Quoted line.", "Deeper."]);
    });
  });

  describe("code blocks", () => {
    const source = "Before.\n\n```js\nconst x = 1;\n}\n\n  call(x);\n```\n\n    indented()\n\nAfter.";

    it("are silent when skipped", () => {
      assert.deepEqual(speak(source, SKIP_CODE), ["Before.", "After."]);
    });

    it("read each line with words when not skipped", () => {
      assert.deepEqual(speak(source), ["Before.", "const x = 1;", "call(x);", "indented()", "After."]);
    });
  });

  it("handles CRLF line endings", () => {
    const source = "# Title\r\n\r\nOne line\r\nnext. Two.\r\n\r\n- item\r\n";
    assert.deepEqual(speak(source), ["Title.", "One line next.", "Two.", "item."]);
  });
});
