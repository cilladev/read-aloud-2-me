/**
 * Plays audio on macOS with `afplay`, which ships with every Mac and plays MP3.
 * One `afplay` process per file; stopping kills it. Must not pass anything but a file path.
 */
import { SpeechError } from "../engine";
import { spawnProcess } from "../process";
import type { Spawner } from "../process";
import { settleOnce } from "./audio-player";
import type { AudioPlayback, AudioPlayer } from "./audio-player";

const AFPLAY = "afplay";

/** macOS player over `afplay`. */
export class MacAfplayPlayer implements AudioPlayer {
  /** `afplay` takes about a third of a second to open the audio device (measured). */
  readonly startLatencyMs = 300;

  /** @param spawner - starts processes; tests pass a fake */
  constructor(private readonly spawner: Spawner = spawnProcess) {}

  /** Starts `afplay file`; `ended` settles when the process exits. */
  play(file: string): AudioPlayback {
    const { ended, settle } = settleOnce();
    let stopped = false;
    try {
      const child = this.spawner(AFPLAY, [file], {});
      child.stdin.end();
      child.on("error", (error) => {
        const missing = "code" in error && error.code === "ENOENT";
        settle({ kind: "failed", error: new SpeechError(missing ? "toolMissing" : "processFailed", error.message) });
      });
      child.on("exit", (code, signal) => {
        if (stopped || code === 0) {
          settle(stopped ? { kind: "stopped" } : { kind: "finished" });
          return;
        }
        const how = code === null ? `stopped by ${String(signal)}` : `exited with ${String(code)}`;
        settle({ kind: "failed", error: new SpeechError("processFailed", `afplay ${how}`) });
      });
      return {
        ended,
        stop: () => {
          stopped = true;
          child.kill("SIGTERM");
          settle({ kind: "stopped" });
        },
      };
    } catch (error: unknown) {
      settle({ kind: "failed", error: new SpeechError("processFailed", `afplay: ${String(error)}`) });
      return { ended, stop: () => undefined };
    }
  }

  /** Nothing long-lived: each playback owns its own process. */
  dispose(): void {
    // Each playback is stopped by its run; no shared process to end.
  }
}
