/**
 * One running `speech-host.ps1`: spawns Windows PowerShell 5.1, writes requests to its stdin,
 * splits its stdout into lines and reports each parsed event, and reports once how it ended.
 * Must not hold run or voice state (that is the engine's job), and never puts user text in
 * the argument list: text only travels as JSON on stdin.
 */
import { StringDecoder } from "node:string_decoder";
import { SpeechError } from "./engine";
import type { SpeechProcess, Spawner } from "./process";
import { encodeRequest, parseEvent } from "./windows-protocol";
import type { HostEvent, HostRequest } from "./windows-protocol";

/** The Windows PowerShell 5.1 executable, found on PATH. */
export const POWERSHELL = "powershell.exe";

/** The host script's exit code when Constrained Language Mode blocks it. */
export const BLOCKED_EXIT_CODE = 3;

/** How long `dispose` waits for the host to quit before killing it. */
export const QUIT_GRACE_MS = 500;

const STDERR_KEEP = 2000;
const BOM = /^\uFEFF/;

/** The argument list for `powershell.exe`. `-File` with a path, never `-EncodedCommand`. */
export function hostArgs(scriptPath: string): readonly string[] {
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
}

/** What a {@link WindowsHost} reports to its owner. */
export interface HostHandlers {
  /** A valid event arrived. */
  onEvent(event: HostEvent): void;
  /** A line could not be used; the text says why. */
  onProblem(message: string): void;
  /** The host is gone, with the reason as a {@link SpeechError}. Called at most once. */
  onExit(error: SpeechError): void;
}

/** Splits a stream of text into lines, keeping a partial last line for the next chunk. */
export class LineBuffer {
  private pending = "";

  /** Adds a chunk and returns the complete lines in it, without "\r\n" or "\n". */
  push(chunk: string): string[] {
    const parts = (this.pending + chunk).split("\n");
    this.pending = parts.pop() ?? "";
    return parts.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  }
}

/** A live connection to one `speech-host.ps1` process. */
export class WindowsHost {
  private readonly child: SpeechProcess;
  private readonly lines = new LineBuffer();
  private readonly decoder = new StringDecoder("utf8");
  private stderrTail = "";
  private exited = false;
  private firstLine = true;

  /**
   * Spawns the host. Spawn failures are reported through `handlers.onExit`, not thrown.
   * @param scriptPath - absolute path to `resources/speech-host.ps1`
   * @param spawner - starts the process; tests pass a fake
   * @param handlers - receives events, problems and the exit
   */
  constructor(
    scriptPath: string,
    spawner: Spawner,
    private readonly handlers: HostHandlers,
  ) {
    this.child = spawner(POWERSHELL, hostArgs(scriptPath), {});
    this.child.on("error", (error) => {
      this.finish(spawnError(error));
    });
    this.child.on("exit", (code, signal) => {
      this.finish(exitError(code, signal, this.stderrTail));
    });
    this.child.stdin.on("error", (error: Error) => {
      // EPIPE when the host died first; the exit event carries the real reason.
      this.handlers.onProblem(`host stdin: ${error.message}`);
    });
    this.child.stdout.on("data", (chunk: Buffer | string) => {
      this.readStdout(chunk);
    });
    this.child.stderr.on("data", (chunk: Buffer | string) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-STDERR_KEEP);
    });
  }

  /** True until the process exits or fails to start. */
  get alive(): boolean {
    return !this.exited;
  }

  /** Writes one request line. Ignored once the host is gone. */
  send(request: HostRequest): void {
    if (this.exited || this.child.stdin.writableEnded) {
      return;
    }
    this.child.stdin.write(encodeRequest(request));
  }

  /** Asks the host to quit, closes stdin, and kills it if it is still running after a grace period. */
  dispose(): void {
    if (this.exited) {
      return;
    }
    this.send({ type: "quit" });
    this.child.stdin.end();
    const timer = setTimeout(() => {
      if (!this.exited) {
        this.child.kill();
      }
    }, QUIT_GRACE_MS);
    timer.unref();
  }

  private readStdout(chunk: Buffer | string): void {
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    for (const line of this.lines.push(text)) {
      this.readLine(line);
    }
  }

  private readLine(raw: string): void {
    const line = this.firstLine ? raw.replace(BOM, "") : raw;
    this.firstLine = false;
    if (line.trim() === "") {
      return;
    }
    const result = parseEvent(line);
    if (result.ok) {
      this.handlers.onEvent(result.event);
    } else {
      this.handlers.onProblem(`host output ignored: ${result.error}`);
    }
  }

  private finish(error: SpeechError): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    this.handlers.onExit(error);
  }
}

function spawnError(error: Error): SpeechError {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    return new SpeechError("toolMissing", `${POWERSHELL} was not found: ${error.message}`);
  }
  return new SpeechError("processFailed", `${POWERSHELL} could not start: ${error.message}`);
}

function exitError(code: number | null, signal: NodeJS.Signals | null, stderr: string): SpeechError {
  const detail = stderr.trim() === "" ? "" : `: ${stderr.trim()}`;
  if (code === BLOCKED_EXIT_CODE) {
    return new SpeechError("blockedByPolicy", `speech host blocked by PowerShell language mode${detail}`);
  }
  const how = signal === null ? `code ${String(code)}` : `signal ${signal}`;
  return new SpeechError("processFailed", `speech host exited with ${how}${detail}`);
}
