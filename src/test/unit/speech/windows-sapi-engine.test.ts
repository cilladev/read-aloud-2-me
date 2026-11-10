import * as assert from "node:assert/strict";
import type { RunEnd, SpeakOptions, WordEvent } from "../../../speech/engine";
import { SpeechError } from "../../../speech/engine";
import { sapiRate } from "../../../speech/rate";
import { WindowsSapiEngine } from "../../../speech/windows-sapi-engine";
import type { WindowsEngineOptions } from "../../../speech/windows-sapi-engine";
import { fakeHostSpawner, settle } from "./fake-windows-host";
import type { FakeHostOptions, FakeHostSpawner } from "./fake-windows-host";

// The Windows engine against a scripted fake host: never a real process, never sound.

const SCRIPT = "C:\\Users\\me\\.vscode\\extensions\\read-aloud-2-me\\resources\\speech-host.ps1";
const NORMAL: SpeakOptions = { voice: undefined, speed: 1 };

interface Setup {
  readonly engine: WindowsSapiEngine;
  readonly fake: FakeHostSpawner;
  readonly logs: string[];
}

function setup(
  options: FakeHostOptions = {},
  perSpawn: FakeHostOptions[] = [],
  extra: WindowsEngineOptions = {},
): Setup {
  const fake = fakeHostSpawner(options, perSpawn);
  const logs: string[] = [];
  const engine = new WindowsSapiEngine(SCRIPT, fake.spawn, { log: (message) => logs.push(message), ...extra });
  return { engine, fake, logs };
}

async function peek(ended: Promise<RunEnd>): Promise<RunEnd | "pending"> {
  await settle();
  return Promise.race([ended, Promise.resolve("pending" as const)]);
}

function failedCode(end: RunEnd): string {
  assert.ok(end.kind === "failed", `expected failed, got ${end.kind}`);
  assert.ok(end.error instanceof SpeechError);
  return end.error.code;
}

describe("WindowsSapiEngine: process", () => {
  it("starts nothing until first used", () => {
    const { fake } = setup();
    assert.equal(fake.hosts.length, 0);
  });

  it("spawns powershell.exe with the exact argument list and keeps text out of it", async () => {
    const { engine, fake } = setup();
    const run = engine.speak(["Secret words here."], NORMAL, {});
    assert.equal((await run.ended).kind, "finished");
    const host = fake.last();
    assert.equal(host.command, "powershell.exe");
    assert.deepEqual(host.args, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SCRIPT,
    ]);
    assert.ok(!host.args.some((arg) => arg.includes("Secret") || /encoded/i.test(arg)));
  });

  it("reuses one host across runs and voice lists", async () => {
    const { engine, fake } = setup({ voices: [] });
    await engine.speak(["One."], NORMAL, {}).ended;
    await engine.speak(["Two."], NORMAL, {}).ended;
    await engine.listVoices();
    assert.equal(fake.hosts.length, 1);
  });

  it("fails the run with toolMissing when powershell.exe is not found", async () => {
    const { engine } = setup({ spawnErrorCode: "ENOENT" });
    assert.equal(failedCode(await engine.speak(["Hi."], NORMAL, {}).ended), "toolMissing");
  });

  it("fails with processFailed on other spawn errors", async () => {
    const { engine } = setup({ spawnErrorCode: "EACCES" });
    assert.equal(failedCode(await engine.speak(["Hi."], NORMAL, {}).ended), "processFailed");
  });

  it("fails the run with processFailed when the host dies mid-run, then restarts on the next speak", async () => {
    const { engine, fake } = setup({ speech: "manual" }, [{ speech: "manual" }, { speech: "auto" }]);
    const first = engine.speak(["One.", "Two."], NORMAL, {});
    await settle();
    fake.last().exit(1);
    assert.equal(failedCode(await first.ended), "processFailed");
    const second = engine.speak(["Again."], NORMAL, {});
    assert.equal((await second.ended).kind, "finished");
    assert.equal(fake.hosts.length, 2);
  });

  it("includes stderr in the crash message", async () => {
    const { engine, fake } = setup({ speech: "manual" });
    const run = engine.speak(["One."], NORMAL, {});
    await settle();
    fake.last().stderr.write("Add-Type: boom");
    await settle();
    fake.last().exit(1);
    const end = await run.ended;
    assert.ok(end.kind === "failed" && end.error.message.includes("boom"));
  });

  it("sends quit, closes stdin and cancels the run on dispose", async () => {
    const { engine, fake } = setup({ speech: "manual" });
    const run = engine.speak(["One."], NORMAL, {});
    await settle();
    engine.dispose();
    await settle();
    const host = fake.last();
    assert.equal((await run.ended).kind, "cancelled");
    assert.deepEqual(
      host.requests.slice(-2).map((request) => request.type),
      ["cancel", "quit"],
    );
    assert.ok(host.stdinEnded);
  });

  it("kills a host that ignores quit after the grace period", async () => {
    const { engine, fake } = setup({ speech: "manual" });
    engine.speak(["One."], NORMAL, {});
    await settle();
    const host = fake.last();
    host.stdin.removeAllListeners("data");
    engine.dispose();
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.deepEqual(host.signals, [undefined]);
  });

  it("does not start a host on dispose when none is running", () => {
    const { engine, fake } = setup();
    engine.dispose();
    assert.equal(fake.hosts.length, 0);
  });

  it("fails speak and listVoices after dispose", async () => {
    const { engine } = setup();
    engine.dispose();
    assert.equal(failedCode(await engine.speak(["Hi."], NORMAL, {}).ended), "processFailed");
    await assert.rejects(engine.listVoices(), { code: "processFailed" });
  });
});

