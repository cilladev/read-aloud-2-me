/**
 * The Windows speech engine: SAPI desktop voices through one persistent Windows PowerShell 5.1
 * process running `resources/speech-host.ps1`. Each sentence is one queued `SpeakAsync`, so
 * SAPI plays them back to back; pause and resume are SAPI's own.
 * Must not put user text in process arguments, and must not know about VS Code.
 */
import { SpeechError } from "./engine";
import type { EngineCapabilities, RunListener, SpeakOptions, SpeechEngine, SpeechRun, Voice } from "./engine";
import { spawnProcess } from "./process";
import type { Spawner } from "./process";
import { sapiRate } from "./rate";
import { WindowsHost } from "./windows-host";
import type { HostEvent, HostRequest, HostVoice } from "./windows-protocol";
import { WindowsRun } from "./windows-run";
import type { RunControl } from "./windows-run";

/** How long `listVoices` waits for the host before failing. Includes PowerShell start-up, which took over 10 s on a busy CI machine. */
export const VOICES_TIMEOUT_MS = 30_000;

/** Optional knobs for {@link WindowsSapiEngine}. */
export interface WindowsEngineOptions {
  /** Receives details worth logging: bad host lines, host errors, listener errors. */
  readonly log?: (message: string) => void;
  /** How long `listVoices` waits; defaults to {@link VOICES_TIMEOUT_MS}. */
  readonly voicesTimeoutMs?: number;
}

interface PendingVoices {
  readonly resolve: (voices: readonly Voice[]) => void;
  readonly reject: (error: SpeechError) => void;
  readonly timer: NodeJS.Timeout;
}

/** Maps a host voice to the shared {@link Voice} shape. */
export function toVoice(voice: HostVoice): Voice {
  return {
    id: voice.name,
    name: voice.name,
    language: voice.culture,
    quality: voice.name.includes("Natural") ? "premium" : "default",
  };
}

/** {@link SpeechEngine} for Windows, backed by System.Speech in a long-lived PowerShell host. */
export class WindowsSapiEngine implements SpeechEngine {
  /** SAPI reports word boundaries, so the editor can highlight each word. */
  readonly capabilities: EngineCapabilities = { wordEvents: true };
  private host: WindowsHost | undefined;
  private current: WindowsRun | undefined;
  private readonly voiceRequests = new Map<number, PendingVoices>();
  private nextRun = 1;
  private nextRequest = 1;
  private disposed = false;
  private readonly log: (message: string) => void;
  private readonly voicesTimeoutMs: number;

  /**
   * @param scriptPath - absolute path to `resources/speech-host.ps1`
   * @param spawner - starts processes; tests pass a fake
   * @param options - logging and timeouts; without `log`, details are dropped
   */
  constructor(
    private readonly scriptPath: string,
    private readonly spawner: Spawner = spawnProcess,
    options: WindowsEngineOptions = {},
  ) {
    this.log = options.log ?? (() => undefined);
    this.voicesTimeoutMs = options.voicesTimeoutMs ?? VOICES_TIMEOUT_MS;
  }

