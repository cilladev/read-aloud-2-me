/**
 * Connects VS Code to the reading session: builds a read request from the editor or the
 * Markdown preview, starts the session, and keeps the status bar, context keys, editor
 * highlights and reader panel in step with it. Command handlers call only this class.
 */
import * as vscode from "vscode";
import { affectsVoiceOrSpeed, readSettings, saveSpeed, saveVoice } from "../config/settings";
import type { ReaderPanel } from "../reader/reader-panel";
import { shiftSentences } from "../session/offset-shift";
import { ReadingSession } from "../session/reading-session";
import type { SessionState, SessionWord } from "../session/reading-session";
import type { RunEnd, SpeechEngine } from "../speech/engine";
import { mapSpokenRange } from "../text/offset-map";
import type { Sentence } from "../text/types";
import { setReadingContext } from "../ui/context-keys";
import { EditorHighlighter } from "../ui/highlighter";
import { pickSpeed, pickVoice } from "../ui/quick-picks";
import { ReadingStatusBar } from "../ui/status-bar";
import { isMarkdownPreviewActive, requestFromPreview } from "./preview-request";
import { requestFromEditor, startsParagraph } from "./read-request";
import type { ReadRequest } from "./read-request";
import { showSpeechError } from "./speech-errors";
import { VoiceGuard } from "./voice-guard";

const READER_VIEW_TYPE = "readAloud2Me.reader";

/** Owns one reading session and everything that shows it. */
export class ReadingController implements vscode.Disposable {
  private readonly session: ReadingSession;
  private readonly statusBar = new ReadingStatusBar();
  private readonly highlighter = new EditorHighlighter();
  private readonly disposables: vscode.Disposable[] = [];
  private request: ReadRequest | undefined;
  /** The request's sentences, shifted as the document is edited; undefined once edited away. */
  private tracked: (Sentence | undefined)[] = [];
  /** The sentence the current reading started at, for dimming what has been read. */
  private startIndex = 0;
  private readonly voices: VoiceGuard;

  /**
   * @param engine - the platform speech engine
   * @param reader - the reader panel, shown on demand
   * @param log - the extension's log channel
   */
  constructor(
    engine: SpeechEngine,
    private readonly reader: ReaderPanel,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.voices = new VoiceGuard(engine, log);
    this.session = new ReadingSession(engine, () => {
      const settings = readSettings();
      return { voice: this.voices.usable(settings.voice), speed: settings.speed };
    });
    this.session.subscribe({
      onState: (state) => {
        this.onState(state);
      },
      onSentence: (index) => {
        this.onSentence(index);
      },
      onWord: (word) => {
        this.onWord(word);
      },
      onEnd: (end) => {
        this.onEnd(end);
      },
    });
    this.disposables.push(
      this.statusBar,
      this.highlighter,
      reader.onDidJumpTo((index) => {
        this.jumpTo(index);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (affectsVoiceOrSpeed(event)) {
          this.voices.reset();
          this.session.restartCurrent();
          this.refreshStatus();
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.onDocumentChanged(event);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document === this.request?.document) {
          this.stop();
        }
      }),
    );
  }

  /** Whether anything is being read. */
  get state(): SessionState {
    return this.session.state;
  }

  /** The current sentence, 0-based. */
  get current(): number {
    return this.session.current;
  }

  /** The shortcut: stops when reading, otherwise reads. */
  async toggle(): Promise<void> {
    if (this.session.state !== "idle") {
      this.stop();
      return;
    }
    await this.read();
  }

  /** Reads the selection, the text from the cursor, the preview, or what the reader shows. */
  async read(): Promise<void> {
    const request = await this.buildRequest();
    if (!request) {
      return;
    }
    if (request.sentences.length === 0) {
      void vscode.window.showInformationMessage("There is nothing to read here.");
      return;
    }
    await this.voices.check(readSettings().voice, () => this.pickVoice());
    this.begin(request, request.startIndex);
  }

  /** Stops reading. */
  stop(): void {
    this.session.stop();
  }

  /** Pauses or resumes. */
  togglePause(): void {
    this.session.togglePause();
  }

  /** Pauses mid-sentence. */
  pause(): void {
    this.session.pause();
  }

  /** Resumes after a pause. */
  resume(): void {
    this.session.resume();
  }

  /** Reads from the next sentence. */
  next(): void {
    this.session.next();
  }

  /** Reads from the previous sentence. */
  previous(): void {
    this.session.previous();
  }

  /** Opens the reader panel beside the editor. */
  openReader(): void {
    this.reader.show();
  }