describe("WindowsSapiEngine: voices", () => {
  it("lists voices and marks Natural voices as premium", async () => {
    const { engine } = setup({
      voices: [
        { name: "Microsoft Zira Desktop", culture: "en-US", gender: "Female" },
        { name: "Microsoft Aria Natural", culture: "en-US", gender: "Female" },
      ],
    });
    assert.deepEqual(await engine.listVoices(), [
      { id: "Microsoft Zira Desktop", name: "Microsoft Zira Desktop", language: "en-US", quality: "default" },
      { id: "Microsoft Aria Natural", name: "Microsoft Aria Natural", language: "en-US", quality: "premium" },
    ]);
  });

  it("matches answers to requests by id", async () => {
    const { engine, fake } = setup({ voices: [{ name: "A", culture: "", gender: "" }] });
    await engine.listVoices();
    await engine.listVoices();
    assert.deepEqual(
      fake
        .last()
        .requestsOf("voices")
        .map((request) => request["id"]),
      [1, 2],
    );
  });

  it("rejects with processFailed when the host does not answer in time", async () => {
    const { engine } = setup({ voices: undefined }, [], { voicesTimeoutMs: 30 });
    await assert.rejects(engine.listVoices(), { name: "SpeechError", code: "processFailed" });
  });

  it("rejects when the host exits before answering", async () => {
    const { engine, fake } = setup({ voices: undefined });
    const voices = engine.listVoices();
    await settle();
    fake.last().exit(1);
    await assert.rejects(voices, { code: "processFailed" });
  });

  it("rejects with toolMissing when powershell.exe is missing", async () => {
    const { engine } = setup({ spawnErrorCode: "ENOENT" });
    await assert.rejects(engine.listVoices(), { code: "toolMissing" });
  });
});

