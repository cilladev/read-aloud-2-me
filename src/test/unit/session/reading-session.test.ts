import * as assert from "node:assert/strict";
import type { RunEnd, RunListener, SpeakOptions, SpeechEngine, SpeechRun, Voice } from "../../../speech/engine";
import { ReadingSession } from "../../../session/reading-session";
import type { SessionState, SessionWord } from "../../../session/reading-session";

/** A run the test drives by hand. */
class FakeRun implements SpeechRun {
  readonly calls: string[] = [];
  readonly ended: Promise<RunEnd>;
  private settle!: (end: RunEnd) => void;

  constructor(
    readonly sentences: readonly string[],
    readonly options: SpeakOptions,
    readonly listener: RunListener,
  ) {
    this.ended = new Promise((resolve) => (this.settle = resolve));
  }

  pause(): void {
    this.calls.push("pause");
  }
  resume(): void {
    this.calls.push("resume");
  }
  cancel(): void {
    this.calls.push("cancel");
    this.settle({ kind: "cancelled" });
  }
  finish(end: RunEnd = { kind: "finished" }): void {
    this.settle(end);
  }
}

class FakeEngine implements SpeechEngine {
  readonly capabilities = { wordEvents: true };
  readonly runs: FakeRun[] = [];

  listVoices(): Promise<readonly Voice[]> {
    return Promise.resolve([]);
  }
  speak(sentences: readonly string[], options: SpeakOptions, listener: RunListener): SpeechRun {
    const run = new FakeRun(sentences, options, listener);
    this.runs.push(run);
    return run;
  }
  dispose(): void {
    this.runs.forEach((run) => {
      run.cancel();
    });
  }
  get last(): FakeRun {
    const run = this.runs.at(-1);
    assert.ok(run, "no run started");
    return run;
  }
}

const SENTENCES = ["One.", "Two.", "Three."];
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function setup(): {
  engine: FakeEngine;
  session: ReadingSession;
  states: SessionState[];
  sentences: [number, number][];
  words: SessionWord[];
  ends: RunEnd[];
  options: { voice: string | undefined; speed: number };
} {
  const engine = new FakeEngine();
  const options = { voice: undefined as string | undefined, speed: 1 };
  const session = new ReadingSession(engine, () => ({ ...options }));
  const states: SessionState[] = [];
  const sentences: [number, number][] = [];
  const words: SessionWord[] = [];
  const ends: RunEnd[] = [];
  session.subscribe({
    onState: (s) => states.push(s),
    onSentence: (i, n) => sentences.push([i, n]),
    onWord: (w) => words.push(w),
    onEnd: (e) => ends.push(e),
  });
  return { engine, session, states, sentences, words, ends, options };
}

