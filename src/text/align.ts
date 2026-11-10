/**
 * Lines up a Markdown node's parsed value with its source slice, which can differ by backslash
 * escapes, character references (`&amp;`), container prefixes (`> `) and indentation.
 * Pure: no vscode, no I/O.
 */

/** One stretch of a value and where it came from in the source. */
export interface Segment {
  /** `verbatim`: text equals the source slice. `synthetic`: text stands for the range. `space`: a gap. */
  readonly kind: "verbatim" | "synthetic" | "space";
  /** Start of this stretch in the value. */
  readonly valueStart: number;
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

const WHITESPACE = /\s/;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const REFERENCE = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|[A-Za-z][A-Za-z0-9]{1,31});/;

/**
 * Aligns `value` with `source.slice(start, end)` character by character.
 * @returns the segments covering all of `value`, or undefined when they cannot be lined up.
 * @example
 * alignValue("a*b", "a\\*b", 0, 4);
 * // [{ kind: "verbatim", text: "a", ... }, { kind: "verbatim", text: "*b", sourceStart: 2, ... }]
 */
export function alignValue(value: string, source: string, start: number, end: number): Segment[] | undefined {
  if (source.slice(start, end) === value) {
    return [{ kind: "verbatim", valueStart: 0, text: value, sourceStart: start, sourceEnd: end }];
  }
  const segments: Segment[] = [];
  let i = 0;
  let j = start;
  let runValue = 0;
  let runSource = start;
  const flush = (): void => {
    if (i > runValue) {
      segments.push({
        kind: "verbatim",
        valueStart: runValue,
        text: value.slice(runValue, i),
        sourceStart: runSource,
        sourceEnd: j,
      });
    }
  };
  const restart = (): void => {
    runValue = i;
    runSource = j;
  };
  while (i < value.length) {
    if (j >= end) {
      return undefined;
    }
    const valueChar = value.charAt(i);
    const sourceChar = source.charAt(j);
    // A character reference wins over a literal match: "&amp;" parses to "&", which equals "&".
    const reference = sourceChar === "&" ? REFERENCE.exec(source.slice(j, j + 40)) : null;
    if (valueChar === sourceChar && reference === null) {
      i++;
      j++;
      continue;
    }
    flush();
    if (WHITESPACE.test(valueChar) && WHITESPACE.test(sourceChar)) {
      segments.push({ kind: "space", valueStart: i, text: " ", sourceStart: j, sourceEnd: j + 1 });
      i++;
      j++;
    } else if (sourceChar === "\\" && ASCII_PUNCTUATION.test(valueChar) && source.charAt(j + 1) === valueChar) {
      j++;
    } else if (reference !== null) {
      const length = decodedLength(reference);
      const sourceLength = reference[0].length;
      segments.push({
        kind: "synthetic",
        valueStart: i,
        text: value.slice(i, i + length),
        sourceStart: j,
        sourceEnd: j + sourceLength,
      });
      i += length;
      j += sourceLength;
    } else if (WHITESPACE.test(sourceChar) || sourceChar === ">") {
      // Indentation, a blockquote prefix or trailing spaces the parser left out of the value.
      j++;
    } else {
      return undefined;
    }
    restart();
  }
  flush();
  return segments;
}

// How many UTF-16 code units a character reference decodes to. Named references are assumed
// to decode to one; if that is wrong the alignment fails later and the caller falls back.
function decodedLength(reference: RegExpExecArray): number {
  const decimal = reference[1];
  const hex = reference[2];
  const codePoint = decimal !== undefined ? Number(decimal) : hex !== undefined ? parseInt(hex, 16) : 0;
  return codePoint > 0xffff && codePoint <= 0x10ffff ? 2 : 1;
}
