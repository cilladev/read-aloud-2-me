import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { SpeechError } from "../../../../speech/engine";
import type { RunEnd, Voice, WordEvent } from "../../../../speech/engine";
import type { AudioPlayback, AudioPlayer, PlaybackEnd } from "../../../../speech/online/audio-player";
import { playbackSignals } from "../../../../speech/online/audio-player";
import type { Synthesis, Synthesizer } from "../../../../speech/online/edge-synthesizer";
import { isNetworkFailure, OnlineEngine } from "../../../../speech/online/online-engine";
import { mp3DurationMs } from "../../../../speech/online/mp3";
import { fakeMp3 } from "./mp3-frames";

/** Returns 10 frames (240 ms) per sentence, with a word at 0 ms and one at 24 ms. */
class FakeSynth implements Synthesizer {
  readonly requests: { text: string; voice: string; speed: number }[] = [];
  failOn: string | undefined;
  wordDurationMs: number | undefined;

  synthesize(text: string, voice: string, speed: number): Promise<Synthesis> {
    this.requests.push({ text, voice, speed });
    if (text === this.failOn) {
      return Promise.reject(new SpeechError("networkFailed", "offline"));
    }
    const audio = fakeMp3(10);
    const [first = "", second = ""] = text.split(" ");
    return Promise.resolve({
      audio,
      durationMs: mp3DurationMs(audio),
      words: [
        { atMs: 0, text: first },
        this.wordDurationMs === undefined
          ? { atMs: 24, text: second }
          : { atMs: 24, text: second, durationMs: this.wordDurationMs },
      ],
    });
  }
  listVoices(): Promise<readonly Voice[]> {
    return Promise.resolve([]);
  }
  dispose(): void {
    this.requests.length = 0;
  }
}

/** Plays nothing; is heard at once, finishes after its duration unless the test holds it. */
class FakePlayer implements AudioPlayer {
  readonly prepared: string[] = [];
  readonly played: { file: string; bytes: number; durationMs: number }[] = [];
  readonly stops: number[] = [];
  hold = false;
  failNext: SpeechError | undefined;
  disposed = false;

