/**
 * The macOS speech engine: one `say -i` process per run (or per resume), text on stdin,
 * word events parsed from its interactive output.
 * It must not pass text in arguments, use a shell, or import vscode.
 *
 * `SIGSTOP` does not pause `say` audio, so pause kills the process and remembers the
 * current word; resume starts a new process from that word (plan D10).
 */
import { SpeechError } from "./engine";
import type { EngineCapabilities, RunEnd, RunListener, SpeakOptions, SpeechEngine, SpeechRun, Voice } from "./engine";
import { listMacVoices } from "./mac-voices";
import { spawnProcess } from "./process";
import type { SpeechProcess, Spawner } from "./process";
import { sayWordsPerMinute } from "./rate";
import { SayFrameParser } from "./say-frame-parser";
import { buildSayLine, mapLineWord } from "./say-line";
import type { SayLine, SentencePosition } from "./say-line";

const SAY = "say";
const VOICE_NOT_FOUND = /voice\b.*\bnot found/i;

/** Arguments for `say`: interactive output, optional voice, rate, text from stdin. */
export function sayArgs(options: SpeakOptions): string[] {
  const voice = options.voice !== undefined && options.voice !== "" ? ["-v", options.voice] : [];
  return ["-i", ...voice, "-r", String(sayWordsPerMinute(options.speed)), "-f", "-"];
}

/** `say -i` refuses to run without TERM, which VS Code's extension host may not have. */
function sayEnv(): NodeJS.ProcessEnv {
  return { ...process.env, TERM: process.env["TERM"] ?? "xterm-256color" };
}

function spawnError(error: Error): SpeechError {
  const missing = "code" in error && error.code === "ENOENT";
  return new SpeechError(missing ? "toolMissing" : "processFailed", `say: ${error.message}`);
}

function exitError(code: number | null, signal: NodeJS.Signals | null, stderr: string): SpeechError {
  const details = stderr.trim();
  if (VOICE_NOT_FOUND.test(details)) {
    return new SpeechError("voiceNotFound", details);
  }
  const how = code === null ? `was stopped by ${String(signal)}` : `exited with ${String(code)}`;
  return new SpeechError("processFailed", `say ${how}${details === "" ? "" : `: ${details}`}`);
}

type RunState = "playing" | "paused" | "done";

/** One run of sentences. Owns at most one live `say` process at a time. */
class MacSayRun implements SpeechRun {
  readonly ended: Promise<RunEnd>;
  private resolveEnded: (end: RunEnd) => void = () => undefined;
  private state: RunState = "playing";
  private child: SpeechProcess | undefined;
  private position: SentencePosition = { sentence: 0, offset: 0 };
  private announced = -1;

  constructor(
    private readonly spawner: Spawner,
    private readonly sentences: readonly string[],
    private readonly options: SpeakOptions,
    private readonly listener: RunListener,
  ) {
    this.ended = new Promise((resolve) => {
      this.resolveEnded = resolve;
    });
    this.start();
  }

  pause(): void {
    if (this.state !== "playing") {
      return;
    }
    this.state = "paused";
    this.stopChild();
  }

  resume(): void {
    if (this.state !== "paused") {
      return;
    }
    this.state = "playing";
    this.start();
  }

  cancel(): void {
    this.stopChild();
    this.settle({ kind: "cancelled" });
  }

  /** Speaks from {@link position} to the end with a fresh process. */
  private start(): void {
    const line = buildSayLine(this.sentences, this.position);
    if (line.segments.length === 0) {
      this.settle({ kind: "finished" });
      return;
    }
    let child: SpeechProcess;
    try {
      child = this.spawner(SAY, sayArgs(this.options), { env: sayEnv() });
    } catch (error: unknown) {
      const cause = error instanceof Error ? error : new Error(String(error));
      this.settle({ kind: "failed", error: spawnError(cause) });
      return;
    }
    this.child = child;
    this.watch(child, line);
    // EPIPE when `say` dies before reading stdin; the exit or error event reports the cause.
    child.stdin.on("error", () => undefined);
    child.stdin.end(line.text, "utf8");
  }

  private watch(child: SpeechProcess, line: SayLine): void {
    const parser = new SayFrameParser();
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      for (const word of parser.push(chunk)) {
        if (this.child === child) {
          this.onLineWord(line, word.start, word.length);
        }
      }
    });
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => {
      if (this.child === child) {
        this.settle({ kind: "failed", error: spawnError(error) });
      }
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) {
        return;
      }
      const end: RunEnd =
        code === 0 ? { kind: "finished" } : { kind: "failed", error: exitError(code, signal, stderr) };
      this.settle(end);
    });
  }

  private onLineWord(line: SayLine, start: number, length: number): void {
    const word = mapLineWord(line, start, length);
    if (word === undefined) {
      return;
    }
    this.announceThrough(word.sentence);
    this.position = { sentence: word.sentence, offset: word.start };
    this.listener.onWord?.(word);
  }

  /** Fires onSentenceStart for every sentence up to `index` not yet announced, in order. */
  private announceThrough(index: number): void {
    while (this.announced < index) {
      this.announced++;
      this.listener.onSentenceStart?.(this.announced);
    }
  }

  private stopChild(): void {
    const child = this.child;
    this.child = undefined;
    child?.kill("SIGTERM");
  }

  private settle(end: RunEnd): void {
    if (this.state === "done") {
      return;
    }
    this.state = "done";
    this.child = undefined;
    this.resolveEnded(end);
  }
}

/** macOS engine over `say`. Word events come from `say -i`. */
export class MacSayEngine implements SpeechEngine {
  /** `say -i` reports every word. */
  readonly capabilities: EngineCapabilities = { wordEvents: true };
  private current: MacSayRun | undefined;

  /** @param spawner - starts processes; tests pass a fake so nothing makes sound */
  constructor(private readonly spawner: Spawner = spawnProcess) {}

  /** Lists voices from `say -v ?`. */
  listVoices(): Promise<readonly Voice[]> {
    return listMacVoices(this.spawner);
  }

  /** Cancels any current run and starts reading `sentences` from the first. */
  speak(sentences: readonly string[], options: SpeakOptions, listener: RunListener): SpeechRun {
    this.current?.cancel();
    const run = new MacSayRun(this.spawner, sentences, options, listener);
    this.current = run;
    return run;
  }

  /** Cancels the active run, which kills its `say` process. */
  dispose(): void {
    this.current?.cancel();
    this.current = undefined;
  }
}
