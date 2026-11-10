/**
 * Turns plain text and source code into sentences. Plain text: a blank line ends a block.
 * Code: leading comment markers are stripped and lines made only of punctuation are silent.
 * Words are read as written (no camelCase splitting). Pure: no vscode, no I/O.
 */

import { BlockBuilder } from "./builder";
import { splitSentences, wholeSentence } from "./sentences";
import type { Sentence } from "./types";

interface Line {
  /** Line text without its line break. */
  readonly text: string;
  /** Offset of the line's first character in the source. */
  readonly start: number;
}

// Longest first, so "///" wins over "//" and "-->" over "--".
const LEADING_MARKERS = ["<!--", "-->", '"""', "///", "//", "/*", "*/", "--", ";;", "#", "*"];
const TRAILING_MARKERS = ["*/", "-->", '"""'];
const ONLY_PUNCTUATION = /^[\p{P}\p{S}\s]*$/u;

/**
 * Splits plain text into sentences; blank lines are block breaks and sentences never cross them.
 * @example
 * plainToSentences("One. Two.\n\nThree").map((s) => s.text); // ["One.", "Two.", "Three"]
 */
export function plainToSentences(source: string): Sentence[] {
  const out: Sentence[] = [];
  let builder = new BlockBuilder();
  for (const line of splitLines(source)) {
    if (line.text.trim().length === 0) {
      out.push(...splitSentences(builder.build()));
      builder = new BlockBuilder();
      continue;
    }
    builder.appendVerbatim(line.text, line.start);
    builder.space();
  }
  out.push(...splitSentences(builder.build()));
  return out;
}

/**
 * Splits source code into sentences. Consecutive comment lines are read as prose, with their
 * markers dropped. Each line of code is its own sentence, so statements never run together.
 * Lines that are only braces or punctuation are skipped, and blank lines are block breaks.
 * @example
 * codeToSentences("// Adds two numbers.\nfunction add(a, b) {\n}").map((s) => s.text);
 * // ["Adds two numbers.", "function add(a, b) {"]
 */
export function codeToSentences(source: string): Sentence[] {
  const out: Sentence[] = [];
  let builder = new BlockBuilder();
  const flush = (): void => {
    out.push(...splitSentences(builder.build()));
    builder = new BlockBuilder();
  };
  for (const line of splitLines(source)) {
    const content = stripCommentMarkers(line.text);
    if (content.text.length === 0) {
      flush();
      continue;
    }
    if (ONLY_PUNCTUATION.test(content.text)) {
      continue;
    }
    if (!content.comment) {
      flush();
    }
    builder.appendVerbatim(content.text, line.start + content.start);
    builder.space();
    if (!content.comment) {
      flush();
    }
  }
  flush();
  return out;
}

/**
 * Reads a Markdown code block: each line with words in it is one sentence, read as written.
 * @param value - the code block's content as parsed.
 * @param source - the whole document, to find each line's exact offset.
 * @param start - where the code block starts in `source`.
 * @param end - where the code block ends in `source`.
 */
export function codeLineSentences(value: string, source: string, start: number, end: number): Sentence[] {
  const out: Sentence[] = [];
  let cursor = start;
  for (const line of value.split(/\r?\n/)) {
    const text = line.trim();
    if (ONLY_PUNCTUATION.test(text)) {
      continue;
    }
    const builder = new BlockBuilder();
    const at = source.indexOf(text, cursor);
    if (at >= 0 && at + text.length <= end) {
      builder.appendVerbatim(text, at);
      cursor = at + text.length;
    } else {
      builder.appendSynthetic(text, start, end);
    }
    out.push(...wholeSentence(builder.build()));
  }
  return out;
}

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  const breaks = /\r\n|\r|\n/g;
  let start = 0;
  for (const match of source.matchAll(breaks)) {
    lines.push({ text: source.slice(start, match.index), start });
    start = match.index + match[0].length;
  }
  lines.push({ text: source.slice(start), start });
  return lines;
}

/** A line's text after comment markers, and whether any marker was found. */
interface LineContent extends Line {
  readonly comment: boolean;
}

// Returns the part of a line left after comment markers, with its offset in the line.
function stripCommentMarkers(line: string): LineContent {
  let comment = false;
  let start = 0;
  let end = line.length;
  for (;;) {
    while (start < end && /\s/.test(line.charAt(start))) {
      start++;
    }
    const marker = LEADING_MARKERS.find((m) => line.startsWith(m, start));
    if (marker === undefined) {
      break;
    }
    start += marker.length;
    comment = true;
  }
  for (;;) {
    while (end > start && /\s/.test(line.charAt(end - 1))) {
      end--;
    }
    const marker = TRAILING_MARKERS.find((m) => line.slice(start, end).endsWith(m));
    if (marker === undefined) {
      break;
    }
    end -= marker.length;
  }
  return { text: line.slice(start, end), start, comment };
}
