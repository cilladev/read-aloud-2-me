import * as assert from "node:assert/strict";
import { listMacVoices, parseSayVoiceList } from "../../../speech/mac-voices";
import { SpeechError } from "../../../speech/engine";
import { fakeSpawner, flush } from "./fake-process";

const SAMPLE = [
  "Albert              en_US    # Hello! My name is Albert.",
  "Eddy (English (UK))  en_GB    # Hello! My name is Eddy.",
  "Ava (Premium)       en_US    # Hello! My name is Ava.",
  "Zoe (Enhanced)      en_US    # Hello! My name is Zoe.",
  "Grandpa (Português (Brasil)) pt_BR    # Olá! Meu nome é Vovô.",
  "Mei-Jia             zh_TW    #",
  "",
  "not a voice line",
].join("\n");

describe("parseSayVoiceList", () => {
  it("parses names with spaces and parentheses", () => {
    const voices = parseSayVoiceList(SAMPLE);
    assert.deepEqual(
      voices.map((voice) => voice.name),
      ["Albert", "Eddy (English (UK))", "Ava (Premium)", "Zoe (Enhanced)", "Grandpa (Português (Brasil))", "Mei-Jia"],
    );
  });

  it("uses the name as id and converts the locale to BCP 47", () => {
    const eddy = parseSayVoiceList(SAMPLE)[1];
    assert.deepEqual(eddy, {
      id: "Eddy (English (UK))",
      name: "Eddy (English (UK))",
      language: "en-GB",
      quality: "default",
    });
  });

  it("reads quality from the name", () => {
    const quality = parseSayVoiceList(SAMPLE).map((voice) => voice.quality);
    assert.deepEqual(quality, ["default", "default", "premium", "enhanced", "default", "default"]);
  });

  it("handles CRLF and empty output", () => {
    assert.equal(parseSayVoiceList("Albert  en_US  # Hi\r\nAlice  it_IT  # Ciao\r\n").length, 2);
    assert.deepEqual(parseSayVoiceList(""), []);
  });
});

describe("listMacVoices", () => {
  it("runs say -v ? and parses stdout", async () => {
    const spawner = fakeSpawner();
    const listed = listMacVoices(spawner.spawn);
    const child = spawner.last();
    assert.equal(child.command, "say");
    assert.deepEqual(child.args, ["-v", "?"]);
    child.out(SAMPLE);
    await child.exit(0);
    assert.equal((await listed).length, 6);
  });

  it("rejects with processFailed on a non-zero exit", async () => {
    const spawner = fakeSpawner();
    const listed = listMacVoices(spawner.spawn);
    spawner.last().err("boom");
    await spawner.last().exit(1);
    await assert.rejects(listed, (error: unknown) => error instanceof SpeechError && error.code === "processFailed");
  });

  it("rejects with toolMissing when say is not there", async () => {
    const spawner = fakeSpawner();
    const listed = listMacVoices(spawner.spawn);
    await flush();
    spawner.last().emit("error", Object.assign(new Error("spawn say ENOENT"), { code: "ENOENT" }));
    await assert.rejects(listed, (error: unknown) => error instanceof SpeechError && error.code === "toolMissing");
  });
});
