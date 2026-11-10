/**
 * Splits one block of spoken text into sentences with Intl.Segmenter, then repairs the breaks
 * it makes after abbreviations. Never sees more than one block, so it never joins blocks.
 * Pure: no vscode, no I/O.
 */

import type { SpokenBlock } from "./builder";
import type { Piece, Sentence } from "./types";

// Titles and labels that are always followed by more of the same sentence.
const ALWAYS_MERGE = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "st",
  "mt",
  "fig",
  "figs",
  "eq",
  "vs",
  "vol",
  "ch",
  "sec",
]);
// Abbreviations that can also end a sentence; merge only when the next part starts lowercase.
const MERGE_IF_LOWERCASE = new Set(["sr", "jr", "approx", "inc", "ltd", "co", "corp", "etc", "no"]);
const LAST_WORD = /(?:^|[^\p{L}])(\p{L}+)\.\s*$/u;

let segmenter: Intl.Segmenter | undefined;

interface Span {
  start: number;
  end: number;
}

/**
 * Splits a block into sentences, keeping each sentence's pieces mapped to the source.
 * @param block - single-spaced, trimmed text with its pieces, as built by `BlockBuilder`.
 * @returns the sentences in order; empty sentences are dropped.
 * @example
 * splitSentences(block("Dr. Smith is in. He is busy.")).map((s) => s.text);
 * // ["Dr. Smith is in.", "He is busy."]
 */
export function splitSentences(block: SpokenBlock): Sentence[] {
  return mergeAbbreviations(block.text, segment(block.text))
    .map((span) => toSentence(block, span))
    .filter((sentence): sentence is Sentence => sentence !== undefined);
}

/** Turns a whole block into exactly one sentence, or none when it is empty. */
export function wholeSentence(block: SpokenBlock): Sentence[] {
  const sentence = toSentence(block, { start: 0, end: block.text.length });
  return sentence === undefined ? [] : [sentence];
}

function segment(text: string): Span[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "sentence" });
  return Array.from(segmenter.segment(text), (part) => ({
    start: part.index,
    end: part.index + part.segment.length,
  }));
}

function mergeAbbreviations(text: string, spans: Span[]): Span[] {
  const merged: Span[] = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous !== undefined && shouldMerge(text.slice(previous.start, previous.end), text.slice(span.start))) {
      previous.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function shouldMerge(previous: string, next: string): boolean {
  const word = LAST_WORD.exec(previous)?.[1]?.toLowerCase();
  if (word === undefined) {
    return false;
  }
  if (ALWAYS_MERGE.has(word)) {
    return true;
  }
  const startsLower = /^\s*[\p{Ll}\d]/u.test(next);
  return MERGE_IF_LOWERCASE.has(word) && startsLower;
}

function toSentence(block: SpokenBlock, span: Span): Sentence | undefined {
  const raw = block.text.slice(span.start, span.end);
  const start = span.start + (raw.length - raw.trimStart().length);
  const end = span.end - (raw.length - raw.trimEnd().length);
  const pieces = block.pieces.flatMap((piece) => clip(piece, start, end));
  const first = pieces[0];
  if (end <= start || first === undefined) {
    return undefined;
  }
  return {
    text: block.text.slice(start, end),
    sourceStart: Math.min(...pieces.map((piece) => piece.sourceStart)),
    sourceEnd: Math.max(...pieces.map((piece) => piece.sourceEnd)),
    pieces,
  };
}

// Cuts a piece to [start, end) of the block and rebases it on `start`. A synthetic piece keeps
// its whole source range because its characters have no one-to-one source.
function clip(piece: Piece, start: number, end: number): Piece[] {
  const from = Math.max(piece.spokenStart, start);
  const to = Math.min(piece.spokenEnd, end);
  if (to <= from) {
    return [];
  }
  const verbatim = piece.kind === "verbatim";
  return [
    {
      spokenStart: from - start,
      spokenEnd: to - start,
      sourceStart: verbatim ? piece.sourceStart + (from - piece.spokenStart) : piece.sourceStart,
      sourceEnd: verbatim ? piece.sourceStart + (to - piece.spokenStart) : piece.sourceEnd,
      kind: piece.kind,
    },
  ];
}
