import * as assert from "node:assert/strict";
import { SpeechError } from "../../../speech/engine";
import type { RunEnd, RunListener, WordEvent } from "../../../speech/engine";
import { MacSayEngine } from "../../../speech/mac-say-engine";
import { fakeSpawner, flush } from "./fake-process";
import type { FakeProcess, FakeSpawner } from "./fake-process";

const OPTIONS = { voice: undefined, speed: 1 };
const SENTENCES = ["Hi there.", "Go now.", "Bye."];

/** One `say -i` frame highlighting `line[start, start+length)`, as say prints it. */
function frame(line: string, start: number, length: number): string {
  const word = line.slice(start, start + length);
  return `\r\x1b[M${line.slice(0, start)}\x1b[7m${word}\x1b(B\x1b[m${line.slice(start + length)}`;
}

interface Recorder {
  readonly listener: RunListener;
  readonly events: string[];
  readonly words: WordEvent[];
}

function recorder(): Recorder {
  const events: string[] = [];
  const words: WordEvent[] = [];
  return {
    events,
    words,
    listener: {
      onSentenceStart: (index) => events.push(`sentence ${String(index)}`),
      onWord: (word) => {
        words.push(word);
        events.push(`word ${String(word.sentence)}:${String(word.start)}+${String(word.length)}`);
      },
    },
  };
}

async function say(child: FakeProcess, start: number, length: number): Promise<void> {
  child.out(frame(child.stdinText, start, length));
  await flush();
}

