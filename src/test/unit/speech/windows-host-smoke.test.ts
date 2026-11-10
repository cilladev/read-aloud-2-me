import * as assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { removeFolder } from "../../../speech/online/temp-audio";
import { WindowsMediaPlayer } from "../../../speech/online/windows-media-player";
import { WindowsSapiEngine } from "../../../speech/windows-sapi-engine";
import { fakeMp3 } from "./online/mp3-frames";

// Runs the real PowerShell speech host. Only on Windows (the CI matrix has a Windows runner);
// it lists voices and shuts down, so it makes no sound.
const SCRIPT = join(__dirname, "..", "..", "..", "..", "resources", "speech-host.ps1");

describe("Windows speech host (real PowerShell)", function () {
  this.timeout(60000);

  before(function () {
    if (process.platform !== "win32") {
      this.skip();
    }
  });

  it("starts, lists installed voices and stops", async () => {
    const engine = new WindowsSapiEngine(SCRIPT);
    try {
      const voices = await engine.listVoices();
      for (const voice of voices) {
        assert.equal(typeof voice.name, "string");
        assert.ok(voice.name.length > 0);
      }
    } finally {
      engine.dispose();
    }
  });

  it("plays and stops an audio file through the host without failing", async () => {
    const problems: string[] = [];
    const player = new WindowsMediaPlayer(SCRIPT, undefined, (message) => problems.push(message));
    const file = join(mkdtempSync(join(tmpdir(), "ra2m-")), "a.mp3");
    writeFileSync(file, fakeMp3(20));
    try {
      player.prepare(file);
      const playback = player.play(file, 480);
      const end = await playback.ended;
      // CI runners have no sound card, so the media player itself may fail; the script must not.
      if (end.kind === "failed") {
        assert.match(end.error.message, /^Audio playback failed/);
      }
      player.play(file, 5000).stop();
      // The host takes several seconds to start on CI; give it time to handle both requests.
      // A failure inside the host arrives as an error line, which the player logs here.
      await new Promise((resolve) => setTimeout(resolve, 15000));
      const scriptErrors = problems.filter((line) =>
        /Request failed|Event handling failed|Audio dispatcher failed|Opening audio failed|not JSON|malformed/.test(
          line,
        ),
      );
      assert.deepEqual(scriptErrors, []);
    } finally {
      player.dispose();
    }
  });

  it("closes every file on stopAll, so a run's folder can be deleted", async () => {
    const player = new WindowsMediaPlayer(SCRIPT);
    const dir = mkdtempSync(join(tmpdir(), "ra2m-"));
    const first = join(dir, "0.mp3");
    const second = join(dir, "1.mp3");
    writeFileSync(first, fakeMp3(200));
    writeFileSync(second, fakeMp3(200));
    try {
      player.play(first, 4800);
      player.prepare(second);
      // Let the host start and open both files, as during reading.
      await new Promise((resolve) => setTimeout(resolve, 12000));
      player.stopAll();
      await removeFolder(dir);
    } finally {
      player.dispose();
    }
  });
});
