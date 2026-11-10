import * as assert from "node:assert/strict";
import { mp3DurationMs, sliceMp3 } from "../../../../speech/online/mp3";
import { fakeMp3 } from "./mp3-frames";

describe("mp3", () => {
  it("adds up frame durations and skips bytes that aren't frames", () => {
    assert.equal(mp3DurationMs(fakeMp3(10)), 240);
    assert.equal(mp3DurationMs(fakeMp3(10, 37)), 240);
    assert.equal(mp3DurationMs(new Uint8Array(0)), 0);
  });

  it("cuts at the first frame at or after the time", () => {
    const audio = fakeMp3(10);
    const slice = sliceMp3(audio, 50);
    assert.equal(slice.startMs, 72);
    assert.equal(slice.audio.length, 7 * 144);
    assert.equal(slice.audio[0], 0xff);
    assert.equal(mp3DurationMs(slice.audio), 168);
  });

  it("returns the whole audio from zero and nothing past the end", () => {
    const audio = fakeMp3(4);
    assert.equal(sliceMp3(audio, 0).audio.length, audio.length);
    assert.equal(sliceMp3(audio, 500).audio.length, 0);
  });

  it("ignores headers with a bad bitrate, sample rate or layer", () => {
    const audio = new Uint8Array([0xff, 0xf3, 0x04, 0, 0xff, 0xf3, 0x6c, 0, 0xff, 0xf7, 0x64, 0]);
    assert.equal(mp3DurationMs(audio), 0);
  });
});
