/**
 * Plays audio on Windows through the PowerShell speech host, which uses Windows' own media
 * player. The host reports when sound really starts and ends, so the highlight follows the
 * voice even when opening a file is slow. Files can be opened ahead with {@link prepare}, so
 * the next sentence starts at once. Must not pass anything but file paths to the host.
 */
import { SpeechError } from "../engine";
import { spawnProcess } from "../process";
import type { Spawner } from "../process";
import { WindowsHost } from "../windows-host";
import type { HostEvent } from "../windows-protocol";
import { playbackSignals } from "./audio-player";
import type { AudioPlayback, AudioPlayer, PlaybackSignals } from "./audio-player";

/** If the host never says sound started, assume it did after this long, so reading goes on. */
export const START_TIMEOUT_MS = 4000;

/** Extra time after a file's length before assuming it ended, if the host never says. */
export const END_GRACE_MS = 3000;

/** Windows player over the speech host's `load`, `play` and `stopAudio` requests. */
export class WindowsMediaPlayer implements AudioPlayer {
  private host: WindowsHost | undefined;
  private nextId = 0;
  /** Files opened ahead, by path, with the id the host knows them by. */
  private readonly prepared = new Map<string, number>();
  private readonly active = new Map<number, PlaybackSignals>();

  /**
   * @param scriptPath - absolute path to `resources/speech-host.ps1`
   * @param spawner - starts processes; tests pass a fake
   * @param log - receives anything worth logging
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

  /** Opens `file` in the host now, so `play(file)` later starts without a delay. */
  prepare(file: string): void {
    const host = this.ensureHost();
    if (this.prepared.has(file)) {
      return;
    }
    const id = ++this.nextId;
    this.prepared.set(file, id);
    host.send({ type: "load", id, path: file });
  }

  /** Plays `file`. Word timing follows the host's report of when sound began. */
  play(file: string, durationMs: number): AudioPlayback {
    const host = this.ensureHost();
    const id = this.prepared.get(file) ?? ++this.nextId;
    this.prepared.delete(file);
    const signals = playbackSignals();
    this.active.set(id, signals);
    host.send({ type: "play", id, path: file });
    this.watchdog(id, signals, durationMs);
    void signals.ended.then(() => this.active.delete(id));
    return {
      started: signals.started,
      ended: signals.ended,
      stop: () => {
        this.host?.send({ type: "stopAudio", id });
        signals.settle({ kind: "stopped" });
      },
    };
  }

  /** Stops playback, forgets prepared files and ends the host process. */
  dispose(): void {
    for (const signals of this.active.values()) {
      signals.settle({ kind: "stopped" });
    }
    this.prepared.clear();
    this.host?.dispose();
    this.host = undefined;
  }

  /** Keeps reading going if the host goes quiet: assume a start, then an end, and log it. */
  private watchdog(id: number, signals: PlaybackSignals, durationMs: number): void {
    const startTimer = setTimeout(() => {
      this.log(`audio ${String(id)}: no start reported after ${String(START_TIMEOUT_MS)} ms`);
      signals.markStarted(Date.now());
    }, START_TIMEOUT_MS);
    let endTimer: NodeJS.Timeout | undefined;
    void signals.started.then(() => {
      clearTimeout(startTimer);
      endTimer = setTimeout(() => {
        this.log(`audio ${String(id)}: no end reported`);
        signals.settle({ kind: "finished" });
      }, durationMs + END_GRACE_MS);
    });
    void signals.ended.then(() => {
      clearTimeout(startTimer);
      clearTimeout(endTimer);
    });
  }

  private ensureHost(): WindowsHost {
    if (this.host?.alive) {
      return this.host;
    }
    this.prepared.clear();
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
    switch (event.type) {
      case "audioStarted":
        this.active.get(event.id)?.markStarted(Date.now() - event.positionMs);
        return;
      case "audioEnded":
        this.active.get(event.id)?.settle({ kind: "finished" });
        return;
      case "error": {
        const signals = event.run === undefined ? undefined : this.active.get(event.run);
        if (signals) {
          signals.settle({ kind: "failed", error: new SpeechError(event.code, event.message) });
        } else {
          this.log(`speech host: ${event.message}`);
        }
        return;
      }
      case "ready":
      case "voices":
      case "sentenceStart":
      case "word":
      case "sentenceEnd":
        return;
    }
  }

  private failAll(error: SpeechError): void {
    for (const signals of this.active.values()) {
      signals.settle({ kind: "failed", error });
    }
    this.prepared.clear();
    this.host = undefined;
  }
}