describe("ReadingSession", () => {
  it("starts reading from the first sentence", () => {
    const { engine, session, states, sentences } = setup();
    session.start(SENTENCES);
    assert.equal(session.state, "reading");
    assert.deepEqual(engine.last.sentences, SENTENCES);
    assert.deepEqual(states, ["reading"]);
    assert.deepEqual(sentences[0], [0, 3]);
  });

  it("starts from a given sentence and clamps out-of-range starts", () => {
    const { engine, session } = setup();
    session.start(SENTENCES, 1);
    assert.deepEqual(engine.last.sentences, ["Two.", "Three."]);
    session.start(SENTENCES, 99);
    assert.deepEqual(engine.last.sentences, ["Three."]);
    assert.equal(session.current, 2);
  });

  it("ends at once for an empty list", () => {
    const { engine, session, ends } = setup();
    session.start([]);
    assert.equal(engine.runs.length, 0);
    assert.equal(session.state, "idle");
    assert.deepEqual(ends, [{ kind: "finished" }]);
  });

  it("maps run-relative sentence and word indexes to session indexes", () => {
    const { engine, session, sentences, words } = setup();
    session.start(SENTENCES, 1);
    engine.last.listener.onSentenceStart?.(1);
    engine.last.listener.onWord?.({ sentence: 1, start: 0, length: 5 });
    assert.equal(session.current, 2);
    assert.deepEqual(sentences.at(-1), [2, 3]);
    assert.deepEqual(words, [{ sentence: 2, start: 0, length: 5 }]);
  });

  it("goes idle and reports when the run finishes", async () => {
    const { engine, session, ends } = setup();
    session.start(SENTENCES);
    engine.last.finish();
    await flush();
    assert.equal(session.state, "idle");
    assert.deepEqual(ends, [{ kind: "finished" }]);
  });

  it("reports a failed run", async () => {
    const { engine, session, ends } = setup();
    session.start(SENTENCES);
    const error = new Error("boom");
    engine.last.finish({ kind: "failed", error });
    await flush();
    assert.equal(session.state, "idle");
    assert.deepEqual(ends, [{ kind: "failed", error }]);
  });

  it("pauses and resumes the same run", () => {
    const { engine, session, states } = setup();
    session.start(SENTENCES);
    session.togglePause();
    assert.equal(session.state, "paused");
    session.togglePause();
    assert.equal(session.state, "reading");
    assert.deepEqual(engine.last.calls, ["pause", "resume"]);
    assert.equal(engine.runs.length, 1);
    assert.deepEqual(states, ["reading", "paused", "reading"]);
  });

  it("ignores pause and resume in the wrong state", () => {
    const { engine, session } = setup();
    session.pause();
    session.resume();
    session.start(SENTENCES);
    session.resume();
    assert.deepEqual(engine.last.calls, []);
  });

  it("moves to the next and previous sentence with a new run", () => {
    const { engine, session } = setup();
    session.start(SENTENCES);
    session.next();
    assert.equal(session.current, 1);
    assert.deepEqual(engine.last.sentences, ["Two.", "Three."]);
    assert.deepEqual(engine.runs[0]?.calls, ["cancel"]);
    session.previous();
    assert.equal(session.current, 0);
    session.previous();
    assert.equal(session.current, 0);
    assert.equal(engine.runs.length, 4);
  });

  it("does not move past the last sentence", () => {
    const { engine, session } = setup();
    session.start(SENTENCES, 2);
    session.next();
    assert.equal(engine.runs.length, 1);
  });

  it("navigating while paused starts reading again", () => {
    const { session } = setup();
    session.start(SENTENCES);
    session.pause();
    session.next();
    assert.equal(session.state, "reading");
  });

  it("jumps to a valid sentence and ignores invalid ones", () => {
    const { engine, session } = setup();
    session.jumpTo(1);
    assert.equal(engine.runs.length, 0);
    session.start(SENTENCES);
    session.jumpTo(2);
    assert.equal(session.current, 2);
    session.jumpTo(5);
    session.jumpTo(-1);
    session.jumpTo(1.5);
    assert.equal(engine.runs.length, 2);
  });

  it("restarts the current sentence with new options", () => {
    const { engine, session, options } = setup();
    session.start(SENTENCES);
    engine.last.listener.onSentenceStart?.(1);
    options.speed = 1.5;
    session.restartCurrent();
    assert.deepEqual(engine.last.sentences, ["Two.", "Three."]);
    assert.equal(engine.last.options.speed, 1.5);
  });

  it("defers a restart while paused until resume", () => {
    const { engine, session, options } = setup();
    session.start(SENTENCES);
    session.pause();
    options.voice = "Ava";
    session.restartCurrent();
    assert.equal(engine.runs.length, 1);
    session.resume();
    assert.equal(engine.runs.length, 2);
    assert.equal(engine.last.options.voice, "Ava");
    assert.equal(session.state, "reading");
  });

  it("stops and reports cancelled once", async () => {
    const { engine, session, ends } = setup();
    session.start(SENTENCES);
    session.stop();
    session.stop();
    await flush();
    assert.equal(session.state, "idle");
    assert.deepEqual(engine.last.calls, ["cancel"]);
    assert.deepEqual(ends, [{ kind: "cancelled" }]);
  });

  it("ignores events and endings from a replaced run", async () => {
    const { engine, session, words, ends } = setup();
    session.start(SENTENCES);
    const old = engine.last;
    session.next();
    old.listener.onWord?.({ sentence: 0, start: 0, length: 3 });
    old.listener.onSentenceStart?.(2);
    old.finish();
    await flush();
    assert.deepEqual(words, []);
    assert.equal(session.current, 1);
    assert.equal(session.state, "reading");
    assert.deepEqual(ends, []);
  });

  it("removes a listener with the returned function", () => {
    const { session } = setup();
    const seen: SessionState[] = [];
    const remove = session.subscribe({ onState: (s) => seen.push(s) });
    remove();
    session.start(SENTENCES);
    assert.deepEqual(seen, []);
  });
});
