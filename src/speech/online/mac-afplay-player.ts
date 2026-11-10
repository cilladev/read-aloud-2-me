/**
 * Plays audio on macOS with `afplay`, which ships with every Mac and plays MP3.
 * One `afplay` process per file; stopping kills it. Must not pass anything but a file path.
 */
import { SpeechError } from "../engine";
import { spawnProcess } from "../process";
import type { Spawner } from "../process";
import { playbackSignals } from "./audio-player";
import type { AudioPlayback, AudioPlayer } from "./audio-player";

const AFPLAY = "afplay";

/**
 * How long `afplay` takes from launch to sound. It can't report when sound starts, so this is
 * measured: the audio device came on about 0.35 s after launch.
 */
export const AFPLAY_START_MS = 300;

/** macOS player over `afplay`. */
export class MacAfplayPlayer implements AudioPlayer {
  /** @param spawner - starts processes; tests pass a fake */
  constructor(private readonly spawner: Spawner = spawnProcess) {}

  /** Starts `afplay file`; `ended` settles when the process exits. */
  play(file: string): AudioPlayback {
    const signals = playbackSignals();
    const launchedAt = Date.now();
    const startTimer = setTimeout(() => {
      signals.markStarted(launchedAt + AFPLAY_START_MS);
    }, AFPLAY_START_MS);
    void signals.ended.then(() => {
      clearTimeout(startTimer);
    });
    let stopped = false;
    try {
      const child = this.spawner(AFPLAY, [file], {});
      child.stdin.end();
      child.on("error", (error) => {
        const missing = "code" in error && error.code === "ENOENT";
        signals.settle({
          kind: "failed",
          error: new SpeechError(missing ? "toolMissing" : "processFailed", error.message),
        });
      });
      child.on("exit", (code, signal) => {
        if (stopped || code === 0) {
          signals.settle(stopped ? { kind: "stopped" } : { kind: "finished" });
          return;
        }
        const how = code === null ? `stopped by ${String(signal)}` : `exited with ${String(code)}`;
        signals.settle({ kind: "failed", error: new SpeechError("processFailed", `afplay ${how}`) });
      });
      return {
        started: signals.started,
        ended: signals.ended,
        stop: () => {
          stopped = true;
          child.kill("SIGTERM");
          signals.settle({ kind: "stopped" });
        },
      };
    } catch (error: unknown) {
      signals.settle({ kind: "failed", error: new SpeechError("processFailed", `afplay: ${String(error)}`) });
      return { started: signals.started, ended: signals.ended, stop: () => undefined };
    }
  }

  /** Nothing long-lived: each playback owns its own process. */
  dispose(): void {
    // Each playback is stopped by its run; no shared process to end.
  }
}
