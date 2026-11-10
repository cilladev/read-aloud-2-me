/**
 * Shared shapes for the text layer: what the speech engine is given, and how each spoken
 * character maps back to the source document so the editor can highlight it.
 * Pure types; no runtime code.
 */

/**
 * How a piece of spoken text relates to its source.
 * - `verbatim`: spoken text equals the source slice, so offsets map one to one.
 * - `synthetic`: spoken text was made up or reshaped (a table header, a URL's domain), so any
 *   offset inside it maps to the whole source range.
 */
export type PieceKind = "verbatim" | "synthetic";

/** One stretch of a sentence's spoken text and the source range it came from. */
export interface Piece {
  /** Start offset in {@link Sentence.text}, inclusive. */
  readonly spokenStart: number;
  /** End offset in {@link Sentence.text}, exclusive. */
  readonly spokenEnd: number;
  /** Start offset in the source string (UTF-16 code units), inclusive. */
  readonly sourceStart: number;
  /** End offset in the source string (UTF-16 code units), exclusive. */
  readonly sourceEnd: number;
  readonly kind: PieceKind;
}

/** One sentence, exactly as it is sent to the speech engine. */
export interface Sentence {
  /** The words to speak. Single-spaced, trimmed, never contains a line break. */
  readonly text: string;
  /** Start of the whole sentence in the source, for sentence highlighting. */
  readonly sourceStart: number;
  /** End of the whole sentence in the source, exclusive. */
  readonly sourceEnd: number;
  /** Pieces sorted by `spokenStart`, not overlapping. Gaps (inserted spaces) belong to no piece. */
  readonly pieces: readonly Piece[];
}

/** Which cleaner to use for a document. */
export type TextKind = "markdown" | "plain" | "code";

/** Options that change what is spoken. */
export interface TextOptions {
  /** Markdown only: leave fenced and indented code blocks out, silently. */
  readonly skipCodeBlocks: boolean;
}

/** A source range in UTF-16 offsets, end exclusive. */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}
