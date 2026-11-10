import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hostArgs, LineBuffer, POWERSHELL } from "../../../speech/windows-host";

// Pieces of the host connection that need no process: arguments and line splitting.

describe("windows host: hostArgs", () => {
  it("runs the bundled script with -File and never -EncodedCommand", () => {
    const args = hostArgs("C:\\ext\\resources\\speech-host.ps1");
    assert.equal(POWERSHELL, "powershell.exe");
    assert.deepEqual(args, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\ext\\resources\\speech-host.ps1",
    ]);
    assert.ok(!args.some((arg) => /encoded/i.test(arg)));
  });
});

describe("windows host: LineBuffer", () => {
  it("joins lines split across chunks", () => {
    const buffer = new LineBuffer();
    assert.deepEqual(buffer.push('{"a":'), []);
    assert.deepEqual(buffer.push('1}\n{"b"'), ['{"a":1}']);
    assert.deepEqual(buffer.push(":2}\n"), ['{"b":2}']);
  });

  it("strips CRLF, even when the CR and LF arrive in different chunks", () => {
    const buffer = new LineBuffer();
    assert.deepEqual(buffer.push("one\r\ntwo\r"), ["one"]);
    assert.deepEqual(buffer.push("\nthree\n"), ["two", "three"]);
  });

  it("returns several lines from one chunk", () => {
    assert.deepEqual(new LineBuffer().push("a\nb\nc\n"), ["a", "b", "c"]);
  });
});

describe("windows host: speech-host.ps1", () => {
  const script = readFileSync(join(__dirname, "..", "..", "..", "..", "resources", "speech-host.ps1"), "utf8");

  it("is ASCII with CRLF line endings", () => {
    assert.ok(Buffer.from(script, "utf8").length === script.length, "non-ASCII character");
    assert.ok(!/[^\r]\n/.test(script), "LF without CR");
  });

  it("checks the language mode before anything else and exits 3", () => {
    const check = script.indexOf("LanguageMode -ne 'FullLanguage'");
    assert.ok(check > 0 && check < script.indexOf("Add-Type"));
    assert.ok(script.includes("exit 3"));
  });

  it("subscribes to the three SAPI events without -Action", () => {
    for (const name of ["SpeakStarted", "SpeakProgress", "SpeakCompleted"]) {
      assert.ok(script.includes(`-EventName ${name}`), name);
    }
    const code = script.split("\r\n").filter((line) => !line.trimStart().startsWith("#"));
    assert.ok(!code.some((line) => line.includes("Register-ObjectEvent") && line.includes("-Action")));
  });
});