describe("WindowsSapiEngine: speaking", () => {
  it("sends one speak message per sentence with the SAPI rate and voice", async () => {
    const { engine, fake } = setup();
    await engine.speak(["One.", "Two.", "Three."], { voice: "Microsoft David Desktop", speed: 2 }, {}).ended;
    assert.deepEqual(fake.last().requestsOf("speak"), [
      { type: "speak", run: 1, index: 0, text: "One.", voice: "Microsoft David Desktop", rate: sapiRate(2) },
      { type: "speak", run: 1, index: 1, text: "Two.", voice: "Microsoft David Desktop", rate: sapiRate(2) },
      { type: "speak", run: 1, index: 2, text: "Three.", voice: "Microsoft David Desktop", rate: sapiRate(2) },
    ]);
  });

  it("sends voice null for the system default", async () => {
    const { engine, fake } = setup();
    await engine.speak(["One."], { voice: undefined, speed: 0.5 }, {}).ended;
    assert.deepEqual(fake.last().requestsOf("speak")[0], {
      type: "speak",
      run: 1,
      index: 0,
      text: "One.",
      voice: null,
      rate: sapiRate(0.5),
    });
  });

  it("reports sentence starts and words, then finishes", async () => {
    const { engine } = setup();
    const starts: number[] = [];
    const words: WordEvent[] = [];
    const run = engine.speak(["Hello there.", "Bye."], NORMAL, {
      onSentenceStart: (index) => starts.push(index),
      onWord: (word) => words.push(word),
    });
    assert.deepEqual(await run.ended, { kind: "finished" });
    assert.deepEqual(starts, [0, 1]);
    assert.deepEqual(words, [
      { sentence: 0, start: 0, length: 5 },
      { sentence: 0, start: 6, length: 6 },
      { sentence: 1, start: 0, length: 4 },
    ]);
  });

  it("finishes only after the last sentence ends", async () => {
    const { engine, fake } = setup({ speech: "manual" });
    const run = engine.speak(["One.", "Two."], NORMAL, {});
    await settle();
    fake.last().playSentence(1, 0, "One.");
    assert.equal(await peek(run.ended), "pending");
    fake.last().playSentence(1, 1, "Two.");
    assert.deepEqual(await peek(run.ended), { kind: "finished" });
  });

  it("finishes at once for no sentences, without starting a host", async () => {
    const { engine, fake } = setup();
    assert.deepEqual(await engine.speak([], NORMAL, {}).ended, { kind: "finished" });
    assert.equal(fake.hosts.length, 0);
  });

  it("clamps word offsets to the sentence and drops words past its end", async () => {
    const { engine, fake } = setup({ speech: "manual" });
    const words: WordEvent[] = [];
    engine.speak(["Hi you."], NORMAL, { onWord: (word) => words.push(word) });
    await settle();
    fake.last().emitEvent({ type: "word", run: 1, index: 0, start: 3, length: 10 });
    fake.last().emitEvent({ type: "word", run: 1, index: 0, start: 40, length: 2 });
    fake.last().emitEvent({ type: "word", run: 1, index: 5, start: 0, length: 2 });
    await settle();
    assert.deepEqual(words, [{ sentence: 0, start: 3, length: 4 }]);
  });

  it("cancels the old run when a new one starts and ignores its late events", async () => {
    const { engine, fake } = setup({ speech: "manual" });
    const firstStarts: number[] = [];
    const secondStarts: number[] = [];
    const first = engine.speak(["Old."], NORMAL, { onSentenceStart: (index) => firstStarts.push(index) });
    await settle();
    const second = engine.speak(["New one.", "Two."], NORMAL, { onSentenceStart: (index) => secondStarts.push(index) });
    assert.deepEqual(await first.ended, { kind: "cancelled" });
    await settle();
    const host = fake.last();
    assert.deepEqual(
      host.requests.map((request) => [request.type, request["run"]]),
      [
        ["speak", 1],
        ["cancel", 1],
        ["speak", 2],
        ["speak", 2],
      ],
    );
    host.playSentence(1, 0, "Old.");
    host.emitEvent({ type: "sentenceEnd", run: 1, index: 1 });
    assert.equal(await peek(second.ended), "pending");
    assert.deepEqual(firstStarts, []);
    assert.deepEqual(secondStarts, []);
    host.playSentence(2, 0, "New one.");
    host.playSentence(2, 1, "Two.");
    assert.deepEqual(await peek(second.ended), { kind: "finished" });
    assert.deepEqual(secondStarts, [0, 1]);
  });

  it("logs a listener that throws and keeps going", async () => {
    const { engine, logs } = setup();
    const run = engine.speak(["One."], NORMAL, {
      onSentenceStart: () => {
        throw new Error("listener broke");
      },
    });
    assert.equal((await run.ended).kind, "finished");
    assert.ok(logs.some((line) => line.includes("listener broke")));
  });
});

describe("WindowsSapiEngine: pause, resume, cancel", () => {
  it("sends pause and resume, and resume only after pause", async () => {
    const { engine, fake } = setup({ speech: "manual" });
    const run = engine.speak(["One."], NORMAL, {});
    await settle();
    run.resume();
    run.pause();
    run.pause();
    run.resume();
    await settle();
    assert.deepEqual(
      fake.last().requests.map((request) => request.type),
      ["speak", "pause", "resume"],
    );
  });

  it("cancel sends cancel once and settles cancelled", async () => {
    const { engine, fake } = setup({ speech: "manual" });
    const run = engine.speak(["One."], NORMAL, {});
    await settle();
    run.cancel();
    run.cancel();
    assert.deepEqual(await run.ended, { kind: "cancelled" });
    await settle();
    assert.deepEqual(fake.last().requestsOf("cancel"), [{ type: "cancel", run: 1 }]);
  });

  it("ignores pause, resume and cancel after the run finished", async () => {
    const { engine, fake } = setup();
    const run = engine.speak(["One."], NORMAL, {});
    await run.ended;
    run.pause();
    run.resume();
    run.cancel();
    await settle();
    assert.deepEqual(
      fake.last().requests.map((request) => request.type),
      ["speak"],
    );
  });
});