  /** Lets the user pick an installed voice and saves it. A running sentence restarts with it. */
  async pickVoice(): Promise<void> {
    try {
      const voices = await this.voices.installed(true);
      const chosen = await pickVoice(voices, readSettings().voice);
      if (chosen !== undefined) {
        await saveVoice(chosen);
      }
    } catch (error: unknown) {
      await showSpeechError(error, this.log);
    }
  }

  /** Lets the user pick a speed and saves it. A running sentence restarts with it. */
  async setSpeed(): Promise<void> {
    const chosen = await pickSpeed(readSettings().speed);
    if (chosen !== undefined) {
      await saveSpeed(chosen);
    }
  }

  dispose(): void {
    this.session.stop();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async buildRequest(): Promise<ReadRequest | undefined> {
    const settings = readSettings();
    if (isMarkdownPreviewActive()) {
      const request = await requestFromPreview(settings);
      if (!request) {
        void vscode.window.showInformationMessage("Select text in the preview to read it aloud.");
      }
      return request;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      return requestFromEditor(editor, settings);
    }
    if (this.isReaderActive() && this.request) {
      return { ...this.request, startIndex: 0 };
    }
    void vscode.window.showInformationMessage("Open a file and select text to read it aloud.");
    return undefined;
  }

  private begin(request: ReadRequest, from: number): void {
    this.request = request;
    this.startIndex = from;
    this.tracked = [...request.sentences];
    this.highlighter.attach(request.document);
    this.reader.setDocument(request.title, this.readerSentences(request));
    if (readSettings().openReaderOnStart) {
      this.reader.show();
    }
    this.session.start(
      request.sentences.map((sentence) => sentence.text),
      from,
    );
  }

  private readerSentences(request: ReadRequest): { text: string; paragraphStart: boolean }[] {
    return request.sentences.map((sentence, index) => {
      const previous = request.sentences[index - 1];
      return {
        text: sentence.text,
        paragraphStart:
          previous !== undefined && startsParagraph(request.fullText, previous.sourceEnd, sentence.sourceStart),
      };
    });
  }

  private jumpTo(index: number): void {
    if (this.session.state === "idle") {
      if (this.request) {
        this.begin(this.request, index);
      }
      return;
    }
    this.session.jumpTo(index);
  }

  private onState(state: SessionState): void {
    setReadingContext(state, (message) => {
      this.log.warn(message);
    });
    this.refreshStatus();
    if (state === "idle") {
      this.highlighter.clear();
      this.reader.setProgress(-1);
    }
  }

  private onSentence(index: number): void {
    this.refreshStatus();
    this.reader.setProgress(index);
    const sentence = this.tracked[index];
    if (!sentence || readSettings().highlight === "off") {
      this.highlighter.clear();
      return;
    }
    this.highlighter.show({
      sentence: { start: sentence.sourceStart, end: sentence.sourceEnd },
      word: undefined,
      read: { start: this.readStart(index), end: sentence.sourceStart },
    });
    this.highlighter.reveal({ start: sentence.sourceStart, end: sentence.sourceEnd });
  }

  private onWord(word: SessionWord): void {
    this.reader.setProgress(word.sentence, { start: word.start, length: word.length });
    const sentence = this.tracked[word.sentence];
    if (!sentence || readSettings().highlight !== "wordAndSentence") {
      return;
    }
    this.highlighter.show({
      sentence: { start: sentence.sourceStart, end: sentence.sourceEnd },
      word: mapSpokenRange(sentence, word.start, word.length),
      read: { start: this.readStart(word.sentence), end: sentence.sourceStart },
    });
  }

  /** Where the dimmed "already read" text begins: the first sentence this reading started at. */
  private readStart(current: number): number {
    const from = Math.min(this.startIndex, current);
    const first = this.tracked.slice(from, current + 1).find((candidate) => candidate !== undefined);
    return first?.sourceStart ?? 0;
  }

  private onEnd(end: RunEnd): void {
    if (end.kind === "failed") {
      void showSpeechError(end.error, this.log);
    }
  }

  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    if (event.document !== this.request?.document || event.contentChanges.length === 0) {
      return;
    }
    this.tracked = shiftSentences(
      this.tracked,
      event.contentChanges.map((change) => ({
        start: change.rangeOffset,
        end: change.rangeOffset + change.rangeLength,
        insertedLength: change.text.length,
      })),
    );
  }

  private refreshStatus(): void {
    const settings = readSettings();
    this.statusBar.update({
      state: this.session.state,
      current: this.session.current,
      total: this.session.total,
      speed: settings.speed,
      voice: this.voices.usable(settings.voice),
      sentence: this.request?.sentences[this.session.current]?.text,
    });
  }

  private isReaderActive(): boolean {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputWebview && input.viewType.endsWith(READER_VIEW_TYPE);
  }
}
