/**
 * A scripted stand-in for `speech-host.ps1` for unit tests. It reads the JSON lines the engine
 * writes to stdin and answers like the real host: ready, voices, and per sentence
 * sentenceStart, word events and sentenceEnd. It never spawns a process or makes sound.
 */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { SpeechProcess, Spawner } from "../../../speech/process";

/** A request as the fake host received it. */
export type ReceivedRequest = Readonly<Record<string, unknown>> & { readonly type: string };

/** How a fake host behaves. */
export interface FakeHostOptions {
  /** Send `ready` on start. Default true. */
  readonly ready?: boolean;
  /** Language mode reported in `ready`. Default "FullLanguage". */
  readonly languageMode?: string;
  /** Voices returned for a voices request; undefined means never answer. */
  readonly voices?: readonly { name: string; culture: string; gender: string }[] | undefined;
  /** "auto" plays each sentence at once; "manual" leaves it to the test. Default "auto". */
  readonly speech?: "auto" | "manual";
  /** Voice names the host knows; others get voiceNotFound. Default: any. */
  readonly knownVoices?: readonly string[];
  /** Fail to start with this errno code, like a missing executable. */
  readonly spawnErrorCode?: string;
}

/** One fake host process. */
export class FakeWindowsHost extends EventEmitter implements SpeechProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: ReceivedRequest[] = [];
  readonly signals: (NodeJS.Signals | undefined)[] = [];
  stdinEnded = false;
  private buffer = "";
  private exited = false;

  constructor(
    readonly command: string,
    readonly args: readonly string[],
    private readonly options: FakeHostOptions,
  ) {
    super();
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => {
      this.read(chunk);
    });
    this.stdin.on("end", () => {
      this.stdinEnded = true;
    });
    setImmediate(() => {
      this.start();
    });
  }

  /** Records the signal and exits with it. */
  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (this.exited) {
      return false;
    }
    this.exit(null, signal ?? "SIGTERM");
    return true;
  }

  /** Writes one event object as a JSON line. */
  emitEvent(event: Readonly<Record<string, unknown>>): void {
    this.stdout.write(`${JSON.stringify(event)}\n`);
  }

  /** Writes raw text to stdout, for split-chunk and bad-line tests. */
  emitRaw(text: string): void {
    this.stdout.write(text);
  }

  /** Ends the process with an exit code or signal. */
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    this.emit("exit", code, signal);
  }

  /** Plays sentence `index` of `run`: start, one word event per word, end. */
  playSentence(run: number, index: number, text: string): void {
    this.emitEvent({ type: "sentenceStart", run, index });
    for (const match of text.matchAll(/\S+/g)) {
      this.emitEvent({ type: "word", run, index, start: match.index, length: match[0].length });
    }
    this.emitEvent({ type: "sentenceEnd", run, index });
  }

  /** The requests of one type. */
  requestsOf(type: string): ReceivedRequest[] {
    return this.requests.filter((request) => request.type === type);
  }

  private start(): void {
    if (this.options.spawnErrorCode !== undefined) {
      const error: NodeJS.ErrnoException = new Error(`spawn ${this.command} ${this.options.spawnErrorCode}`);
      error.code = this.options.spawnErrorCode;
      this.exited = true;
      this.emit("error", error);
      return;
    }
    if (this.options.ready ?? true) {
      this.emitEvent({ type: "ready", languageMode: this.options.languageMode ?? "FullLanguage" });
    }
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const request = JSON.parse(line) as ReceivedRequest;
      this.requests.push(request);
      this.answer(request);
    }
  }

  private answer(request: ReceivedRequest): void {
    // A process that never started cannot answer, even before its error event fires.
    if (this.exited || this.options.spawnErrorCode !== undefined) {
      return;
    }
    if (request.type === "voices" && this.options.voices !== undefined) {
      this.emitEvent({ type: "voices", id: request["id"], voices: this.options.voices });
    }
    if (request.type === "speak") {
      this.speak(request);
    }
    if (request.type === "quit") {
      this.exit(0);
    }
  }

  private speak(request: ReceivedRequest): void {
    const run = request["run"] as number;
    const voice = request["voice"];
    const known = this.options.knownVoices;
    if (typeof voice === "string" && known !== undefined && !known.includes(voice)) {
      this.emitEvent({ type: "error", code: "voiceNotFound", message: `no voice ${voice}`, run });
      return;
    }
    if ((this.options.speech ?? "auto") === "auto") {
      this.playSentence(run, request["index"] as number, request["text"] as string);
    }
  }
}

/** A spawner that hands out fake hosts and remembers them in order. */
export interface FakeHostSpawner {
  readonly spawn: Spawner;
  readonly hosts: FakeWindowsHost[];
  /** The most recent host. Throws when none was spawned. */
  last(): FakeWindowsHost;
}

/** Makes a spawner whose hosts use `options`, or `perSpawn[n]` for the nth spawn when given. */
export function fakeHostSpawner(
  options: FakeHostOptions = {},
  perSpawn: readonly FakeHostOptions[] = [],
): FakeHostSpawner {
  const hosts: FakeWindowsHost[] = [];
  return {
    hosts,
    spawn: (command, args) => {
      const host = new FakeWindowsHost(command, args, perSpawn[hosts.length] ?? options);
      hosts.push(host);
      return host;
    },
    last: () => {
      const host = hosts.at(-1);
      if (host === undefined) {
        throw new Error("no host spawned");
      }
      return host;
    },
  };
}

/** Lets pending stream and timer callbacks run. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
