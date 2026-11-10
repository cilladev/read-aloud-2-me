/**
 * Turns what the user is looking at into sentences to read: the selection, or the text from the
 * cursor, or the whole file. The only code that reads the editor selection.
 */
import * as vscode from "vscode";
import type { Settings } from "../config/settings";
import { textKindForLanguage, toSentences } from "../text/prepare";
import type { Sentence } from "../text/types";

/** Everything needed to start reading. */
export interface ReadRequest {
  /** Shown in the reader panel's tab. */
  readonly title: string;
  /** The document the offsets point into, or undefined for text with no editor (preview copy). */
  readonly document: vscode.TextDocument | undefined;
  /** The text the offsets point into. Used to find paragraph breaks for the reader panel. */
  readonly fullText: string;
  readonly sentences: readonly Sentence[];
  /** Sentence to start at. */
  readonly startIndex: number;
}

/**
 * Builds a request from a text editor.
 * With a selection, reads every selected range in order. Without one, reads the whole file
 * from the sentence at the cursor, or from the top, depending on the setting.
 */
export function requestFromEditor(editor: vscode.TextEditor, settings: Settings): ReadRequest {
  const document = editor.document;
  const fullText = document.getText();
  const kind = textKindForLanguage(document.languageId);
  const options = { skipCodeBlocks: settings.skipCodeBlocks };
  const selections = editor.selections.filter((selection) => !selection.isEmpty);
  const title = fileName(document.uri);
  if (selections.length > 0) {
    const ordered = [...selections].sort((a, b) => a.start.compareTo(b.start));
    const sentences = ordered.flatMap((selection) => {
      const start = document.offsetAt(selection.start);
      return toSentences(document.getText(selection), kind, options, start);
    });
    return { title, document, fullText, sentences, startIndex: 0 };
  }
  const cursor = settings.withoutSelection === "wholeFile" ? 0 : document.offsetAt(editor.selection.active);
  return requestFromDocument(document, settings, cursor);
}

/**
 * Builds a request for a whole document, starting at the sentence that holds `fromOffset`.
 * Used when nothing is selected, and for a Markdown preview's source file.
 */
export function requestFromDocument(document: vscode.TextDocument, settings: Settings, fromOffset = 0): ReadRequest {
  const fullText = document.getText();
  const options = { skipCodeBlocks: settings.skipCodeBlocks };
  const sentences = toSentences(fullText, textKindForLanguage(document.languageId), options, 0);
  return {
    title: fileName(document.uri),
    document,
    fullText,
    sentences,
    startIndex: sentenceAt(sentences, fromOffset),
  };
}

/**
 * Builds a request from plain text that has no editor behind it, such as text copied from the
 * Markdown preview.
 */
export function requestFromText(title: string, text: string): ReadRequest {
  return {
    title,
    document: undefined,
    fullText: text,
    sentences: toSentences(text, "plain", { skipCodeBlocks: true }, 0),
    startIndex: 0,
  };
}

/** Index of the first sentence that ends after `offset`, so reading starts where the cursor is. */
export function sentenceAt(sentences: readonly Sentence[], offset: number): number {
  const index = sentences.findIndex((sentence) => sentence.sourceEnd > offset);
  return index === -1 ? Math.max(0, sentences.length - 1) : index;
}

/** True when the text between two sentences holds a blank line, so the reader starts a paragraph. */
export function startsParagraph(fullText: string, previousEnd: number, start: number): boolean {
  return /\n[^\S\n]*\r?\n/.test(fullText.slice(previousEnd, start).replace(/\r\n/g, "\n"));
}

/** Last path segment of a URI, for titles. */
export function fileName(uri: vscode.Uri): string {
  return uri.path.split("/").pop() ?? uri.path;
}

/** The request's sentences for the reader panel, marking where paragraphs start. */
export function readerSentences(request: ReadRequest): { text: string; paragraphStart: boolean }[] {
  return request.sentences.map((sentence, index) => {
    const previous = request.sentences[index - 1];
    return {
      text: sentence.text,
      paragraphStart:
        previous !== undefined && startsParagraph(request.fullText, previous.sourceEnd, sentence.sourceStart),
    };
  });
}

/**
 * Collapses the selection to its start once reading begins. VS Code draws the selection over
 * the reading highlights, so leaving it would hide the word and sentence being read.
 */
export function clearSelection(editor: vscode.TextEditor | undefined, request: ReadRequest): void {
  if (editor && editor.document === request.document && !editor.selection.isEmpty) {
    const start = editor.selections.reduce(
      (first, s) => (s.start.isBefore(first) ? s.start : first),
      editor.selection.start,
    );
    editor.selection = new vscode.Selection(start, start);
  }
}
