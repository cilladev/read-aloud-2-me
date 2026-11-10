import * as assert from "node:assert/strict";
import { mapSpokenOffset, mapSpokenRange } from "../../../text/offset-map";
import { toSentences } from "../../../text/prepare";
import { assertInvariants } from "./invariants";

// A realistic README that exercises most constructs at once. Its prose never contains a
// literal "#", "**", "](" or "|", so none of those may leak into what is spoken.
const README = [
  "---",
  "title: Read Aloud 2 Me",
  "---",
  "",
  "# Read Aloud 2 Me",
  "",
  "![badge](https://img.shields.io/badge.svg) [![ci](https://x.io/ci.svg)](https://x.io)",
  "",
  "Select text, press **Cmd+'** and hear it. Works *offline*, e.g. on a plane. See Fig. 2.",
  "Written by Dr. Ada &amp; friends :tada: 🎉.",
  "",
  "## Features",
  "",
  "- [x] Reads Markdown as plain text",
  "- [ ] Reads `code` comments",
  "  - Nested with a [link](https://example.com/docs) and https://www.github.com/foo/bar",
  "1. Numbered",
  "",
  "> **Note**",
  "> Text never leaves the computer.",
  "",
  "| Setting | Default |",
  "| :------ | ------: |",
  "| `readAloud2Me.voice` | system |",
  "| rate | 1.0 |",
  "",
  "```bash",
  "npm ci",
  "npm run verify",
  "```",
  "",
  "***",
  "",
  "<details><summary>More</summary>",
  "",
  "Hidden text.",
  "",
  "</details>",
  "",
  "Thanks[^1]! Mail <me@example.com>.",
  "",
  "[^1]: To everyone.",
  "",
].join("\n");

describe("README fixture", () => {
  for (const skipCodeBlocks of [true, false]) {
    it(`keeps every invariant (skipCodeBlocks: ${String(skipCodeBlocks)})`, () => {
      const sentences = toSentences(README, "markdown", { skipCodeBlocks });
      assert.ok(sentences.length > 10);
      assertInvariants(README, sentences);
      for (const { text } of sentences) {
        for (const symbol of ["#", "**", "](", "|", "![", "```", "<", ">", "[x]", "[ ]", ":tada:"]) {
          assert.ok(!text.includes(symbol), `"${symbol}" leaked into ${JSON.stringify(text)}`);
        }
      }
    });
  }

  it("reads what a listener wants to hear", () => {
    const spoken = toSentences(README, "markdown", { skipCodeBlocks: true }).map((s) => s.text);
    assert.deepEqual(spoken, [
      "Read Aloud 2 Me.",
      "Select text, press Cmd+' and hear it.",
      "Works offline, e.g. on a plane.",
      "See Fig. 2.",
      "Written by Dr. Ada & friends 🎉.",
      "Features.",
      "Reads Markdown as plain text.",
      "Reads code comments.",
      "Nested with a link and github.com.",
      "Numbered.",
      "Note Text never leaves the computer.",
      "Setting: readAloud2Me.voice, Default: system.",
      "Setting: rate, Default: 1.0.",
      "Hidden text.",
      "Thanks!",
      "Mail me@example.com.",
      "To everyone.",
    ]);
  });

  it("maps every spoken offset inside its sentence", () => {
    for (const sentence of toSentences(README, "markdown", { skipCodeBlocks: false })) {
      for (let offset = 0; offset < sentence.text.length; offset++) {
        const mapped = mapSpokenOffset(sentence, offset);
        assert.ok(mapped >= sentence.sourceStart && mapped <= sentence.sourceEnd);
        const range = mapSpokenRange(sentence, offset, 1);
        assert.ok(range.start <= range.end);
      }
    }
  });
});
