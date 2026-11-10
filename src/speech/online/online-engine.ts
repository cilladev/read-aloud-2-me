/**
 * The online speech engine: downloads each sentence from Edge's neural voices and plays it
 * with the platform's audio player. Sentences are fetched a few ahead so playback runs on
 * without gaps. Pause stops the audio and remembers the position; resume plays the rest of
 * the same audio, cut at an MP3 frame. Must not import vscode.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpeechError } from "../engine";
import type { EngineCapabilities, RunEnd, RunListener, SpeakOptions, SpeechEngine, SpeechRun, Voice } from "../engine";
import type { AudioPlayback, AudioPlayer } from "./audio-player";
import { speechEndMs, timeWords } from "./edge-text";
import type { TimedWord } from "./edge-text";
import { DEFAULT_ONLINE_VOICE } from "./edge-synthesizer";
import type { Synthesis, Synthesizer } from "./edge-synthesizer";
import { sliceMp3 } from "./mp3";

/** How many sentences to download ahead of the one playing. */
export const PREFETCH_AHEAD = 3;

/** The pause left after a sentence's last word before the next sentence starts. */
export const SENTENCE_GAP_MS = 150;

type RunState = "playing" | "paused" | "done";

/** One run: plays sentences in order, one audio file each. */
class OnlineRun implements SpeechRun {
  readonly ended: Promise<RunEnd>;
  private settleEnded: (end: RunEnd) => void = () => undefined;
  private state: RunState = "playing";
  private readonly downloads = new Map<number, Promise<Synthesis>>();
  private index = 0;
  /** Where in the current sentence's audio playback started, in ms. */
  private playedFromMs = 0;
  private playStartedAt = 0;
  private playback: AudioPlayback | undefined;
  private timers: NodeJS.Timeout[] = [];
  private generation = 0;
  private announced = -1;
  private readonly dir: string;

  constructor(
    private readonly synth: Synthesizer,
    private readonly player: AudioPlayer,
    private readonly sentences: readonly string[],
    private readonly options: SpeakOptions,
    private readonly listener: RunListener,
  ) {
    this.ended = new Promise((resolve) => (this.settleEnded = resolve));
    this.dir = join(tmpdir(), `read-aloud-2-me-${randomUUID()}`);
    void this.playSentence(0, 0);
  }

  pause(): void {
    if (this.state !== "playing") {
      return;
    }
    this.state = "paused";
    const elapsed = this.playback ? Date.now() - this.playStartedAt - this.player.startLatencyMs : 0;
    this.playedFromMs = Math.max(0, this.playedFromMs + elapsed);
    this.stopAudio();
  }

  resume(): void {
    if (this.state !== "paused") {
      return;
    }
    this.state = "playing";
    void this.playSentence(this.index, this.playedFromMs);
  }

  cancel(): void {
    this.finish({ kind: "cancelled" });
  }

  /** Downloads (or reuses) sentence `index` and plays it from `fromMs`. */
  private async playSentence(index: number, fromMs: number): Promise<void> {
    const generation = ++this.generation;
    if (index >= this.sentences.length) {
      this.finish({ kind: "finished" });
      return;
    }
    this.index = index;
    this.prefetch(index);
    let synthesis: Synthesis;
    try {
      synthesis = await this.download(index);
    } catch (error: unknown) {
      this.fail(error);
      return;
    }
    if (generation !== this.generation || this.state !== "playing") {
      return;
    }
    const slice = fromMs > 0 ? sliceMp3(synthesis.audio, fromMs) : { audio: synthesis.audio, startMs: 0 };
    const remainingMs = synthesis.durationMs - slice.startMs;
    if (slice.audio.length === 0 || remainingMs <= 0) {
      void this.playSentence(index + 1, 0);
      return;
    }
    this.start(index, synthesis, slice.audio, slice.startMs, remainingMs);
  }

  private start(index: number, synthesis: Synthesis, audio: Uint8Array, startMs: number, remainingMs: number): void {
    const file = this.writeAudio(index, audio);
    this.playedFromMs = startMs;
    this.playStartedAt = Date.now();
    const playback = this.player.play(file, remainingMs);
    this.playback = playback;
    this.announceThrough(index);
    this.scheduleWords(index, timeWords(this.sentences[index] ?? "", synthesis.words), startMs);
    this.scheduleAdvance(index, playback, synthesis, startMs);
    void playback.ended.then((end) => {
      if (this.playback !== playback) {
        return;
      }
      this.playback = undefined;
      this.clearTimers();
      this.downloads.delete(index);
      if (end.kind === "failed") {
        this.finish({ kind: "failed", error: end.error });
      } else if (end.kind === "finished" && this.state === "playing") {
        void this.playSentence(index + 1, 0);
      }
    });
  }

