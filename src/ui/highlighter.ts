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
const ALL_PARTS = { sentence: true, word: true, read: true };

function sameRange(a: SourceRange | undefined, b: SourceRange | undefined): boolean {
  return a?.start === b?.start && a?.end === b?.end;
}

/** Owns the three decoration types and the document they apply to. */
export class EditorHighlighter implements vscode.Disposable {
  private readonly sentenceType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.wordHighlightBackground"),
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  // The current word uses the theme's "current find match" colours: the strongest highlight
  // every theme defines, so it stays visible on top of the sentence mark.
  private readonly wordType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.findMatchBackground"),
    border: "1px solid",
    borderColor: new vscode.ThemeColor("editor.findMatchBorder"),
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

  /** Updates the marks. Pass undefined parts to remove them. Only parts that changed are redrawn. */
  show(view: HighlightView): void {
    const previous = this.view;
    this.view = view;
    this.apply({
      sentence: !sameRange(previous.sentence, view.sentence),
      word: !sameRange(previous.word, view.word),
      read: !sameRange(previous.read, view.read),
    });
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

  /** Draws the marks in every editor of the document; `parts` limits it to what changed. */
  private apply(parts: { sentence: boolean; word: boolean; read: boolean } = ALL_PARTS): void {
    const document = this.document;
    const editors = document ? this.editors() : [];
    for (const editor of editors) {
      if (parts.sentence) {
        editor.setDecorations(this.sentenceType, this.ranges(this.view.sentence));
      }
      if (parts.word) {
        editor.setDecorations(this.wordType, this.ranges(this.view.word));
      }
      if (parts.read) {
        editor.setDecorations(this.readType, this.ranges(this.view.read));
      }
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
