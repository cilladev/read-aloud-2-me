/**
 * Keeps sentence offsets in step with the document while it is being edited during reading.
 * Pure: takes edits as plain numbers. A sentence touched by an edit is dropped (undefined),
 * so the editor stops marking it rather than marking the wrong text.
 */
import type { Piece, Sentence } from "../text/types";

/** One edit, in offsets of the document before the edit. */
export interface TextEdit {
  /** Start of the replaced range. */
  readonly start: number;
  /** End of the replaced range, exclusive. */
  readonly end: number;
  /** Length of the inserted text. */
  readonly insertedLength: number;
}

/**
 * Applies edits to sentence offsets.
 *
 * @param sentences - current sentences; undefined entries stay undefined
 * @param edits - edits from one change event, all relative to the document before it
 * @returns a new array, same length, with shifted or dropped sentences
 * @example
 * shiftSentences([s], [{ start: 0, end: 0, insertedLength: 3 }]) // s moved right by 3
 */
export function shiftSentences(
  sentences: readonly (Sentence | undefined)[],
  edits: readonly TextEdit[],
): (Sentence | undefined)[] {
  // Apply the last edit first, so earlier edits' offsets stay valid.
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  return sentences.map((sentence) => ordered.reduce(applyEdit, sentence));
}

function applyEdit(sentence: Sentence | undefined, edit: TextEdit): Sentence | undefined {
  if (!sentence || edit.start >= sentence.sourceEnd) {
    return sentence;
  }
  if (edit.end <= sentence.sourceStart) {
    return moveSentence(sentence, edit.insertedLength - (edit.end - edit.start));
  }
  return undefined;
}

function moveSentence(sentence: Sentence, delta: number): Sentence {
  if (delta === 0) {
    return sentence;
  }
  return {
    ...sentence,
    sourceStart: sentence.sourceStart + delta,
    sourceEnd: sentence.sourceEnd + delta,
    pieces: sentence.pieces.map((piece): Piece => ({
      ...piece,
      sourceStart: piece.sourceStart + delta,
      sourceEnd: piece.sourceEnd + delta,
    })),
  };
}
