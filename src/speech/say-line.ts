/**
 * Builds the single line a `say -i` process speaks from a list of sentences, and maps
 * offsets in that line back to (sentence, offset). Pure: no processes.
 *
 * `say -i` restarts offsets at each newline, so everything goes on one line joined by
 * single spaces. Replacements here keep every character's position, so offsets stay exact.
 */

/** Where a word is, in the caller's sentences. Offsets are UTF-16 code units. */
export interface SentencePosition {
  readonly sentence: number;
  readonly offset: number;
}

/** One sentence (or its tail, after a resume) placed on the spoken line. */
interface Segment {
  /** Index into the caller's sentences. */
  readonly sentence: number;
  /** Offset in the original sentence where this segment's text begins. */
  readonly base: number;
  /** Offset in the line where this segment's text begins. */
  readonly lineStart: number;
  readonly length: number;
}

/** A spoken line plus what is needed to map its offsets back. */
export interface SayLine {
  readonly text: string;
  readonly segments: readonly Segment[];
}

const ESC = "\x1b";

/** Line breaks and ESC would break `say -i` frames; each becomes one space. */
function sanitize(text: string): string {
  return text.replace(/[\r\n]/g, " ").replaceAll(ESC, " ");
}

/** Builds the line that speaks `sentences` starting at `from` (a word inside a sentence). */
export function buildSayLine(sentences: readonly string[], from: SentencePosition): SayLine {
  const parts: string[] = [];
  const segments: Segment[] = [];
  let lineStart = 0;
  for (let index = from.sentence; index < sentences.length; index++) {
    const base = index === from.sentence ? from.offset : 0;
    const part = sanitize(sentences[index] ?? "").slice(base);
    segments.push({ sentence: index, base, lineStart, length: part.length });
    parts.push(part);
    lineStart += part.length + 1;
  }
  return { text: parts.join(" "), segments };
}

/** A word on the line, mapped to its sentence. The length never runs past the sentence. */
export interface MappedWord {
  readonly sentence: number;
  readonly start: number;
  readonly length: number;
}

/** Maps a word at `start`/`length` in the line to its sentence, or undefined if off the line. */
export function mapLineWord(line: SayLine, start: number, length: number): MappedWord | undefined {
  let found: Segment | undefined;
  for (const segment of line.segments) {
    if (segment.lineStart > start) {
      break;
    }
    found = segment;
  }
  if (found === undefined) {
    return undefined;
  }
  const within = Math.min(start - found.lineStart, found.length);
  const clipped = Math.max(0, Math.min(length, found.length - within));
  return { sentence: found.sentence, start: found.base + within, length: clipped };
}
