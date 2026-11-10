/**
 * Parses the stdout of `say -i` into word events. Pure and incremental: feed decoded text
 * chunks in any split, get back the words whose frames completed.
 * It must not spawn processes or throw: unknown bytes are skipped.
 *
 * Each frame is `\r ESC[M` followed by the whole current line, with the word being spoken
 * wrapped as `ESC[7m word ESC(B ESC[m`. `say` echoes the input text, so the length of the
 * decoded prefix before `ESC[7m` is the word's offset in UTF-16 code units.
 */

/** A word `say` is speaking, as UTF-16 offsets into the spoken line. */
export interface SayWord {
  readonly start: number;
  readonly length: number;
}

const FRAME_START = "\r\x1b[M";
const WORD_START = "\x1b[7m";
const WORD_END = "\x1b(B";

/** Incremental parser for `say -i` output. One instance per process. */
export class SayFrameParser {
  private buffer = "";
  private inFrame = false;
  private last: SayWord | undefined;

  /** Adds a decoded stdout chunk and returns the words completed by it, in order. */
  push(chunk: string): SayWord[] {
    this.buffer += chunk;
    const words: SayWord[] = [];
    let word = this.next();
    while (word !== "wait") {
      if (word !== undefined && !this.isRepeat(word)) {
        words.push(word);
        this.last = word;
      }
      word = this.next();
    }
    return words;
  }

  /** Steps the state machine once: a word, undefined for "progress but no word", or "wait". */
  private next(): SayWord | undefined | "wait" {
    return this.inFrame ? this.readFrame() : this.findFrame();
  }

  private findFrame(): undefined | "wait" {
    const at = this.buffer.indexOf(FRAME_START);
    if (at === -1) {
      // Keep a tail that may be the start of a split marker; drop the rest.
      this.buffer = this.buffer.slice(-(FRAME_START.length - 1));
      return "wait";
    }
    this.buffer = this.buffer.slice(at + FRAME_START.length);
    this.inFrame = true;
    return undefined;
  }

  private readFrame(): SayWord | undefined | "wait" {
    const nextFrame = this.buffer.indexOf(FRAME_START);
    const limit = nextFrame === -1 ? this.buffer.length : nextFrame;
    const wordStart = this.buffer.indexOf(WORD_START);
    const wordEnd = wordStart === -1 ? -1 : this.buffer.indexOf(WORD_END, wordStart);
    if (wordStart !== -1 && wordEnd !== -1 && wordEnd < limit) {
      const start = wordStart;
      const length = wordEnd - wordStart - WORD_START.length;
      this.buffer = this.buffer.slice(wordEnd + WORD_END.length);
      this.inFrame = false;
      return { start, length };
    }
    if (nextFrame === -1) {
      return "wait";
    }
    // A frame with no highlighted word, such as the last one: skip it.
    this.buffer = this.buffer.slice(nextFrame);
    this.inFrame = false;
    return undefined;
  }

  /** `say` sometimes repeats a frame (an emoji read as two words); report it once. */
  private isRepeat(word: SayWord): boolean {
    return this.last?.start === word.start && this.last.length === word.length;
  }
}
