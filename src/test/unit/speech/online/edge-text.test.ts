import * as assert from "node:assert/strict";
import { escapeXml, speechEndMs, ssmlRate, timeWords, unescapeXml } from "../../../../speech/online/edge-text";

describe("edge-text", () => {
  it("escapes and unescapes the XML specials", () => {
    const text = `Tom & Jerry <say> "hi" it's`;
    assert.equal(escapeXml(text), "Tom &amp; Jerry &lt;say&gt; &quot;hi&quot; it&apos;s");
    assert.equal(unescapeXml(escapeXml(text)), text);
  });

  it("turns speed into an SSML rate, clamped to 0.5 to 2", () => {
    assert.equal(ssmlRate(1), "+0%");
    assert.equal(ssmlRate(1.25), "+25%");
    assert.equal(ssmlRate(0.5), "-50%");
    assert.equal(ssmlRate(5), "+100%");
    assert.equal(ssmlRate(0.1), "-50%");
  });

  it("places words in order, case-insensitively, skipping ones it can't find", () => {
    const words = timeWords("Hello there, Tom & Jerry. Hello again.", [
      { atMs: 0, text: "hello" },
      { atMs: 100, text: "there" },
      { atMs: 200, text: "&amp;" },
      { atMs: 250, text: "three point five" },
      { atMs: 300, text: "Hello" },
      { atMs: 400, text: " " },
    ]);
    assert.deepEqual(words, [
      { atMs: 0, start: 0, length: 5 },
      { atMs: 100, start: 6, length: 5 },
      { atMs: 200, start: 17, length: 1 },
      { atMs: 300, start: 26, length: 5 },
    ]);
  });

  it("finds where speech ends from the last word", () => {
    assert.equal(speechEndMs([]), undefined);
    assert.equal(speechEndMs([{ atMs: 100, text: "a", durationMs: 50 }]), 150);
    assert.equal(speechEndMs([{ atMs: 100, text: "a" }]), 100);
  });
});
