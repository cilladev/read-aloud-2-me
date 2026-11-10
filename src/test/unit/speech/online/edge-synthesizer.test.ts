import * as assert from "node:assert/strict";
import { onlineVoiceName, parseBoundaries } from "../../../../speech/online/edge-synthesizer";

describe("edge-synthesizer helpers", () => {
  it("names online voices for people", () => {
    assert.equal(onlineVoiceName("en-US-AvaMultilingualNeural"), "Ava (multilingual)");
    assert.equal(onlineVoiceName("en-GB-SoniaNeural"), "Sonia");
    assert.equal(onlineVoiceName("zh-CN-liaoning-XiaobeiNeural"), "liaoning-Xiaobei");
  });

  it("reads word boundaries and ignores other metadata", () => {
    const message = JSON.stringify({
      Metadata: [
        { Type: "WordBoundary", Data: { Offset: 500_000, Duration: 2_000_000, text: { Text: "Hello" } } },
        { Type: "WordBoundary", Data: { Offset: 900_000, text: { Text: "there" } } },
        { Type: "SentenceBoundary", Data: { Offset: 0, text: { Text: "Hello." } } },
        { Type: "WordBoundary", Data: { Offset: "bad", text: { Text: "x" } } },
      ],
    });
    assert.deepEqual(parseBoundaries(message), [
      { atMs: 50, text: "Hello", durationMs: 200 },
      { atMs: 90, text: "there" },
    ]);
    assert.deepEqual(parseBoundaries("not json"), []);
    assert.deepEqual(parseBoundaries("[]"), []);
  });
});
