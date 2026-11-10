/**
 * The reader panel: a webview beside the editor that shows the text being read, lights the
 * current sentence, and lets the user click a sentence or change the text size.
 * All state lives here, so the webview can be thrown away and rebuilt at any time.
 * Must not read the editor, speak, or trust anything the webview sends.
 */
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import {
  DEFAULT_FONT_SIZE,
  clampFontSize,
  parseWebviewMessage,
  type HostToWebview,
  type ReaderSentence,
  type SourceSpan,
  type ViewNode,
  type WebviewToHost,
  type WordRange,
} from "./messages";

const VIEW_TYPE = "readAloud2Me.reader";
const FONT_SIZE_KEY = "readAloud2Me.reader.fontSize";
const TITLE_PREFIX = "Reader";

/** One reader panel at a time, opened beside the editor like "Open Preview to the Side". */
export class ReaderPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  private webviewReady = false;
  private title = "";
  private sentences: readonly ReaderSentence[] = [];
  private current = -1;
  private word: WordRange | undefined;
  private wordSource: SourceSpan | undefined;
  private markdown: readonly ViewNode[] | undefined;
  private fontSize: number;
  private readonly jumpEmitter = new vscode.EventEmitter<number>();

  /** Fires with a sentence index when the user clicks a sentence to read from there. */
  readonly onDidJumpTo: vscode.Event<number> = this.jumpEmitter.event;

  /**
   * @param extensionUri - The extension's root, used to find media/.
   * @param memento - Where the text size is kept (globalState).
   * @param emptyHint - The one-line hint shown when nothing is being read.
   * @param log - Called with a plain message when something fails; defaults to doing nothing.
   */
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly memento: vscode.Memento,
    private readonly emptyHint: string,
    private readonly log: (message: string) => void = () => undefined,
  ) {
    this.fontSize = readFontSize(memento);
  }

  /** True while the panel exists, visible or not. */
  get isOpen(): boolean {
    return this.panel !== undefined;
  }

  /** Open the panel beside the editor, or bring it forward, without taking focus. */
  show(): void {
    if (this.panel) {
      this.panel.reveal(undefined, true);
      return;
    }
    this.panel = this.createPanel();
  }

  /**
   * Show new reading content. Nothing is lit until {@link setProgress} is called.
   * @param title - The file name; only its last path segment is shown.
   * @param sentences - The sentences in reading order.
   * @param markdown - The formatted Markdown view, for Markdown files; plain sentences otherwise.
   */
  setDocument(title: string, sentences: readonly ReaderSentence[], markdown?: readonly ViewNode[]): void {
    this.title = basename(title);
    this.sentences = sentences.map((s) => ({ text: s.text, paragraphStart: s.paragraphStart }));
    this.markdown = markdown;
    this.current = -1;
    this.word = undefined;
    this.wordSource = undefined;
    this.updateTitle();
    this.postRender();
  }

  /**
   * Light a sentence and, optionally, a word in it. Cheap: skipped while the panel is hidden.
   * @param current - Sentence index, or -1 when not reading. Out-of-range values mean -1.
   * @param word - The word being spoken, as offsets into that sentence's text.
   * @param wordSource - The same word as a source range, for the formatted Markdown view.
   */
  setProgress(current: number, word?: WordRange, wordSource?: SourceSpan): void {
    this.current = Number.isInteger(current) && current >= 0 && current < this.sentences.length ? current : -1;
    this.word = this.current >= 0 && word ? { start: word.start, length: word.length } : undefined;
    this.wordSource = this.current >= 0 && wordSource ? { start: wordSource.start, end: wordSource.end } : undefined;
    this.post(this.progressMessage());
  }

  /** Go back to the empty state. */
  clear(): void {
    this.setDocument("", []);
  }

  /** Close the panel and release everything. */
  dispose(): void {
    this.panel?.dispose();
    this.jumpEmitter.dispose();
  }

  private createPanel(): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      panelTitle(this.title),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [this.mediaUri()],
      },
    );
    this.webviewReady = false;
    this.panelDisposables = [
      panel.webview.onDidReceiveMessage((raw: unknown) => {
        this.onMessage(raw);
      }),
      panel.onDidChangeViewState((event) => {
        // A hidden webview is destroyed; it posts "ready" again when shown.
        if (!event.webviewPanel.visible) {
          this.webviewReady = false;
        }
      }),
      panel.onDidDispose(() => {
        this.onPanelDisposed();
      }),
    ];
    panel.webview.html = this.html(panel.webview);
    return panel;
  }

  private onPanelDisposed(): void {
    for (const disposable of this.panelDisposables) {
      disposable.dispose();
    }
    this.panelDisposables = [];
    this.panel = undefined;
    this.webviewReady = false;
  }

  private onMessage(raw: unknown): void {
    const message = parseWebviewMessage(raw);
    if (!message) {
      this.log("Reader panel sent a message that was not valid; ignored.");
      return;
    }
    this.handle(message);
  }

  private handle(message: WebviewToHost): void {
    switch (message.type) {
      case "ready":
        this.webviewReady = true;
        this.postRender();
        return;
      case "jumpTo":
        if (message.index < this.sentences.length) {
          this.jumpEmitter.fire(message.index);
        }
        return;
      case "fontSize":
        this.storeFontSize(message.value);
        return;
    }
  }

  private storeFontSize(value: number): void {
    this.fontSize = clampFontSize(value);
    this.memento.update(FONT_SIZE_KEY, this.fontSize).then(undefined, (error: unknown) => {
      this.log(`Could not save the reader text size: ${String(error)}`);
    });
  }

  private postRender(): void {
    const render: HostToWebview = {
      type: "render",
      title: panelTitle(this.title),
      sentences: this.sentences,
      current: this.current,
      fontSize: this.fontSize,
      emptyHint: this.emptyHint,
    };
    this.post(this.markdown === undefined ? render : { ...render, markdown: this.markdown });
    if (this.word) {
      this.post(this.progressMessage());
    }
  }

  private progressMessage(): HostToWebview {
    return {
      type: "progress",
      current: this.current,
      ...(this.word ? { word: this.word } : {}),
      ...(this.wordSource ? { wordSource: this.wordSource } : {}),
    };
  }

  private post(message: HostToWebview): void {
    const panel = this.panel;
    if (!panel?.visible || !this.webviewReady) {
      return;
    }
    panel.webview.postMessage(message).then(
      (delivered) => {
        if (!delivered) {
          this.log(`Reader panel did not take the "${message.type}" message.`);
        }
      },
      (error: unknown) => {
        this.log(`Could not send "${message.type}" to the reader panel: ${String(error)}`);
      },
    );
  }

  private updateTitle(): void {
    if (this.panel) {
      this.panel.title = panelTitle(this.title);
    }
  }

  private mediaUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.extensionUri, "media");
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString("base64");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.mediaUri(), "reader.css")).toString();
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.mediaUri(), "reader.js")).toString();
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource}`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${escapeHtml(css)}">
<title>${escapeHtml(panelTitle(this.title))}</title>
</head>
<body>
<script nonce="${nonce}" src="${escapeHtml(js)}"></script>
</body>
</html>`;
  }
}

function readFontSize(memento: vscode.Memento): number {
  const stored = memento.get<unknown>(FONT_SIZE_KEY);
  return typeof stored === "number" ? clampFontSize(stored) : DEFAULT_FONT_SIZE;
}

function panelTitle(fileName: string): string {
  return fileName ? `${TITLE_PREFIX}: ${fileName}` : TITLE_PREFIX;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
