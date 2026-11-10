/**
 * Plays an audio file through the computer's speakers. The online engine downloads speech as
 * MP3 and hands each sentence's file to a player. Players only start and stop: pausing is done
 * by stopping and later playing the rest of the file.
 *
 * Word highlighting is timed from {@link AudioPlayback.started}, the moment sound really began,
 * so a player that is slow to open a file doesn't push the highlight ahead of the voice.
 */
import type { SpeechError } from "../engine";

/** How one playback ended. */
export type PlaybackEnd =
  | { readonly kind: "finished" }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly error: SpeechError };

/** One file playing. */
export interface AudioPlayback {
  /** Stops at once. `ended` then settles with `stopped`. Safe to call more than once. */
  stop(): void;
  /**
   * Resolves with the time (`Date.now()` clock) at which the start of the file was heard.
   * Never rejects; never resolves if playback ends before any sound.
   */
  readonly started: Promise<number>;
  /** Settles once. Never rejects. */
  readonly ended: Promise<PlaybackEnd>;
}

/** A platform's way to play an audio file. */
export interface AudioPlayer {
  /**
   * Plays `file`.
   * @param file - absolute path to an MP3 file
   * @param durationMs - the audio's length, a safety net for players that can't report the end
   */
  play(file: string, durationMs: number): AudioPlayback;
  /** Opens `file` ahead of time so a later `play(file)` starts at once. Optional. */
  prepare?(file: string): void;
  /** Stops any playback and frees helper processes. */
  dispose(): void;
}

/** The two promises of a playback, each settling once, with their resolvers. */
export interface PlaybackSignals {
  readonly started: Promise<number>;
  readonly ended: Promise<PlaybackEnd>;
  markStarted(at: number): void;
  settle(end: PlaybackEnd): void;
}

/** Builds the promises of one playback. Once ended, a late start is ignored. */
export function playbackSignals(): PlaybackSignals {
  let resolveStarted: (at: number) => void = () => undefined;
  let resolveEnded: (end: PlaybackEnd) => void = () => undefined;
  let started = false;
  let ended = false;
  return {
    started: new Promise<number>((resolve) => (resolveStarted = resolve)),
    ended: new Promise<PlaybackEnd>((resolve) => (resolveEnded = resolve)),
    markStarted: (at) => {
      if (!started && !ended) {
        started = true;
        resolveStarted(at);
      }
    },
    settle: (end) => {
      if (!ended) {
        ended = true;
        resolveEnded(end);
      }
    },
  };
}