describe("WindowsSapiEngine: errors", () => {
  it("fails with voiceNotFound when the host cannot select the voice", async () => {
    const { engine, fake } = setup({ knownVoices: ["Microsoft Zira Desktop"] });
    const run = engine.speak(["One.", "Two."], { voice: "Missing Voice", speed: 1 }, {});
    assert.equal(failedCode(await run.ended), "voiceNotFound");
    await settle();
    assert.deepEqual(fake.last().requestsOf("cancel"), [{ type: "cancel", run: 1 }]);
  });

  it("fails with blockedByPolicy when the host reports Constrained Language Mode and exits 3", async () => {
    const { engine, fake } = setup({ ready: false, speech: "manual" });
    const run = engine.speak(["One."], NORMAL, {});
    await settle();
    fake.last().emitEvent({ type: "error", code: "blockedByPolicy", message: "ConstrainedLanguage" });
    fake.last().exit(3);
    assert.equal(failedCode(await run.ended), "blockedByPolicy");
  });

  it("fails with blockedByPolicy on exit code 3 alone", async () => {
    const { engine, fake } = setup({ ready: false, speech: "manual" });
    const run = engine.speak(["One."], NORMAL, {});
    await settle();
    fake.last().exit(3);
    assert.equal(failedCode(await run.ended), "blockedByPolicy");
  });

  it("fails with blockedByPolicy when ready reports another language mode", async () => {
    const { engine } = setup({ languageMode: "ConstrainedLanguage", speech: "manual" });
    assert.equal(failedCode(await engine.speak(["One."], NORMAL, {}).ended), "blockedByPolicy");
  });

  it("fails the run on a processFailed error for that run, and only logs one for another run", async () => {
    const { engine, fake, logs } = setup({ speech: "manual" });
    const run = engine.speak(["One."], NORMAL, {});
    await settle();
    fake.last().emitEvent({ type: "error", code: "processFailed", message: "old", run: 99 });
    assert.equal(await peek(run.ended), "pending");
    assert.ok(logs.some((line) => line.includes("old")));
    fake.last().emitEvent({ type: "error", code: "processFailed", message: "audio gone", run: 1 });
    assert.equal(failedCode(await run.ended), "processFailed");
  });
});

describe("WindowsSapiEngine: reading host output", () => {
  it("handles lines split across chunks with CRLF endings", async () => {
    const { engine, fake } = setup({ speech: "manual" });
    const starts: number[] = [];
    const run = engine.speak(["One."], NORMAL, { onSentenceStart: (index) => starts.push(index) });
    await settle();
    const host = fake.last();
    host.emitRaw('{"type":"sentenceSt');
    await settle();
    host.emitRaw('art","run":1,"index":0}\r');
    await settle();
    host.emitRaw('\n{"type":"sentenceEnd","run":1,"index":0}\r\n');
    assert.deepEqual(await run.ended, { kind: "finished" });
    assert.deepEqual(starts, [0]);
  });

  it("decodes UTF-8 split inside a character", async () => {
    const { engine, fake, logs } = setup({ voices: undefined });
    const voices = engine.listVoices();
    await settle();
    const bytes = Buffer.from(
      '{"type":"voices","id":1,"voices":[{"name":"Hélène","culture":"fr-FR","gender":"Female"}]}\n',
    );
    const cut = bytes.indexOf(0xa9);
    fake.last().stdout.write(bytes.subarray(0, cut));
    await settle();
    fake.last().stdout.write(bytes.subarray(cut));
    const list = await voices;
    assert.equal(list[0]?.name, "Hélène");
    assert.deepEqual(logs, []);
  });

  it("ignores a byte order mark before the first line", async () => {
    const { engine, fake, logs } = setup({ ready: false, voices: undefined });
    const voices = engine.listVoices();
    await settle();
    fake.last().emitRaw('\uFEFF{"type":"voices","id":1,"voices":[]}\n');
    assert.deepEqual(await voices, []);
    assert.deepEqual(logs, []);
  });

  it("logs and skips bad lines without failing the run", async () => {
    const { engine, fake, logs } = setup({ speech: "manual" });
    const run = engine.speak(["One."], NORMAL, {});
    await settle();
    fake.last().emitRaw('not json\n{"type":"mystery"}\n{"type":"word","run":"1"}\n\n');
    await settle();
    assert.equal(await peek(run.ended), "pending");
    assert.equal(logs.filter((line) => line.startsWith("host output ignored")).length, 3);
  });
});