  private scheduleWords(index: number, words: readonly TimedWord[], startMs: number): void {
    const latency = this.player.startLatencyMs;
    for (const word of words) {
      if (word.atMs < startMs) {
        continue;
      }
      const timer = setTimeout(
        () => {
          this.listener.onWord?.({ sentence: index, start: word.start, length: word.length });
        },
        word.atMs - startMs + latency,
      );
      this.timers.push(timer);
    }
  }

  /** Moves on once the last word is spoken, cutting the silence the service adds at the end. */
  private scheduleAdvance(index: number, playback: AudioPlayback, synthesis: Synthesis, startMs: number): void {
    const end = speechEndMs(synthesis.words);
    if (end === undefined || end + SENTENCE_GAP_MS >= synthesis.durationMs) {
      return;
    }
    const timer = setTimeout(
      () => {
        if (this.playback === playback && this.state === "playing") {
          this.playback = undefined;
          this.clearTimers();
          playback.stop();
          this.downloads.delete(index);
          void this.playSentence(index + 1, 0);
        }
      },
      Math.max(0, end + SENTENCE_GAP_MS - startMs) + this.player.startLatencyMs,
    );
    this.timers.push(timer);
  }

  private prefetch(index: number): void {
    for (let ahead = index; ahead <= index + PREFETCH_AHEAD && ahead < this.sentences.length; ahead++) {
      void this.download(ahead).catch(() => {
        // Reported when that sentence is played; a later sentence failing must not stop this one.
      });
    }
  }

  private download(index: number): Promise<Synthesis> {
    let download = this.downloads.get(index);
    if (download === undefined) {
      const voice = this.options.voice ?? DEFAULT_ONLINE_VOICE;
      download = this.synth.synthesize(this.sentences[index] ?? "", voice, this.options.speed);
      this.downloads.set(index, download);
    }
    return download;
  }

  private writeAudio(index: number, audio: Uint8Array): string {
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, `${String(index)}-${String(this.generation)}.mp3`);
    writeFileSync(file, audio);
    return file;
  }

  private announceThrough(index: number): void {
    while (this.announced < index) {
      this.announced++;
      this.listener.onSentenceStart?.(this.announced);
    }
  }

  private fail(error: unknown): void {
    const cause = error instanceof Error ? error : new Error(String(error));
    this.finish({ kind: "failed", error: cause });
  }

  private stopAudio(): void {
    this.generation++;
    this.clearTimers();
    const playback = this.playback;
    this.playback = undefined;
    playback?.stop();
  }

  private clearTimers(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers = [];
  }

  private finish(end: RunEnd): void {
    if (this.state === "done") {
      return;
    }
    this.state = "done";
    this.stopAudio();
    rmSync(this.dir, { recursive: true, force: true });
    this.settleEnded(end);
  }
}

/** Speech from Edge's online neural voices, played on this computer. */
export class OnlineEngine implements SpeechEngine {
  /** The service reports every word's timing. */
  readonly capabilities: EngineCapabilities = { wordEvents: true };
  private current: OnlineRun | undefined;

  /**
   * @param synth - downloads speech; tests pass a fake
   * @param player - plays audio on this platform; tests pass a fake
   * @param beforeSpeak - called at the start of each run, for example to start a helper early
   */
  constructor(
    private readonly synth: Synthesizer,
    private readonly player: AudioPlayer,
    private readonly beforeSpeak: () => void = () => undefined,
  ) {}

  /** Lists the online voices. */
  listVoices(): Promise<readonly Voice[]> {
    return this.synth.listVoices();
  }

  /** Cancels any current run and starts reading `sentences`. */
  speak(sentences: readonly string[], options: SpeakOptions, listener: RunListener): SpeechRun {
    this.current?.cancel();
    this.beforeSpeak();
    const run = new OnlineRun(this.synth, this.player, sentences, options, listener);
    this.current = run;
    return run;
  }

  /** Stops playback and closes the connection. */
  dispose(): void {
    this.current?.cancel();
    this.current = undefined;
    this.player.dispose();
    this.synth.dispose();
  }
}

/** True when a run failed because the online voices could not be reached. */
export function isNetworkFailure(end: RunEnd): boolean {
  return end.kind === "failed" && end.error instanceof SpeechError && end.error.code === "networkFailed";
}
