/**
 * Plays audio on Windows through the PowerShell speech host, which uses Windows' own media
 * player. The host can't report when a file ends, so playback is timed from its duration.
 * Must not pass anything but a file path to the host.
 */
import { SpeechError } from "../engine";
import { spawnProcess } from "../process";
import type { Spawner } from "../process";
import { WindowsHost } from "../windows-host";
import type { HostEvent } from "../windows-protocol";
import { settleOnce } from "./audio-player";
import type { AudioPlayback, AudioPlayer, PlaybackEnd } from "./audio-player";

/** Windows player over the speech host's `play` and `stopAudio` requests. */
export class WindowsMediaPlayer implements AudioPlayer {
  /** The host is already running, so playback starts quickly. */
  readonly startLatencyMs = 150;
  private host: WindowsHost | undefined;
  private nextId = 0;
  private readonly active = new Map<number, (end: PlaybackEnd) => void>();

  /**
   * @param scriptPath - absolute path to `resources/speech-host.ps1`
   * @param spawner - starts processes; tests pass a fake
   * @param log - receives lines the host sent that could not be used
   */
  constructor(
    private readonly scriptPath: string,
    private readonly spawner: Spawner = spawnProcess,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  /** Starts the host early, so it is ready by the time the first sentence has downloaded. */
  warmUp(): void {
    this.ensureHost();
  }

  /** Plays `file`; `ended` settles after `durationMs`, on stop, or on a host error. */
  play(file: string, durationMs: number): AudioPlayback {
    const { ended, settle } = settleOnce();
    const id = ++this.nextId;
    this.active.set(id, settle);
    this.ensureHost().send({ type: "play", id, path: file });
    const timer = setTimeout(() => {
      settle({ kind: "finished" });
    }, durationMs + this.startLatencyMs);
    void ended.then(() => {
      clearTimeout(timer);
      this.active.delete(id);
    });
    return {
      ended,
      stop: () => {
        this.host?.send({ type: "stopAudio" });
        settle({ kind: "stopped" });
      },
    };
  }

  /** Stops playback and ends the host process. */
  dispose(): void {
    for (const settle of this.active.values()) {
      settle({ kind: "stopped" });
    }
    this.host?.dispose();
    this.host = undefined;
  }

  private ensureHost(): WindowsHost {
    if (this.host?.alive) {
      return this.host;
    }
    const host = new WindowsHost(this.scriptPath, this.spawner, {
      onEvent: (event) => {
        this.onEvent(event);
      },
      onProblem: this.log,
      onExit: (error) => {
        this.failAll(error);
      },
    });
    this.host = host;
    return host;
  }

  private onEvent(event: HostEvent): void {
    if (event.type === "error") {
      const settle = event.run === undefined ? undefined : this.active.get(event.run);
      if (settle) {
        settle({ kind: "failed", error: new SpeechError(event.code, event.message) });
      } else {
        this.log(`speech host: ${event.message}`);
      }
    }
  }

  private failAll(error: SpeechError): void {
    for (const settle of this.active.values()) {
      settle({ kind: "failed", error });
    }
    this.host = undefined;
  }
}