  play(file: string, durationMs: number): AudioPlayback {
    this.played.push({ file, bytes: readFileSync(file).length, durationMs });
    const signals = playbackSignals();
    const failure = this.failNext;
    this.failNext = undefined;
    if (failure) {
      signals.settle({ kind: "failed", error: failure });
    } else {
      signals.markStarted(Date.now());
      if (!this.hold) {
        setTimeout(() => {
          signals.settle({ kind: "finished" });
        }, durationMs);
      }
    }
    const index = this.played.length - 1;
    return {
      started: signals.started,
      ended: signals.ended,
      stop: () => {
        this.stops.push(index);
        signals.settle({ kind: "stopped" } satisfies PlaybackEnd);
      },
    };
  }
  prepare(file: string): void {
    this.prepared.push(file);
  }
  dispose(): void {
    this.disposed = true;
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function setup(): {
  engine: OnlineEngine;
  synth: FakeSynth;
  player: FakePlayer;
  starts: number[];
  words: WordEvent[];
} {
  const synth = new FakeSynth();
  const player = new FakePlayer();
  const engine = new OnlineEngine(synth, player);
  return { engine, synth, player, starts: [], words: [] };
}

describe("OnlineEngine", () => {
  it("plays each sentence in order with sentence and word events, then finishes", async () => {
    const { engine, synth, player, starts, words } = setup();
    const run = engine.speak(
      ["One two.", "Three four."],
      { voice: "en-GB-SoniaNeural", speed: 1.5 },
      {
        onSentenceStart: (i) => starts.push(i),
        onWord: (w) => words.push(w),
      },
    );
    assert.deepEqual(await run.ended, { kind: "finished" });
    assert.deepEqual(starts, [0, 1]);
    assert.deepEqual(words, [
      { sentence: 0, start: 0, length: 3 },
      { sentence: 0, start: 4, length: 4 },
      { sentence: 1, start: 0, length: 5 },
      { sentence: 1, start: 6, length: 5 },
    ]);
    assert.equal(player.played.length, 2);
    assert.deepEqual(
      synth.requests.map((r) => [r.voice, r.speed]),
      [
        ["en-GB-SoniaNeural", 1.5],
        ["en-GB-SoniaNeural", 1.5],
      ],
    );
  });

  it("uses the default online voice when none is set, and downloads ahead", async () => {
    const { engine, synth, player } = setup();
    player.hold = true;
    const run = engine.speak(["a b", "c d", "e f", "g h", "i j", "k l"], { voice: undefined, speed: 1 }, {});
    await wait(10);
    assert.equal(synth.requests.length, 4);
    assert.equal(synth.requests[0]?.voice, "en-US-AvaMultilingualNeural");
    run.cancel();
    assert.deepEqual(await run.ended, { kind: "cancelled" });
  });

  it("pauses by stopping, and resumes from a later frame of the same audio", async () => {
    const { engine, synth, player } = setup();
    player.hold = true;
    const run = engine.speak(["One two."], { voice: undefined, speed: 1 }, {});
    await wait(40);
    run.pause();
    assert.deepEqual(player.stops, [0]);
    run.resume();
    await wait(10);
    assert.equal(player.played.length, 2);
    assert.ok((player.played[1]?.bytes ?? 0) < (player.played[0]?.bytes ?? 0), "resumed audio is shorter");
    assert.equal(synth.requests.length, 1, "no second download");
    run.cancel();
    await run.ended;
  });

  it("fails with networkFailed when a download fails", async () => {
    const { engine, synth } = setup();
    synth.failOn = "Two.";
    const run = engine.speak(["One.", "Two."], { voice: undefined, speed: 1 }, {});
    const end = await run.ended;
    assert.ok(isNetworkFailure(end));
  });

  it("fails when the player fails", async () => {
    const { engine, player } = setup();
    player.failNext = new SpeechError("toolMissing", "no afplay");
    const end: RunEnd = await engine.speak(["One."], { voice: undefined, speed: 1 }, {}).ended;
    assert.equal(end.kind, "failed");
    assert.ok(end.error instanceof SpeechError && end.error.code === "toolMissing");
  });

  it("cancels the previous run, removes its audio files, and disposes everything", async () => {
    const { engine, player } = setup();
    player.hold = true;
    const first = engine.speak(["One."], { voice: undefined, speed: 1 }, {});
    await wait(10);
    const file = player.played[0]?.file ?? "";
    assert.ok(existsSync(file));
    const second = engine.speak(["Two."], { voice: undefined, speed: 1 }, {});
    assert.deepEqual(await first.ended, { kind: "cancelled" });
    assert.equal(existsSync(dirname(file)), false);
    engine.dispose();
    assert.deepEqual(await second.ended, { kind: "cancelled" });
    assert.equal(player.disposed, true);
  });

  it("finishes at once with no sentences", async () => {
    const { engine } = setup();
    assert.deepEqual(await engine.speak([], { voice: undefined, speed: 1 }, {}).ended, { kind: "finished" });
  });

  it("moves to the next sentence once the last word ends, skipping trailing silence", async () => {
    const { engine, synth, player } = setup();
    player.hold = true;
    synth.wordDurationMs = 10;
    const starts: number[] = [];
    const began = Date.now();
    const listener = { onSentenceStart: (i: number) => starts.push(i) };
    const run = engine.speak(["One two.", "Three four."], { voice: undefined, speed: 1 }, listener);
    // Each sentence is 240 ms of audio, but speech ends at 34 ms; with the gap it moves on at 184 ms.
    assert.deepEqual(await run.ended, { kind: "finished" });
    assert.ok(Date.now() - began < 480, "trailing silence was not cut");
    assert.deepEqual(starts, [0, 1]);
    assert.deepEqual(player.stops, [0, 1]);
  });

  it("opens the next sentence ahead, and plays that same file", async () => {
    const { engine, player } = setup();
    player.hold = true;
    const run = engine.speak(["One two.", "Three four."], { voice: undefined, speed: 1 }, {});
    await wait(20);
    assert.equal(player.prepared.length, 1);
    assert.ok(player.prepared[0]?.endsWith("1.mp3"));
    run.cancel();
    await run.ended;
  });

  it("times words from when the audio is heard, not when play is asked", async () => {
    const synth = new FakeSynth();
    const words: number[] = [];
    let heard: (at: number) => void = () => undefined;
    const slow: AudioPlayer = {
      play: () => {
        const signals = playbackSignals();
        heard = (at) => {
          signals.markStarted(at);
        };
        return {
          started: signals.started,
          ended: signals.ended,
          stop: () => {
            signals.settle({ kind: "stopped" });
          },
        };
      },
      dispose: () => undefined,
    };
    const engine = new OnlineEngine(synth, slow);
    const began = Date.now();
    const run = engine.speak(
      ["One two."],
      { voice: undefined, speed: 1 },
      { onWord: () => words.push(Date.now() - began) },
    );
    await wait(100);
    assert.deepEqual(words, [], "no words before the audio is heard");
    heard(Date.now());
    await wait(60);
    assert.equal(words.length, 2);
    assert.ok(words.every((at) => at >= 100));
    run.cancel();
    await run.ended;
  });
});