  /** Lists enabled SAPI voices. Rejects with {@link SpeechError} on failure or timeout. */
  listVoices(): Promise<readonly Voice[]> {
    if (this.disposed) {
      return Promise.reject(new SpeechError("processFailed", "engine is disposed"));
    }
    const id = this.nextRequest++;
    return new Promise<readonly Voice[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.voiceRequests.delete(id);
        reject(
          new SpeechError(
            "processFailed",
            `no voice list from the speech host after ${String(this.voicesTimeoutMs)} ms`,
          ),
        );
      }, this.voicesTimeoutMs);
      timer.unref();
      this.voiceRequests.set(id, { resolve, reject, timer });
      this.send({ type: "voices", id }, true);
    });
  }

  /** Cancels any current run and queues one prompt per sentence. */
  speak(sentences: readonly string[], options: SpeakOptions, listener: RunListener): SpeechRun {
    this.current?.cancel();
    const run = new WindowsRun(this.nextRun++, sentences, listener, this.control());
    if (run.isDone) {
      return run;
    }
    if (this.disposed) {
      run.fail(new SpeechError("processFailed", "engine is disposed"));
      return run;
    }
    this.current = run;
    const voice = options.voice ?? null;
    const rate = sapiRate(options.speed);
    sentences.forEach((text, index) => {
      this.send({ type: "speak", run: run.id, index, text, voice, rate }, true);
    });
    return run;
  }

  /** Cancels any run, rejects pending voice lists, and stops the host. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.current?.cancel();
    this.disposed = true;
    this.rejectVoices(new SpeechError("processFailed", "engine is disposed"));
    this.host?.dispose();
    this.host = undefined;
  }

  private control(): RunControl {
    return {
      pause: () => {
        this.send({ type: "pause" });
      },
      resume: () => {
        this.send({ type: "resume" });
      },
      cancel: (run) => {
        this.send({ type: "cancel", run });
      },
      settled: (run) => {
        if (this.current?.id === run) {
          this.current = undefined;
        }
      },
      problem: this.log,
    };
  }

  /** Sends a request. Only `start` requests may (re)start the host; control messages never do. */
  private send(request: HostRequest, start = false): void {
    const host = start ? this.ensureHost() : this.host;
    host?.send(request);
  }

  private ensureHost(): WindowsHost | undefined {
    if (this.host?.alive === true) {
      return this.host;
    }
    let host: WindowsHost;
    try {
      host = new WindowsHost(this.scriptPath, this.spawner, {
        onEvent: (event) => {
          this.onEvent(event);
        },
        onProblem: this.log,
        onExit: (error) => {
          this.onExit(error);
        },
      });
    } catch (error: unknown) {
      this.host = undefined;
      const message = error instanceof Error ? error.message : String(error);
      this.failAll(new SpeechError("processFailed", `could not start the speech host: ${message}`));
      return undefined;
    }
    // A spawn error may already have been reported synchronously; then the next use retries.
    this.host = host.alive ? host : undefined;
    return this.host;
  }

  private onEvent(event: HostEvent): void {
    switch (event.type) {
      case "ready":
        if (event.languageMode !== "FullLanguage") {
          this.failAll(new SpeechError("blockedByPolicy", `PowerShell language mode is ${event.languageMode}`));
        }
        return;
      case "voices":
        this.resolveVoices(event.id, event.voices);
        return;
      case "error":
        this.onHostError(event);
        return;
      case "sentenceStart":
      case "word":
      case "sentenceEnd":
        if (this.current?.id === event.run) {
          this.current.handle(event);
        }
        return;
      case "audioStarted":
      case "audioEnded":
        // Audio playback belongs to the online voices' player, which has its own host.
        return;
    }
  }

  private onHostError(event: Extract<HostEvent, { type: "error" }>): void {
    const error = new SpeechError(event.code, event.message);
    if (event.code === "blockedByPolicy") {
      this.failAll(error);
      return;
    }
    if (event.run !== undefined && this.current?.id === event.run) {
      const run = this.current;
      run.fail(error);
      this.send({ type: "cancel", run: run.id });
      return;
    }
    this.log(`speech host error (${event.code}): ${event.message}`);
  }

  private onExit(error: SpeechError): void {
    this.host = undefined;
    if (!this.disposed) {
      this.failAll(error);
    }
  }

  private failAll(error: SpeechError): void {
    this.current?.fail(error);
    this.rejectVoices(error);
  }

  private resolveVoices(id: number, voices: readonly HostVoice[]): void {
    const pending = this.voiceRequests.get(id);
    if (pending === undefined) {
      this.log(`voice list for unknown request ${String(id)} ignored`);
      return;
    }
    clearTimeout(pending.timer);
    this.voiceRequests.delete(id);
    pending.resolve(voices.map(toVoice));
  }

  private rejectVoices(error: SpeechError): void {
    for (const pending of this.voiceRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.voiceRequests.clear();
  }
}
