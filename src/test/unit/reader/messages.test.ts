import * as assert from "node:assert/strict";
import { MAX_FONT_SIZE, MIN_FONT_SIZE, clampFontSize, parseWebviewMessage } from "../../../reader/messages";

describe("reader/messages", () => {
  describe("parseWebviewMessage", () => {
    it("accepts ready", () => {
      assert.deepEqual(parseWebviewMessage({ type: "ready" }), { type: "ready" });
    });

    it("accepts jumpTo with a non-negative integer", () => {
      assert.deepEqual(parseWebviewMessage({ type: "jumpTo", index: 0 }), { type: "jumpTo", index: 0 });
      assert.deepEqual(parseWebviewMessage({ type: "jumpTo", index: 7 }), { type: "jumpTo", index: 7 });
    });

    it("accepts fontSize at both ends of the range", () => {
      assert.deepEqual(parseWebviewMessage({ type: "fontSize", value: MIN_FONT_SIZE }), {
        type: "fontSize",
        value: MIN_FONT_SIZE,
      });
      assert.deepEqual(parseWebviewMessage({ type: "fontSize", value: MAX_FONT_SIZE }), {
        type: "fontSize",
        value: MAX_FONT_SIZE,
      });
    });

    it("drops extra fields", () => {
      assert.deepEqual(parseWebviewMessage({ type: "jumpTo", index: 2, evil: "<script>" }), {
        type: "jumpTo",
        index: 2,
      });
      assert.deepEqual(parseWebviewMessage({ type: "ready", extra: 1 }), { type: "ready" });
    });

    it("rejects values that are not objects", () => {
      for (const value of [undefined, null, 1, "ready", [], [{ type: "ready" }]]) {
        assert.equal(parseWebviewMessage(value), undefined);
      }
    });

    it("rejects unknown or missing types", () => {
      assert.equal(parseWebviewMessage({}), undefined);
      assert.equal(parseWebviewMessage({ type: "render" }), undefined);
      assert.equal(parseWebviewMessage({ type: "READY" }), undefined);
      assert.equal(parseWebviewMessage({ type: 1 }), undefined);
    });

    it("rejects jumpTo indexes that are negative, fractional or not numbers", () => {
      for (const index of [-1, 1.5, Number.NaN, Infinity, "2", null, undefined, 2 ** 60]) {
        assert.equal(parseWebviewMessage({ type: "jumpTo", index }), undefined, String(index));
      }
    });

    it("rejects font sizes out of range or not integers", () => {
      for (const value of [MIN_FONT_SIZE - 1, MAX_FONT_SIZE + 1, 16.5, Number.NaN, "16", null]) {
        assert.equal(parseWebviewMessage({ type: "fontSize", value }), undefined, String(value));
      }
    });
  });

  describe("clampFontSize", () => {
    it("keeps sizes inside the range", () => {
      assert.equal(clampFontSize(4), MIN_FONT_SIZE);
      assert.equal(clampFontSize(99), MAX_FONT_SIZE);
      assert.equal(clampFontSize(17.4), 17);
    });

    it("gives the default for non-finite values", () => {
      assert.equal(clampFontSize(Number.NaN), 16);
    });
  });
});
