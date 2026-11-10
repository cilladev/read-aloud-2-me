/**
 * The small slice of a child process the speech engines use. Engines take a {@link Spawner}
 * so unit tests can pass a fake process and never make sound.
 */
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

/** A running child process, reduced to what the engines need. */
export interface SpeechProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** Sends a signal. Returns false if the process had already exited. */
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

/** Starts a program with an argument list. Never a shell string. */
export type Spawner = (
  command: string,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv },
) => SpeechProcess;

/** The real spawner: `child_process.spawn` with `shell: false` and hidden windows on Windows. */
export const spawnProcess: Spawner = (command, args, options) =>
  spawn(command, [...args], {
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: options.env ?? process.env,
  });
