import * as assert from "node:assert/strict";
import { encodeRequest, parseEvent } from "../../../speech/windows-protocol";

// The JSON-lines protocol with speech-host.ps1: encoding requests and validating events.

describe("windows protocol: encodeRequest", () => {
  it("writes one JSON line ending in a newline", () => {
    const line = encodeRequest({ type: "speak", run: 1, index: 0, text: "Hi.", voice: null, rate: 0 });
    assert.equal(line, '{"type":"speak","run":1,"index":0,"text":"Hi.","voice":null,"rate":0}\n');
  });

  it("keeps text with line breaks and quotes on one line", () => {
    const line = encodeRequest({ type: "speak", run: 1, index: 0, text: 'a\r\nb "c"', voice: "Zira", rate: 3 });
    assert.equal(line.split("\n").length, 2);
    assert.deepEqual(JSON.parse(line), { type: "speak", run: 1, index: 0, text: 'a\r\nb "c"', voice: "Zira", rate: 3 });
  });

  it("encodes control messages", () => {
    assert.equal(encodeRequest({ type: "cancel", run: 4 }), '{"type":"cancel","run":4}\n');
    assert.equal(encodeRequest({ type: "quit" }), '{"type":"quit"}\n');
  });
});

describe("windows protocol: parseEvent", () => {
  it("parses ready", () => {
    assert.deepEqual(parseEvent('{"type":"ready","languageMode":"FullLanguage"}'), {
      ok: true,
      event: { type: "ready", languageMode: "FullLanguage" },
    });
  });

  it("parses voices, including PowerShell's single-object and null forms", () => {
    const zira = { name: "Microsoft Zira Desktop", culture: "en-US", gender: "Female" };
    assert.deepEqual(parseEvent(JSON.stringify({ type: "voices", id: 2, voices: [zira] })), {
      ok: true,
      event: { type: "voices", id: 2, voices: [zira] },
    });
    assert.deepEqual(parseEvent(JSON.stringify({ type: "voices", id: 2, voices: zira })), {
      ok: true,
      event: { type: "voices", id: 2, voices: [zira] },
    });
    assert.deepEqual(parseEvent('{"type":"voices","id":3,"voices":null}'), {
      ok: true,
      event: { type: "voices", id: 3, voices: [] },
    });
  });

  it("parses sentence and word events", () => {
    assert.deepEqual(parseEvent('{"type":"sentenceStart","run":1,"index":0}'), {
      ok: true,
      event: { type: "sentenceStart", run: 1, index: 0 },
    });
    assert.deepEqual(parseEvent('{"type":"word","run":1,"index":2,"start":4,"length":5}'), {
      ok: true,
      event: { type: "word", run: 1, index: 2, start: 4, length: 5 },
    });
    assert.deepEqual(parseEvent('{"type":"sentenceEnd","run":1,"index":2}'), {
      ok: true,
      event: { type: "sentenceEnd", run: 1, index: 2 },
    });
  });

  it("parses errors with and without a run", () => {
    assert.deepEqual(parseEvent('{"type":"error","code":"voiceNotFound","message":"no","run":3}'), {
      ok: true,
      event: { type: "error", code: "voiceNotFound", message: "no", run: 3 },
    });
    assert.deepEqual(parseEvent('{"type":"error","code":"blockedByPolicy","message":"CLM"}'), {
      ok: true,
      event: { type: "error", code: "blockedByPolicy", message: "CLM", run: undefined },
    });
  });

  it("accepts PowerShell's escaped characters", () => {
    const result = parseEvent('{"type":"error","code":"processFailed","message":"it\\u0027s \\u003cbad\\u003e"}');
    assert.ok(result.ok);
    assert.equal(result.event.type === "error" ? result.event.message : "", "it's <bad>");
  });

  const bad: readonly [string, string][] = [
    ["not JSON", "{type:"],
    ["empty", ""],
    ["an array", "[1,2]"],
    ["a string", '"ready"'],
    ["null", "null"],
    ["no type", '{"run":1}'],
    ["an unknown type", '{"type":"hello"}'],
    ["a ready without languageMode", '{"type":"ready"}'],
    ["a string run", '{"type":"sentenceStart","run":"1","index":0}'],
    ["a negative index", '{"type":"sentenceEnd","run":1,"index":-1}'],
    ["a fractional start", '{"type":"word","run":1,"index":0,"start":1.5,"length":2}'],
    ["a word missing length", '{"type":"word","run":1,"index":0,"start":1}'],
    ["an unknown error code", '{"type":"error","code":"oops","message":"x"}'],
    ["an error without message", '{"type":"error","code":"processFailed"}'],
    ["an error with a string run", '{"type":"error","code":"processFailed","message":"x","run":"2"}'],
    ["voices without id", '{"type":"voices","voices":[]}'],
    ["a voice without name", '{"type":"voices","id":1,"voices":[{"culture":"en-US"}]}'],
  ];
  for (const [label, line] of bad) {
    it(`rejects ${label} without throwing`, () => {
      const result = parseEvent(line);
      assert.ok(!result.ok, "expected a parse error");
      assert.ok(result.error.length > 0);
    });
  }
});
