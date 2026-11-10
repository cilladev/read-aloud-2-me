/**
 * A fake child process and spawner for speech engine tests. Nothing is spawned and nothing
 * makes sound: tests push stdout data and emit exit themselves.
 */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { SpeechProcess, Spawner } from "../../../speech/process";

/** A {@link SpeechProcess} backed by PassThrough streams; records what the engine did. */
export class FakeProcess extends EventEmitter implements SpeechProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  /** Signals sent through {@link kill}, in order. */
  readonly signals: (NodeJS.Signals | undefined)[] = [];
  /** Everything written to stdin, decoded as UTF-8. */
  stdinText = "";
  /** True once the engine ended stdin. */
  stdinEnded = false;

  constructor(
    readonly command: string,
    readonly args: readonly string[],
    readonly env: NodeJS.ProcessEnv | undefined,
  ) {
    super();
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => (this.stdinText += chunk));
    this.stdin.on("end", () => (this.stdinEnded = true));
  }

  /** Records the signal; returns true like a live process. */
  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }

  /** Writes to stdout as the program would. */
  out(text: string): void {
    this.stdout.write(text);
  }

  /** Writes to stderr as the program would. */
  err(text: string): void {
    this.stderr.write(text);
  }

  /** Emits exit after letting pending stream data flow, like a real process. */
  async exit(code: number | null, signal: NodeJS.Signals | null = null): Promise<void> {
    await flush();
    this.emit("exit", code, signal);
  }
}

/** Lets queued stream events run. */
export async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/** A spawner that returns {@link FakeProcess}es and keeps them for inspection. */
export interface FakeSpawner {
  readonly spawn: Spawner;
  readonly processes: FakeProcess[];
  /** The most recently spawned process; throws if none. */
  last(): FakeProcess;
}

/** Makes a fake spawner. Pass `onSpawn` to throw or emit errors at spawn time. */
export function fakeSpawner(onSpawn?: (process: FakeProcess) => void): FakeSpawner {
  const processes: FakeProcess[] = [];
  return {
    processes,
    spawn: (command, args, options) => {
      const child = new FakeProcess(command, args, options.env);
      processes.push(child);
      onSpawn?.(child);
      return child;
    },
    last: () => {
      const child = processes.at(-1);
      if (child === undefined) {
        throw new Error("nothing was spawned");
      }
      return child;
    },
  };
}
