/**
 * The reading session: which sentence is playing, whether it is paused, and what happens on
 * next, previous, jump, voice or speed change. Pure state machine over a {@link SpeechEngine};
 * it knows nothing about VS Code, so the UI only listens to its events.
 * Must not import vscode or touch processes directly.
 */
import type { RunEnd, SpeakOptions, SpeechEngine, SpeechRun, WordEvent } from "../speech/engine";

/** Whether anything is being read. `paused` keeps the place; `idle` has none. */
export type SessionState = "idle" | "reading" | "paused";

/** A word being spoken, with the sentence index in the whole session. */
export interface SessionWord {
  readonly sentence: number;
  readonly start: number;
  readonly length: number;
}

/** Callbacks the UI registers. Every one is optional. */
export interface SessionListener {
  /** The state changed. */
  onState?(state: SessionState): void;
  /** Sentence `index` of `total` is now current (0-based). */
  onSentence?(index: number, total: number): void;
  /** A word inside the current sentence is starting. */
  onWord?(word: SessionWord): void;
  /** Reading ended on its own, failed, or was stopped. Fires once per start. */
  onEnd?(end: RunEnd): void;
}

/** Supplies voice and speed at the moment a run starts, so setting changes apply on restart. */
export type OptionsProvider = () => SpeakOptions;

/**
 * Reads a list of sentences through a speech engine, one run at a time.
 *
 * @example
 * const session = new ReadingSession(engine, () => ({ voice: undefined, speed: 1 }));
 * session.subscribe({ onSentence: (i, n) => show(`${i + 1} of ${n}`) });
 * session.start(["Hello there.", "Bye."]);
 */
export class ReadingSession {
  private sentences: readonly string[] = [];
  private run: SpeechRun | undefined;
  /** Bumped on every new run, so callbacks from an older run can tell they are stale. */
  private generation = 0;
  private currentIndex = 0;
  private stateValue: SessionState = "idle";
  private restartOnResume = false;
  private readonly listeners = new Set<SessionListener>();

  /**
   * @param engine - the platform engine that makes the sound
   * @param options - read each time a run starts
   */
  constructor(
    private readonly engine: SpeechEngine,
    private readonly options: OptionsProvider,
  ) {}

  /** Current state. */
  get state(): SessionState {
    return this.stateValue;
  }

  /** Index of the current sentence, 0-based. Meaningless while idle. */
  get current(): number {
    return this.currentIndex;
  }

  /** Number of sentences in this session. */
  get total(): number {
    return this.sentences.length;
  }

  /** Registers a listener. Returns a function that removes it. */
  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Starts reading `sentences` from index `from`, replacing anything playing.
   * An empty list ends at once with `finished`.
   */
  start(sentences: readonly string[], from = 0): void {
    this.cancelRun();
    this.sentences = sentences;
    if (sentences.length === 0) {
      this.setState("idle");
      this.emitEnd({ kind: "finished" });
      return;
    }
    this.play(clamp(from, 0, sentences.length - 1));
  }

  /** Pauses mid-sentence. No-op unless reading. */
  pause(): void {
    if (this.stateValue !== "reading") {
      return;
    }
    this.run?.pause();
    this.setState("paused");
  }

  /** Resumes after {@link pause}, or restarts the sentence if voice or speed changed meanwhile. */
  resume(): void {
    if (this.stateValue !== "paused") {
      return;
    }
    if (this.restartOnResume || this.run === undefined) {
      this.play(this.currentIndex);
      return;
    }
    this.run.resume();
    this.setState("reading");
  }

  /** Pauses when reading, resumes when paused. */
  togglePause(): void {
    if (this.stateValue === "reading") {
      this.pause();
    } else {
      this.resume();
    }
  }

  /** Reads from the next sentence. At the last sentence this does nothing. */
  next(): void {
    if (this.stateValue !== "idle" && this.currentIndex < this.sentences.length - 1) {
      this.play(this.currentIndex + 1);
    }
  }

  /** Reads from the previous sentence, or restarts the first one. */
  previous(): void {
    if (this.stateValue !== "idle") {
      this.play(Math.max(0, this.currentIndex - 1));
    }
  }

  /** Reads from sentence `index`. Ignored when idle or out of range. */
  jumpTo(index: number): void {
    if (this.stateValue !== "idle" && Number.isInteger(index) && index >= 0 && index < this.sentences.length) {
      this.play(index);
    }
  }

  /**
   * Applies a new voice or speed: restarts the current sentence now, or on resume when paused.
   */
  restartCurrent(): void {
    if (this.stateValue === "reading") {
      this.play(this.currentIndex);
    } else if (this.stateValue === "paused") {
      this.restartOnResume = true;
    }
  }

  /** Stops reading. Fires `onEnd` with `cancelled` when something was playing. */
  stop(): void {
    if (this.stateValue === "idle") {
      return;
    }
    this.cancelRun();
    this.setState("idle");
    this.emitEnd({ kind: "cancelled" });
  }

  /** Starts a run at `from`; events from any older run are ignored. */
  private play(from: number): void {
    this.cancelRun();
    this.restartOnResume = false;
    this.setCurrent(from);
    this.setState("reading");
    const generation = ++this.generation;
    const run = this.engine.speak(this.sentences.slice(from), this.options(), {
      onSentenceStart: (index) => {
        if (this.generation === generation) {
          this.setCurrent(from + index);
        }
      },
      onWord: (event: WordEvent) => {
        if (this.generation === generation) {
          this.emitWord(from, event);
        }
      },
    });
    this.run = run;
    void run.ended.then((end) => {
      this.onRunEnded(generation, end);
    });
  }

  /** Handles the end of a run, unless it was replaced or cancelled by us. */
  private onRunEnded(generation: number, end: RunEnd): void {
    if (this.generation !== generation || end.kind === "cancelled") {
      return;
    }
    this.run = undefined;
    this.setState("idle");
    this.emitEnd(end);
  }

  private cancelRun(): void {
    const run = this.run;
    this.run = undefined;
    this.generation++;
    run?.cancel();
  }

  private setCurrent(index: number): void {
    this.currentIndex = index;
    for (const listener of this.listeners) {
      listener.onSentence?.(index, this.sentences.length);
    }
  }

  private setState(state: SessionState): void {
    if (this.stateValue === state) {
      return;
    }
    this.stateValue = state;
    for (const listener of this.listeners) {
      listener.onState?.(state);
    }
  }

  private emitWord(from: number, event: WordEvent): void {
    const word: SessionWord = { sentence: from + event.sentence, start: event.start, length: event.length };
    for (const listener of this.listeners) {
      listener.onWord?.(word);
    }
  }

  private emitEnd(end: RunEnd): void {
    for (const listener of this.listeners) {
      listener.onEnd?.(end);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
