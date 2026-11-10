/**
 * Maps offsets in a sentence's spoken text back to source offsets, so the editor can highlight
 * the word the voice is saying. Pure: no vscode, no I/O.
 */

import type { Piece, Sentence, SourceRange } from "./types";

/**
 * Maps one offset in `sentence.text` to a source offset.
 * Verbatim pieces map one to one, synthetic pieces map to their start, and offsets in a gap
 * (an inserted space) or outside the text map to the nearest piece.
 * @example
 * mapSpokenOffset(sentence, 0); // sentence.pieces[0].sourceStart
 */
export function mapSpokenOffset(sentence: Sentence, offset: number): number {
  const { pieces } = sentence;
  const index = findPiece(pieces, offset);
  const piece = pieces[index];
  if (piece !== undefined && offset >= piece.spokenStart && offset < piece.spokenEnd) {
    return piece.kind === "verbatim" ? piece.sourceStart + (offset - piece.spokenStart) : piece.sourceStart;
  }
  return nearestBoundary(sentence, index, offset);
}

/**
 * Maps a spoken range (as reported by a speech engine's word event) to a source range.
 * A synthetic piece maps to its whole source range. The result stays inside the sentence.
 * @example
 * mapSpokenRange(sentence, 4, 5); // the source range of the fifth to ninth spoken characters
 */
export function mapSpokenRange(sentence: Sentence, start: number, length: number): SourceRange {
  const from = mapSpokenOffset(sentence, start);
  const to = length > 0 ? mapEnd(sentence, start + length - 1) : from;
  const clampedStart = clamp(from, sentence.sourceStart, sentence.sourceEnd);
  return { start: clampedStart, end: clamp(Math.max(to, from), clampedStart, sentence.sourceEnd) };
}

// Exclusive source end for the spoken character at `last`.
function mapEnd(sentence: Sentence, last: number): number {
  const { pieces } = sentence;
  const index = findPiece(pieces, last);
  const piece = pieces[index];
  if (piece !== undefined && last >= piece.spokenStart && last < piece.spokenEnd) {
    return piece.kind === "verbatim" ? piece.sourceStart + (last - piece.spokenStart) + 1 : piece.sourceEnd;
  }
  // In a gap the range ends where the piece before it ends.
  return pieces[index]?.sourceEnd ?? pieces[0]?.sourceStart ?? sentence.sourceStart;
}

// Index of the last piece whose spokenStart <= offset, or -1 when there is none.
function findPiece(pieces: readonly Piece[], offset: number): number {
  let low = 0;
  let high = pieces.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const piece = pieces[middle];
    if (piece !== undefined && piece.spokenStart <= offset) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

// `offset` lies after pieces[index] (or before every piece when index is -1).
function nearestBoundary(sentence: Sentence, index: number, offset: number): number {
  const before = sentence.pieces[index];
  const after = sentence.pieces[index + 1];
  if (before === undefined) {
    return after?.sourceStart ?? sentence.sourceStart;
  }
  if (after === undefined || offset - (before.spokenEnd - 1) < after.spokenStart - offset) {
    return before.sourceEnd;
  }
  return after.sourceStart;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
