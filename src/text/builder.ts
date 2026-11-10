/**
 * Builds one block of spoken text piece by piece, collapsing whitespace while keeping every
 * spoken character mapped to its source range. Pure: no vscode, no I/O.
 */

import type { Piece, PieceKind } from "./types";

/** A block of spoken text before it is split into sentences: single-spaced and trimmed. */
export interface SpokenBlock {
  readonly text: string;
  readonly pieces: readonly Piece[];
}

const WHITESPACE = /\s/;
// Punctuation that attaches to the word before it, so a space left by silent content
// ("see ![logo](x.png).") is dropped.
const ATTACHES_LEFT = /^[.,;:!?)\]}…]/u;
const TERMINAL = /[.!?:;…]["'”’)\]]*$/u;

interface MutablePiece {
  spokenStart: number;
  spokenEnd: number;
  sourceStart: number;
  sourceEnd: number;
  kind: PieceKind;
}

/** Collects spoken text and its pieces for one block, so cleaners never do offset arithmetic. */
export class BlockBuilder {
  private text = "";
  private readonly pieces: MutablePiece[] = [];
  private pendingSpace = false;
  // Source index of a lone " " waiting to be spoken, so "a b" stays one verbatim piece.
  private pendingSpaceSource: number | undefined;

  /** True when nothing has been spoken yet. */
  get isEmpty(): boolean {
    return this.text.length === 0;
  }

  /**
   * Appends text that equals the source starting at `sourceStart`. Whitespace runs collapse to
   * one space; a run that is not a single " " becomes a gap that belongs to no piece.
   */
  appendVerbatim(text: string, sourceStart: number): void {
    let i = 0;
    while (i < text.length) {
      const runStart = i;
      const isSpace = WHITESPACE.test(text.charAt(i));
      while (i < text.length && WHITESPACE.test(text.charAt(i)) === isSpace) {
        i++;
      }
      if (isSpace) {
        const lone = i - runStart === 1 && text.charAt(runStart) === " ";
        this.markSpace(lone ? sourceStart + runStart : undefined);
      } else {
        this.addPiece("verbatim", text.slice(runStart, i), sourceStart + runStart, sourceStart + i);
      }
    }
  }

  /** Appends made-up text that stands for the whole source range `[sourceStart, sourceEnd)`. */
  appendSynthetic(text: string, sourceStart: number, sourceEnd: number): void {
    const collapsed = text.replace(/\s+/g, " ");
    if (/^\s/.test(collapsed)) {
      this.space();
    }
    const trimmed = collapsed.trim();
    if (trimmed.length > 0) {
      this.addPiece("synthetic", trimmed, sourceStart, sourceEnd);
    }
    if (/\s$/.test(collapsed)) {
      this.space();
    }
  }

  /** Asks for a space before whatever comes next. Leading and trailing spaces are dropped. */
  space(): void {
    this.markSpace(undefined);
  }

  /** Appends another block's text and pieces, shifting its spoken offsets. */
  appendBlock(block: SpokenBlock): void {
    let previousEnd = 0;
    for (const piece of block.pieces) {
      // A gap between two pieces is an inserted space.
      if (piece.spokenStart > previousEnd) {
        this.space();
      }
      previousEnd = piece.spokenEnd;
      const text = block.text.slice(piece.spokenStart, piece.spokenEnd);
      if (piece.kind === "verbatim") {
        this.appendVerbatim(text, piece.sourceStart);
      } else {
        this.addPiece("synthetic", text, piece.sourceStart, piece.sourceEnd);
      }
    }
  }

  /**
   * Ends the block with a synthetic "." unless it already ends in terminal punctuation, so the
   * voice pauses after headings and list items. The "." maps to the last spoken source character.
   */
  terminate(): void {
    const last = this.pieces.at(-1);
    if (last === undefined || TERMINAL.test(this.text)) {
      return;
    }
    const start = last.kind === "verbatim" ? last.sourceEnd - 1 : last.sourceStart;
    this.pendingSpace = false;
    this.addPiece("synthetic", ".", start, last.sourceEnd);
  }

  /** Returns the finished block. */
  build(): SpokenBlock {
    return { text: this.text, pieces: this.pieces.map((piece) => ({ ...piece })) };
  }

  private markSpace(source: number | undefined): void {
    if (this.text.length === 0) {
      return;
    }
    this.pendingSpaceSource = this.pendingSpace ? undefined : source;
    this.pendingSpace = true;
  }

  private flushSpace(kind: PieceKind, sourceStart: number, next: string): void {
    if (!this.pendingSpace) {
      return;
    }
    const source = this.pendingSpaceSource;
    this.pendingSpace = false;
    this.pendingSpaceSource = undefined;
    if (ATTACHES_LEFT.test(next)) {
      return;
    }
    const last = this.pieces.at(-1);
    const joins =
      source !== undefined &&
      kind === "verbatim" &&
      last?.kind === "verbatim" &&
      last.sourceEnd === source &&
      sourceStart === source + 1;
    if (joins) {
      this.addPiece("verbatim", " ", source, source + 1);
    } else {
      this.text += " ";
    }
  }

  private addPiece(kind: PieceKind, text: string, sourceStart: number, sourceEnd: number): void {
    this.flushSpace(kind, sourceStart, text);
    const spokenStart = this.text.length;
    this.text += text;
    const last = this.pieces.at(-1);
    if (
      kind === "verbatim" &&
      last?.kind === "verbatim" &&
      last.spokenEnd === spokenStart &&
      last.sourceEnd === sourceStart
    ) {
      last.spokenEnd = this.text.length;
      last.sourceEnd = sourceEnd;
      return;
    }
    this.pieces.push({ spokenStart, spokenEnd: this.text.length, sourceStart, sourceEnd, kind });
  }
}
