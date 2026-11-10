import * as assert from "node:assert/strict";
import { join } from "node:path";
import { WindowsSapiEngine } from "../../../speech/windows-sapi-engine";

// Runs the real PowerShell speech host. Only on Windows (the CI matrix has a Windows runner);
// it lists voices and shuts down, so it makes no sound.
const SCRIPT = join(__dirname, "..", "..", "..", "..", "resources", "speech-host.ps1");

describe("Windows speech host (real PowerShell)", function () {
  this.timeout(30000);

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
});
