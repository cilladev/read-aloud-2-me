import * as assert from "node:assert/strict";
import { clampSpeed, sapiRate, sayWordsPerMinute } from "../../../speech/rate";

describe("rate", () => {
  it("maps speed to say words per minute around 175", () => {
    assert.equal(sayWordsPerMinute(1), 175);
    assert.equal(sayWordsPerMinute(0.5), 88);
    assert.equal(sayWordsPerMinute(1.5), 263);
    assert.equal(sayWordsPerMinute(2), 350);
  });

  it("clamps speed before mapping", () => {
    assert.equal(sayWordsPerMinute(0.1), 88);
    assert.equal(sayWordsPerMinute(9), 350);
    assert.equal(clampSpeed(Number.NaN), 1);
  });

  it("maps speed to SAPI rate on a log scale", () => {
    assert.equal(sapiRate(1), 0);
    assert.equal(sapiRate(2), 6);
    assert.equal(sapiRate(0.5), -6);
    assert.equal(sapiRate(1.25), 2);
    assert.equal(Object.is(sapiRate(0.99), 0), true);
  });

  it("keeps SAPI rate in -10..10", () => {
    assert.equal(sapiRate(100), 6);
    assert.equal(sapiRate(0), -6);
  });
});
