/**
 * Plays an audio file through the computer's speakers. The online engine downloads speech as
 * MP3 and hands each sentence's file to a player. Players only start and stop: pausing is done
 * by stopping and later playing the rest of the file.
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
  /** Settles once. Never rejects. */
  readonly ended: Promise<PlaybackEnd>;
}

/** A platform's way to play an audio file. */
export interface AudioPlayer {
  /** About how long after `play` the sound starts, so word timings line up with the audio. */
  readonly startLatencyMs: number;
  /**
   * Plays `file`.
   * @param file - absolute path to an MP3 file
   * @param durationMs - the audio's length, for players that can't tell when it ends
   */
  play(file: string, durationMs: number): AudioPlayback;
  /** Stops any playback and frees helper processes. */
  dispose(): void;
}

/** Builds a playback whose `ended` settles exactly once. */
export function settleOnce(): { ended: Promise<PlaybackEnd>; settle: (end: PlaybackEnd) => void } {
  let resolve: (end: PlaybackEnd) => void = () => undefined;
  let done = false;
  const ended = new Promise<PlaybackEnd>((r) => (resolve = r));
  return {
    ended,
    settle: (end) => {
      if (!done) {
        done = true;
        resolve(end);
      }
    },
  };
}
