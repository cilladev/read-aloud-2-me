/**
 * Chooses between the online voices and this computer's voices for each run, and falls back
 * to the computer's voices when the online ones can't be reached before anything has played.
 * Callers see one {@link SpeechEngine}. Must not import vscode.
 */
import type { EngineCapabilities, RunEnd, RunListener, SpeakOptions, SpeechEngine, SpeechRun, Voice } from "./engine";
import { isNetworkFailure } from "./online/online-engine";

/** Where voices come from: Edge's online neural voices, or the ones installed on this computer. */
export type VoiceSource = "online" | "computer";

/** What the switching engine asks its owner at the start of each run. */
export interface SwitchingOptions {
  /** The source the user chose. */
  source(): VoiceSource;
  /** The computer voice to use when falling back, or undefined for the system voice. */
  computerVoice(): string | undefined;
  /** Called when a run fell back to the computer's voices, with the reason. */
  onFallback(error: Error): void;
}

/** Routes runs to the online or computer engine. */
export class SwitchingEngine implements SpeechEngine {
  /** Both engines report words. */
  readonly capabilities: EngineCapabilities = { wordEvents: true };

  /**
   * @param online - the online voices engine
   * @param computer - this computer's voices engine
   * @param options - the user's choices, read at the start of each run
   */
  constructor(
    private readonly online: SpeechEngine,
    private readonly computer: SpeechEngine,
    private readonly options: SwitchingOptions,
  ) {}

  /** Lists voices from the chosen source. */
  listVoices(): Promise<readonly Voice[]> {
    return this.listVoicesFor(this.options.source());
  }

  /** Lists voices from `source`. */
  listVoicesFor(source: VoiceSource): Promise<readonly Voice[]> {
    return source === "online" ? this.online.listVoices() : this.computer.listVoices();
  }

  /** Starts a run on the chosen source, with fallback from online to computer. */
  speak(sentences: readonly string[], options: SpeakOptions, listener: RunListener): SpeechRun {
    if (this.options.source() === "computer") {
      return this.computer.speak(sentences, options, listener);
    }
    return new FallbackRun(sentences, options, listener, this.online, this.computer, this.options);
  }

  /** Stops both engines. */
  dispose(): void {
    this.online.dispose();
    this.computer.dispose();
  }
}

/** An online run that swaps itself for a computer run if nothing could be played. */
class FallbackRun implements SpeechRun {
  readonly ended: Promise<RunEnd>;
  private inner: SpeechRun;
  private started = false;
  private paused = false;
  private cancelled = false;

  constructor(
    sentences: readonly string[],
    options: SpeakOptions,
    listener: RunListener,
    online: SpeechEngine,
    computer: SpeechEngine,
    switching: SwitchingOptions,
  ) {
    const tracked: RunListener = {
      onSentenceStart: (index) => {
        this.started = true;
        listener.onSentenceStart?.(index);
      },
      onWord: (word) => {
        listener.onWord?.(word);
      },
    };
    this.inner = online.speak(sentences, options, tracked);
    this.ended = this.inner.ended.then((end) => {
      if (this.started || this.cancelled || !isNetworkFailure(end) || end.kind !== "failed") {
        return end;
      }
      switching.onFallback(end.error);
      this.inner = computer.speak(sentences, { ...options, voice: switching.computerVoice() }, listener);
      if (this.paused) {
        this.inner.pause();
      }
      return this.inner.ended;
    });
  }

  pause(): void {
    this.paused = true;
    this.inner.pause();
  }

  resume(): void {
    this.paused = false;
    this.inner.resume();
  }

  cancel(): void {
    this.cancelled = true;
    this.inner.cancel();
  }
}
