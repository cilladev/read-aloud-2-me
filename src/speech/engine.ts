/**
 * The contract every platform speech engine meets. Callers never check `process.platform`;
 * they get an engine from `create-engine.ts` and use only this interface.
 * No vscode imports here (lint enforced).
 */

/** How good a voice sounds, as the OS reports it or as its name suggests. */
export type VoiceQuality = "default" | "enhanced" | "premium";

/** An installed voice. */
export interface Voice {
  /** The value stored in the `readAloud2Me.voice` setting and passed back to `speak`. */
  readonly id: string;
  /** Name shown to the user, for example "Samantha" or "Microsoft Zira Desktop". */
  readonly name: string;
  /** BCP 47 tag such as "en-US", or "" when unknown. */
  readonly language: string;
  readonly quality: VoiceQuality;
}

/** What a run should sound like. */
export interface SpeakOptions {
  /** Voice id from {@link Voice.id}; undefined means the system default voice. */
  readonly voice: string | undefined;
  /** Speed multiplier, 0.5 to 2. 1 is the voice's normal pace. */
  readonly speed: number;
}

/** A word that is about to be spoken. Offsets index into the sentence's text. */
export interface WordEvent {
  /** Index into the `sentences` array given to {@link SpeechEngine.speak}. */
  readonly sentence: number;
  /** Start offset in that sentence's text (UTF-16 code units). */
  readonly start: number;
  /** Length in UTF-16 code units. */
  readonly length: number;
}

/** Callbacks a run reports to. All are optional. */
export interface RunListener {
  /** Sentence `index` has started playing. Fires once per sentence, in order. */
  onSentenceStart?(index: number): void;
  /** A word is starting. Only when the engine has word events. */
  onWord?(event: WordEvent): void;
}

/** How a run ended. */
export type RunEnd =
  { readonly kind: "finished" } | { readonly kind: "cancelled" } | { readonly kind: "failed"; readonly error: Error };

/** One call to {@link SpeechEngine.speak}: a list of sentences being read in order. */
export interface SpeechRun {
  /**
   * Pauses mid-sentence. Engines without a native pause stop the audio and remember the
   * current word, so {@link resume} continues from that word.
   */
  pause(): void;
  /** Continues after {@link pause}. No-op when not paused. */
  resume(): void;
  /** Stops for good. `ended` then settles with `cancelled`. Safe to call more than once. */
  cancel(): void;
  /** Settles once when the run finishes, is cancelled or fails. Never rejects. */
  readonly ended: Promise<RunEnd>;
}

/** What an engine can do on this machine. */
export interface EngineCapabilities {
  /** True when word events are reported, so the editor can highlight each word. */
  readonly wordEvents: boolean;
}

/** A platform's speech engine. One per extension session; dispose kills its processes. */
export interface SpeechEngine {
  readonly capabilities: EngineCapabilities;
  /** Lists installed voices. Rejects with {@link SpeechError} when the OS tool fails. */
  listVoices(): Promise<readonly Voice[]>;
  /**
   * Starts reading `sentences` in order, from the first. Any run already playing is cancelled.
   * Each sentence is plain text with no line breaks.
   */
  speak(sentences: readonly string[], options: SpeakOptions, listener: RunListener): SpeechRun;
  /** Cancels any run and stops helper processes. */
  dispose(): void;
}

/** Why the engine could not speak. `code` lets the UI pick a helpful message and button. */
export type SpeechErrorCode =
  "unsupportedPlatform" | "toolMissing" | "voiceNotFound" | "blockedByPolicy" | "networkFailed" | "processFailed";

/** An error from a speech engine, with a code the UI can act on. */
export class SpeechError extends Error {
  /**
   * @param code - what went wrong, for choosing the user message
   * @param message - details for the log; not shown to the user verbatim
   */
  constructor(
    readonly code: SpeechErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SpeechError";
  }
}
