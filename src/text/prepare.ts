/**
 * The text layer's entry point: picks the cleaner for a document kind and returns sentences
 * with offsets in the caller's document. Pure: no vscode, no I/O.
 */

import { markdownToSentences } from "./markdown";
import { codeToSentences, plainToSentences } from "./plain";
import type { Sentence, TextKind, TextOptions } from "./types";

const MARKDOWN_LANGUAGES = new Set(["markdown", "mdx", "quarto", "rmd"]);
const PLAIN_LANGUAGES = new Set(["plaintext", "txt", "log", "restructuredtext", "asciidoc", "latex", "tex"]);

/**
 * Turns text into the sentences to speak.
 * @param source - the text, often the user's selection.
 * @param kind - which cleaner to use; see {@link textKindForLanguage}.
 * @param options - what to leave out.
 * @param baseOffset - added to every source offset, so a selection maps to document offsets.
 * @example
 * toSentences("Hi **there**.", "markdown", { skipCodeBlocks: true }, 100)[0]?.sourceStart; // 100
 */
export function toSentences(source: string, kind: TextKind, options: TextOptions, baseOffset = 0): Sentence[] {
  const sentences = clean(source, kind, options);
  return baseOffset === 0 ? sentences : sentences.map((sentence) => shift(sentence, baseOffset));
}

/**
 * Picks the cleaner for a VS Code language id: Markdown, plain prose, or code.
 * @example
 * textKindForLanguage("typescript"); // "code"
 */
export function textKindForLanguage(languageId: string): TextKind {
  if (MARKDOWN_LANGUAGES.has(languageId)) {
    return "markdown";
  }
  return PLAIN_LANGUAGES.has(languageId) ? "plain" : "code";
}

function clean(source: string, kind: TextKind, options: TextOptions): Sentence[] {
  switch (kind) {
    case "markdown":
      return markdownToSentences(source, options);
    case "plain":
      return plainToSentences(source);
    case "code":
      return codeToSentences(source);
  }
}

function shift(sentence: Sentence, by: number): Sentence {
  return {
    text: sentence.text,
    sourceStart: sentence.sourceStart + by,
    sourceEnd: sentence.sourceEnd + by,
    pieces: sentence.pieces.map((piece) => ({
      ...piece,
      sourceStart: piece.sourceStart + by,
      sourceEnd: piece.sourceEnd + by,
    })),
  };
}
