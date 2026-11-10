import * as assert from "node:assert/strict";
import { SpeechError } from "../../../../speech/engine";
import { WindowsMediaPlayer } from "../../../../speech/online/windows-media-player";
import { fakeSpawner, flush } from "../fake-process";

function setup(): {
  player: WindowsMediaPlayer;
  requests: () => unknown[];
  send: (event: object) => Promise<void>;
  logs: string[];
} {
  const spawner = fakeSpawner();
  const logs: string[] = [];
  const player = new WindowsMediaPlayer("C:\\ext\\resources\\speech-host.ps1", spawner.spawn, (m) => logs.push(m));
  return {
    player,
    logs,
    requests: () =>
      spawner
        .last()
        .stdinText.split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as unknown),
    send: async (event) => {
      spawner.last().out(`${JSON.stringify(event)}\n`);
      await flush();
    },
  };
}

describe("WindowsMediaPlayer", () => {
  it("loads ahead, then plays by the same id", async () => {
    const { player, requests } = setup();
    player.prepare("C:\\t\\1.mp3");
    player.prepare("C:\\t\\1.mp3");
    player.play("C:\\t\\1.mp3", 1000);
    await flush();
    assert.deepEqual(requests(), [
      { type: "load", id: 1, path: "C:\\t\\1.mp3" },
      { type: "play", id: 1, path: "C:\\t\\1.mp3" },
    ]);
    player.dispose();
  });

  it("is heard when the host says, back-dated by the position it reports", async () => {
    const { player, send } = setup();
    const playback = player.play("C:\\t\\a.mp3", 1000);
    const before = Date.now();
    await send({ type: "audioStarted", id: 1, positionMs: 40 });
    const heardAt = await playback.started;
    assert.ok(heardAt <= before && heardAt >= before - 200);
    await send({ type: "audioEnded", id: 1 });
    assert.deepEqual(await playback.ended, { kind: "finished" });
    player.dispose();
  });

  it("fails a playback on a host error for its id, and logs others", async () => {
    const { player, send, logs } = setup();
    const playback = player.play("C:\\t\\a.mp3", 1000);
    await send({ type: "error", code: "processFailed", message: "no codec", run: 1 });
    const end = await playback.ended;
    assert.equal(end.kind, "failed");
    assert.ok(end.error instanceof SpeechError);
    await send({ type: "error", code: "processFailed", message: "stray", run: 9 });
    assert.ok(logs.some((line) => line.includes("stray")));
    player.dispose();
  });

  it("stops by id and settles as stopped", async () => {
    const { player, requests } = setup();
    const playback = player.play("C:\\t\\a.mp3", 1000);
    playback.stop();
    await flush();
    assert.deepEqual(requests().at(-1), { type: "stopAudio", id: 1 });
    assert.deepEqual(await playback.ended, { kind: "stopped" });
    player.dispose();
  });

  it("settles everything as stopped on dispose", async () => {
    const { player } = setup();
    const playback = player.play("C:\\t\\a.mp3", 1000);
    player.dispose();
    assert.deepEqual(await playback.ended, { kind: "stopped" });
  });
});
