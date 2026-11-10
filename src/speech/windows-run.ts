/**
 * One Windows speech run: the sentences it sent, its listener, and how it ended.
 * Routes host events for its own run id to the listener and settles `ended` exactly once.
 * Must not talk to the process directly; it asks the engine through {@link RunControl}.
 */
import type { RunEnd, RunListener, SpeechError, SpeechRun } from "./engine";
import type { HostEvent } from "./windows-protocol";

/** What a run asks of the engine that owns the host. */
export interface RunControl {
  pause(run: number): void;
  resume(run: number): void;
  cancel(run: number): void;
  /** The run has settled; the engine forgets it. */
  settled(run: number): void;
  /** A listener threw; the engine logs it. */
  problem(message: string): void;
}

/** A {@link SpeechRun} backed by the persistent PowerShell host. */
export class WindowsRun implements SpeechRun {
  /** Settles once when the run finishes, is cancelled or fails. */
  readonly ended: Promise<RunEnd>;
  private settle: (end: RunEnd) => void = () => undefined;
  private done = false;
  private paused = false;

  /**
   * @param id - the run id sent with every message for this run
   * @param sentences - the sentences sent to the host, by index
   * @param listener - receives sentence and word callbacks
   * @param control - the engine side of pause, resume and cancel
   */
  constructor(
    readonly id: number,
    private readonly sentences: readonly string[],
    private readonly listener: RunListener,
    private readonly control: RunControl,
  ) {
    this.ended = new Promise<RunEnd>((resolve) => {
      this.settle = resolve;
    });
    if (sentences.length === 0) {
      this.end({ kind: "finished" });
    }
  }

  /** True once `ended` has settled. */
  get isDone(): boolean {
    return this.done;
  }

  /** Pauses with SAPI's native `Pause()`. */
  pause(): void {
    if (!this.done && !this.paused) {
      this.paused = true;
      this.control.pause(this.id);
    }
  }

  /** Continues after {@link pause}. No-op when not paused. */
  resume(): void {
    if (!this.done && this.paused) {
      this.paused = false;
      this.control.resume(this.id);
    }
  }

  /** Stops for good and settles `cancelled`. Safe to call more than once. */
  cancel(): void {
    if (!this.done) {
      this.control.cancel(this.id);
      this.end({ kind: "cancelled" });
    }
  }

  /** Settles `failed` with the given error. No-op once settled. */
  fail(error: SpeechError): void {
    this.end({ kind: "failed", error });
  }

  /** Handles a host event already known to carry this run's id. */
  handle(event: HostEvent): void {
    if (this.done) {
      return;
    }
    switch (event.type) {
      case "sentenceStart":
        if (event.index < this.sentences.length) {
          this.call(() => this.listener.onSentenceStart?.(event.index));
        }
        return;
      case "word":
        this.word(event.index, event.start, event.length);
        return;
      case "sentenceEnd":
        if (event.index === this.sentences.length - 1) {
          this.end({ kind: "finished" });
        }
        return;
      case "ready":
      case "voices":
      case "error":
      case "audioStarted":
      case "audioEnded":
        return;
    }
  }

  private word(index: number, start: number, length: number): void {
    const text = this.sentences[index];
    if (text === undefined || start >= text.length) {
      return;
    }
    // SAPI offsets are UTF-16 code units into the prompt; clamp in case a voice overshoots.
    const clamped = Math.min(length, text.length - start);
    this.call(() => this.listener.onWord?.({ sentence: index, start, length: clamped }));
  }

  private call(callback: () => void): void {
    try {
      callback();
    } catch (error: unknown) {
      this.control.problem(`run listener threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private end(end: RunEnd): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this.settle(end);
    this.control.settled(this.id);
  }
}
