import * as assert from "node:assert/strict";
import { SayFrameParser } from "../../../speech/say-frame-parser";
import type { SayWord } from "../../../speech/say-frame-parser";

// Captured from `say -i -r 500 -f -` on macOS 26.5, chunk by chunk as stdout delivered them.
const HI_THERE = [
  "\x1b[?25l",
  "\r\x1b[M\x1b[7mH",
  "i\x1b(B\x1b[m there. Go now.",
  "\r\x1b[MHi \x1b[7mthere.\x1b(B\x1b[m Go no",
  "w.",
  "\r\x1b[MHi there. \x1b[7",
  "mGo\x1b(B\x1b[m now.",
  "\r\x1b[MHi there. Go \x1b[7mnow.\x1b(B\x1b[m",
  "\r\x1b[MHi there. Go now.\n\x1b[?12l\x1b[?25h",
  "\x1b[?12l\x1b[?25h",
];

// Input "a 🎉 b café d". say repeats the emoji frame; the prefix length is UTF-16 code units.
const EMOJI = [
  "\x1b[?25l",
  "\r\x1b[M\x1b[7ma\x1b(B",
  "\x1b[m 🎉 b café d",
  "\r\x1b[Ma \x1b[7m🎉\x1b(B\x1b[m b café d",
  "\r\x1b[Ma \x1b[7m🎉\x1b(B\x1b[m b café d",
  "\r\x1b[Ma 🎉 \x1b[7mb\x1b(B\x1b[m",
  " café d",
  "\r\x1b[Ma 🎉 b \x1b[7mca",
  "fé\x1b(B\x1b[m d",
  "\r\x1b[Ma 🎉 b café \x1b[7md\x1b(B\x1b[m",
  "\r\x1b[Ma 🎉 b café d\n",
  "\x1b[?12l\x1b[?25h",
  "\x1b[?12l\x1b[?25h",
];

function parseAll(chunks: readonly string[]): SayWord[] {
  const parser = new SayFrameParser();
  return chunks.flatMap((chunk) => parser.push(chunk));
}

function words(text: string, found: readonly SayWord[]): string[] {
  return found.map((word) => text.slice(word.start, word.start + word.length));
}

describe("SayFrameParser", () => {
  it("parses real say -i output into words", () => {
    const found = parseAll(HI_THERE);
    assert.deepEqual(found, [
      { start: 0, length: 2 },
      { start: 3, length: 6 },
      { start: 10, length: 2 },
      { start: 13, length: 4 },
    ]);
    assert.deepEqual(words("Hi there. Go now.", found), ["Hi", "there.", "Go", "now."]);
  });

  it("reports UTF-16 offsets and drops repeated frames", () => {
    const text = "a 🎉 b café d";
    const found = parseAll(EMOJI);
    assert.deepEqual(words(text, found), ["a", "🎉", "b", "café", "d"]);
    assert.deepEqual(found[2], { start: 5, length: 1 });
  });

  it("gives the same words however the output is split", () => {
    const whole = HI_THERE.join("");
    assert.deepEqual(parseAll(Array.from({ length: whole.length }, (_, i) => whole.charAt(i))), parseAll(HI_THERE));
    assert.deepEqual(parseAll([whole]), parseAll(HI_THERE));
  });

  it("emits a word only once its end marker arrives", () => {
    const parser = new SayFrameParser();
    assert.deepEqual(parser.push("\x1b[?25l\r\x1b[M\x1b[7mHel"), []);
    assert.deepEqual(parser.push("lo\x1b(B\x1b[m"), [{ start: 0, length: 5 }]);
  });

  it("skips frames without a word and the cursor-restore tail", () => {
    assert.deepEqual(parseAll(["\r\x1b[Mplain line\r\x1b[Mx \x1b[7my\x1b(B\x1b[m\n\x1b[?12l\x1b[?25h"]), [
      { start: 2, length: 1 },
    ]);
  });

  it("never throws on garbage", () => {
    const parser = new SayFrameParser();
    const junk = ["", "\x1b(B", "\x1b[7m", "\r", "\x1b[M", "\u0000￿", "\r\x1b[M\x1b(B\x1b[7m", "x".repeat(10000)];
    for (const chunk of junk) {
      assert.doesNotThrow(() => parser.push(chunk));
    }
    assert.deepEqual(parser.push("\r\x1b[Mok \x1b[7mgo\x1b(B"), [{ start: 3, length: 2 }]);
  });
});
