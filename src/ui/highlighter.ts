/**
 * Marks the reading in the editor: the current sentence, the current word, and text already
 * read dimmed. Decoration types are created once and only their ranges change, so updating
 * on every word is cheap. Applies to every visible editor showing the document.
 */
import * as vscode from "vscode";
import type { SourceRange } from "../text/types";

/** What to mark, as document offsets. */
export interface HighlightView {
  readonly sentence: SourceRange | undefined;
  readonly word: SourceRange | undefined;
  /** Start of the reading through the start of the current sentence. */
  readonly read: SourceRange | undefined;
}

const EMPTY: HighlightView = { sentence: undefined, word: undefined, read: undefined };

/** Owns the three decoration types and the document they apply to. */
export class EditorHighlighter implements vscode.Disposable {
  private readonly sentenceType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.wordHighlightBackground"),
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private readonly wordType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    borderRadius: "2px",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private readonly readType = vscode.window.createTextEditorDecorationType({
    opacity: "0.55",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private document: vscode.TextDocument | undefined;
  private view: HighlightView = EMPTY;
  private readonly subscription: vscode.Disposable;

  constructor() {
    this.subscription = vscode.window.onDidChangeVisibleTextEditors(() => {
      this.apply();
    });
  }

  /** Sets the document being read. Clears marks on any previous one. */
  attach(document: vscode.TextDocument | undefined): void {
    this.clear();
    this.document = document;
  }

  /** Updates the marks. Pass undefined parts to remove them. */
  show(view: HighlightView): void {
    this.view = view;
    this.apply();
  }

  /** Scrolls the first editor showing the document so `range` is in view, if it is not already. */
  reveal(range: SourceRange): void {
    const editor = this.editors()[0];
    if (editor && this.document) {
      editor.revealRange(this.toRange(this.document, range), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  /** Removes every mark from every editor. */
  clear(): void {
    this.view = EMPTY;
    this.apply();
  }

  dispose(): void {
    this.subscription.dispose();
    this.sentenceType.dispose();
    this.wordType.dispose();
    this.readType.dispose();
  }

  private apply(): void {
    const document = this.document;
    const editors = document ? this.editors() : [];
    for (const editor of editors) {
      editor.setDecorations(this.sentenceType, this.ranges(this.view.sentence));
      editor.setDecorations(this.wordType, this.ranges(this.view.word));
      editor.setDecorations(this.readType, this.ranges(this.view.read));
    }
  }

  private editors(): readonly vscode.TextEditor[] {
    const uri = this.document?.uri.toString();
    return vscode.window.visibleTextEditors.filter((editor) => editor.document.uri.toString() === uri);
  }

  private ranges(range: SourceRange | undefined): vscode.Range[] {
    if (!range || !this.document || range.end <= range.start) {
      return [];
    }
    return [this.toRange(this.document, range)];
  }

  private toRange(document: vscode.TextDocument, range: SourceRange): vscode.Range {
    return new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
  }
}