describe("MacSayEngine", () => {
  let spawner: FakeSpawner;
  let engine: MacSayEngine;

  beforeEach(() => {
    spawner = fakeSpawner();
    engine = new MacSayEngine(spawner.spawn);
  });

  afterEach(() => {
    engine.dispose();
  });

  it("has word events", () => {
    assert.equal(engine.capabilities.wordEvents, true);
  });

  it("spawns say -i with rate, voice, stdin text and TERM", async () => {
    engine.speak(SENTENCES, { voice: "Eddy (English (UK))", speed: 1.5 }, {});
    const child = spawner.last();
    await flush();
    assert.equal(child.command, "say");
    assert.deepEqual(child.args, ["-i", "-v", "Eddy (English (UK))", "-r", "263", "-f", "-"]);
    assert.equal(typeof child.env?.["TERM"], "string");
    assert.equal(child.stdinText, "Hi there. Go now. Bye.");
    assert.equal(child.stdinEnded, true);
  });

  it("leaves out -v without a voice and puts any line breaks on one line", async () => {
    engine.speak(["One\ntwo.", "Three\r\n"], OPTIONS, {});
    await flush();
    assert.deepEqual(spawner.last().args, ["-i", "-r", "175", "-f", "-"]);
    assert.equal(spawner.last().stdinText, "One two. Three  ");
  });

  it("maps words to sentences and announces each sentence once, in order", async () => {
    const rec = recorder();
    engine.speak(SENTENCES, OPTIONS, rec.listener);
    const child = spawner.last();
    await flush();
    await say(child, 0, 2);
    await say(child, 3, 6);
    await say(child, 10, 2);
    await say(child, 13, 4);
    assert.deepEqual(rec.events, ["sentence 0", "word 0:0+2", "word 0:3+6", "sentence 1", "word 1:0+2", "word 1:3+4"]);
  });

  it("announces skipped sentences when a word jumps ahead", async () => {
    const rec = recorder();
    engine.speak(SENTENCES, OPTIONS, rec.listener);
    await flush();
    await say(spawner.last(), 18, 4);
    assert.deepEqual(rec.events, ["sentence 0", "sentence 1", "sentence 2", "word 2:0+4"]);
  });

  it("finishes when say exits 0", async () => {
    const run = engine.speak(SENTENCES, OPTIONS, {});
    await spawner.last().exit(0);
    assert.deepEqual(await run.ended, { kind: "finished" });
  });

  it("finishes at once with no sentences", async () => {
    const run = engine.speak([], OPTIONS, {});
    assert.deepEqual(await run.ended, { kind: "finished" });
    assert.equal(spawner.processes.length, 0);
  });

  it("cancels with SIGTERM and settles cancelled", async () => {
    const run = engine.speak(SENTENCES, OPTIONS, {});
    run.cancel();
    run.cancel();
    assert.deepEqual(spawner.last().signals, ["SIGTERM"]);
    await spawner.last().exit(null, "SIGTERM");
    assert.deepEqual(await run.ended, { kind: "cancelled" });
  });

  it("fails with processFailed and stderr on a non-zero exit", async () => {
    const run = engine.speak(SENTENCES, OPTIONS, {});
    spawner.last().err("something broke\n");
    await spawner.last().exit(1);
    const end = await run.ended;
    assert.ok(end.kind === "failed");
    const error = end.error;
    assert.ok(error instanceof SpeechError);
    assert.equal(error.code, "processFailed");
    assert.match(error.message, /something broke/);
  });

  it("fails with voiceNotFound when say says so", async () => {
    const run = engine.speak(SENTENCES, { voice: "Nobody", speed: 1 }, {});
    spawner.last().err("Voice `Nobody' not found.\n");
    await spawner.last().exit(1);
    const end = await run.ended;
    assert.equal(end.kind === "failed" && end.error instanceof SpeechError && end.error.code, "voiceNotFound");
  });

  it("fails with toolMissing when say cannot be spawned", async () => {
    const run = engine.speak(SENTENCES, OPTIONS, {});
    spawner.last().emit("error", Object.assign(new Error("spawn say ENOENT"), { code: "ENOENT" }));
    await spawner.last().exit(-2);
    const end = await run.ended;
    assert.equal(end.kind === "failed" && end.error instanceof SpeechError && end.error.code, "toolMissing");
  });

  it("fails when the spawner throws", async () => {
    const throwing = new MacSayEngine(() => {
      throw new Error("bad spawn");
    });
    const end = await throwing.speak(SENTENCES, OPTIONS, {}).ended;
    assert.equal(end.kind, "failed");
  });

  it("pauses by killing say and resumes from the current word with re-based offsets", async () => {
    const rec = recorder();
    const run = engine.speak(SENTENCES, OPTIONS, rec.listener);
    const first = spawner.last();
    await flush();
    await say(first, 0, 2);
    await say(first, 3, 6);
    run.pause();
    assert.deepEqual(first.signals, ["SIGTERM"]);
    await first.exit(null, "SIGTERM");
    run.resume();
    const second = spawner.last();
    assert.notEqual(second, first);
    await flush();
    assert.equal(second.stdinText, "there. Go now. Bye.");
    await say(second, 0, 6);
    await say(second, 7, 2);
    await say(second, 15, 4);
    assert.deepEqual(rec.events.slice(3), ["word 0:3+6", "sentence 1", "word 1:0+2", "sentence 2", "word 2:0+4"]);
    await second.exit(0);
    assert.deepEqual(await run.ended, { kind: "finished" });
  });

  it("resumes from the start when paused before any word, and resume is a no-op otherwise", async () => {
    const run = engine.speak(SENTENCES, OPTIONS, {});
    run.resume();
    assert.equal(spawner.processes.length, 1);
    run.pause();
    run.resume();
    await flush();
    assert.equal(spawner.last().stdinText, "Hi there. Go now. Bye.");
    assert.equal(spawner.processes.length, 2);
  });

  it("can be cancelled while paused", async () => {
    const run = engine.speak(SENTENCES, OPTIONS, {});
    run.pause();
    run.cancel();
    assert.deepEqual(await run.ended, { kind: "cancelled" });
    run.resume();
    assert.equal(spawner.processes.length, 1);
  });

  it("ignores events from a killed process", async () => {
    const rec = recorder();
    const run = engine.speak(SENTENCES, OPTIONS, rec.listener);
    const first = spawner.last();
    run.pause();
    await say(first, 0, 2);
    await first.exit(1);
    run.resume();
    await first.exit(0);
    assert.deepEqual(rec.events, []);
    run.cancel();
    assert.deepEqual(await run.ended, { kind: "cancelled" });
  });

  it("cancels the current run when a new one starts, and settles once", async () => {
    const ends: RunEnd[] = [];
    const first = engine.speak(SENTENCES, OPTIONS, {});
    first.ended.then(
      (end) => ends.push(end),
      (error: unknown) => {
        throw error;
      },
    );
    const firstChild = spawner.last();
    engine.speak(["Next."], OPTIONS, {});
    assert.deepEqual(firstChild.signals, ["SIGTERM"]);
    await firstChild.exit(0);
    first.cancel();
    await flush();
    assert.deepEqual(ends, [{ kind: "cancelled" }]);
  });

  it("dispose cancels the active run", async () => {
    const run = engine.speak(SENTENCES, OPTIONS, {});
    engine.dispose();
    assert.deepEqual(await run.ended, { kind: "cancelled" });
  });

  it("ignores EPIPE on stdin", async () => {
    const run = engine.speak(SENTENCES, OPTIONS, {});
    spawner.last().stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    await spawner.last().exit(0);
    assert.deepEqual(await run.ended, { kind: "finished" });
  });
});
