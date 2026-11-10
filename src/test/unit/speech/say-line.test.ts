import * as assert from "node:assert/strict";
import { buildSayLine, mapLineWord } from "../../../speech/say-line";

describe("say-line", () => {
  it("joins sentences with single spaces on one line", () => {
    const line = buildSayLine(["A b.", "C\nd."], { sentence: 0, offset: 0 });
    assert.equal(line.text, "A b. C d.");
  });

  it("starts at a word inside a sentence and maps back to original offsets", () => {
    const line = buildSayLine(["Hi there.", "Go now."], { sentence: 0, offset: 3 });
    assert.equal(line.text, "there. Go now.");
    assert.deepEqual(mapLineWord(line, 0, 6), { sentence: 0, start: 3, length: 6 });
    assert.deepEqual(mapLineWord(line, 10, 4), { sentence: 1, start: 3, length: 4 });
  });

  it("clips a word that runs past its sentence", () => {
    const line = buildSayLine(["Ab.", "Cd."], { sentence: 0, offset: 0 });
    assert.deepEqual(mapLineWord(line, 0, 7), { sentence: 0, start: 0, length: 3 });
    assert.deepEqual(mapLineWord(line, 3, 1), { sentence: 0, start: 3, length: 0 });
  });

  it("returns undefined before the line and no segments past the end", () => {
    const line = buildSayLine(["Ab."], { sentence: 0, offset: 0 });
    assert.equal(mapLineWord(line, -1, 1), undefined);
    assert.deepEqual(buildSayLine(["Ab."], { sentence: 1, offset: 0 }).segments, []);
  });
});
