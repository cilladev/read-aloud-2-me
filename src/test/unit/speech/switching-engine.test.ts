import * as assert from "node:assert/strict";
import { SpeechError } from "../../../speech/engine";
import type { RunEnd, RunListener, SpeakOptions, SpeechEngine, SpeechRun, Voice } from "../../../speech/engine";
import { SwitchingEngine } from "../../../speech/switching-engine";
import type { VoiceSource } from "../../../speech/switching-engine";

class ScriptedEngine implements SpeechEngine {
  readonly capabilities = { wordEvents: true };
  readonly calls: { sentences: readonly string[]; options: SpeakOptions }[] = [];
  readonly actions: string[] = [];
  disposed = false;
  constructor(
    private readonly name: string,
    private readonly behave: (listener: RunListener) => RunEnd,
  ) {}
  listVoices(): Promise<readonly Voice[]> {
    return Promise.resolve([{ id: this.name, name: this.name, language: "en-US", quality: "default" }]);
  }
  speak(sentences: readonly string[], options: SpeakOptions, listener: RunListener): SpeechRun {
    this.calls.push({ sentences, options });
    const end = this.behave(listener);
    return {
      ended: Promise.resolve(end),
      pause: () => this.actions.push("pause"),
      resume: () => this.actions.push("resume"),
      cancel: () => this.actions.push("cancel"),
    };
  }
  dispose(): void {
    this.disposed = true;
  }
}

const offline: RunEnd = { kind: "failed", error: new SpeechError("networkFailed", "offline") };

function setup(onlineBehaviour: (listener: RunListener) => RunEnd, source: VoiceSource = "online") {
  const online = new ScriptedEngine("online", onlineBehaviour);
  const computer = new ScriptedEngine("computer", () => ({ kind: "finished" }));
  const fallbacks: Error[] = [];
  const engine = new SwitchingEngine(online, computer, {
    source: () => source,
    computerVoice: () => "Samantha",
    onFallback: (error) => fallbacks.push(error),
  });
  return { engine, online, computer, fallbacks };
}

describe("SwitchingEngine", () => {
  it("uses the computer engine when that source is chosen", async () => {
    const { engine, online, computer } = setup(() => ({ kind: "finished" }), "computer");
    await engine.speak(["Hi."], { voice: "Alex", speed: 1 }, {}).ended;
    assert.equal(online.calls.length, 0);
    assert.equal(computer.calls[0]?.options.voice, "Alex");
    assert.equal((await engine.listVoices())[0]?.id, "computer");
    assert.equal((await engine.listVoicesFor("online"))[0]?.id, "online");
  });

  it("falls back to the computer's voice when the online voices can't be reached", async () => {
    const { engine, computer, fallbacks } = setup(() => offline);
    const end = await engine.speak(["Hi."], { voice: "en-US-AvaMultilingualNeural", speed: 1.2 }, {}).ended;
    assert.deepEqual(end, { kind: "finished" });
    assert.equal(fallbacks.length, 1);
    assert.deepEqual(computer.calls[0]?.options, { voice: "Samantha", speed: 1.2 });
  });

  it("does not fall back once a sentence has played", async () => {
    const { engine, computer, fallbacks } = setup((listener) => {
      listener.onSentenceStart?.(0);
      return offline;
    });
    const end = await engine.speak(["Hi.", "There."], { voice: undefined, speed: 1 }, {}).ended;
    assert.equal(end.kind, "failed");
    assert.equal(computer.calls.length, 0);
    assert.equal(fallbacks.length, 0);
  });

  it("does not fall back for other failures or after cancel", async () => {
    const other = setup(() => ({ kind: "failed", error: new SpeechError("toolMissing", "x") }));
    await other.engine.speak(["Hi."], { voice: undefined, speed: 1 }, {}).ended;
    assert.equal(other.computer.calls.length, 0);
    const cancelled = setup(() => offline);
    const run = cancelled.engine.speak(["Hi."], { voice: undefined, speed: 1 }, {});
    run.cancel();
    await run.ended;
    assert.equal(cancelled.computer.calls.length, 0);
  });

  it("passes pause and resume through, and keeps a paused state across the fallback", async () => {
    const { engine, online, computer } = setup(() => offline);
    const run = engine.speak(["Hi."], { voice: undefined, speed: 1 }, {});
    run.pause();
    await run.ended;
    assert.deepEqual(online.actions, ["pause"]);
    assert.deepEqual(computer.actions, ["pause"]);
    run.resume();
    assert.deepEqual(computer.actions, ["pause", "resume"]);
  });

  it("disposes both engines", () => {
    const { engine, online, computer } = setup(() => offline);
    engine.dispose();
    assert.ok(online.disposed && computer.disposed);
  });
});
