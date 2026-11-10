import * as assert from "node:assert/strict";
import type { Sentence } from "../../../text/types";

// Shared checks every cleaner's output must pass, whatever the input.

/** Asserts the Sentence contract and that verbatim pieces equal their source slices. */
export function assertInvariants(source: string, sentences: readonly Sentence[]): void {
  let previousStart = -1;
  for (const sentence of sentences) {
    const { text } = sentence;
    assert.ok(text.length > 0, "empty sentence");
    assert.equal(text, text.trim(), `untrimmed: ${JSON.stringify(text)}`);
    assert.ok(!/[\r\n]/.test(text), `line break in ${JSON.stringify(text)}`);
    assert.ok(!text.includes("  "), `double space in ${JSON.stringify(text)}`);
    assert.ok(sentence.sourceStart >= previousStart, "sentences out of order");
    previousStart = sentence.sourceStart;
    assertPieces(source, sentence);
  }
}

function assertPieces(source: string, sentence: Sentence): void {
  let spokenEnd = 0;
  for (const piece of sentence.pieces) {
    assert.ok(piece.spokenStart >= spokenEnd, "pieces overlap or are unsorted");
    assert.ok(piece.spokenEnd > piece.spokenStart, "empty piece");
    assert.ok(
      piece.sourceStart >= sentence.sourceStart && piece.sourceEnd <= sentence.sourceEnd,
      "piece outside sentence",
    );
    spokenEnd = piece.spokenEnd;
    if (piece.kind === "verbatim") {
      assert.equal(
        source.slice(piece.sourceStart, piece.sourceEnd),
        sentence.text.slice(piece.spokenStart, piece.spokenEnd),
        "verbatim piece differs from its source",
      );
    }
  }
  assert.ok(spokenEnd <= sentence.text.length);
}

/** Returns just the spoken texts. */
export function texts(sentences: readonly Sentence[]): string[] {
  return sentences.map((sentence) => sentence.text);
}
