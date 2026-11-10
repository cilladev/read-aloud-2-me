/**
 * Lists macOS voices by running `say -v ?` and parsing its output.
 * It must not speak, and it must not pass anything but a fixed argument list to `say`.
 */
import { SpeechError } from "./engine";
import type { Voice, VoiceQuality } from "./engine";
import type { SpeechProcess, Spawner } from "./process";

// `Name<spaces>xx_YY<spaces># sample`. Names may hold spaces and parentheses.
const VOICE_LINE = /^(.+?)\s+([a-z]{2,3}_[A-Za-z0-9]+)\s+#\s?(.*)$/;

function qualityOf(name: string): VoiceQuality {
  if (name.includes("(Premium)")) {
    return "premium";
  }
  return name.includes("(Enhanced)") ? "enhanced" : "default";
}

function parseLine(line: string): Voice | undefined {
  const match = VOICE_LINE.exec(line.trim());
  const name = match?.[1]?.trim();
  const locale = match?.[2];
  if (name === undefined || name === "" || locale === undefined) {
    return undefined;
  }
  return { id: name, name, language: locale.replace("_", "-"), quality: qualityOf(name) };
}

/** Parses `say -v ?` output into voices, skipping lines that do not match. */
export function parseSayVoiceList(output: string): Voice[] {
  const voices: Voice[] = [];
  for (const line of output.split(/\r?\n/)) {
    const voice = parseLine(line);
    if (voice !== undefined) {
      voices.push(voice);
    }
  }
  return voices;
}

function collect(child: SpeechProcess): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

function toSpeechError(error: unknown): SpeechError {
  if (error instanceof SpeechError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
  return new SpeechError(missing ? "toolMissing" : "processFailed", `say -v ?: ${message}`);
}

/** Runs `say -v ?` and returns the installed voices. Rejects with {@link SpeechError}. */
export async function listMacVoices(spawner: Spawner): Promise<Voice[]> {
  try {
    const child = spawner("say", ["-v", "?"], {});
    child.stdin.on("error", () => undefined);
    child.stdin.end();
    const result = await collect(child);
    if (result.code !== 0) {
      throw new SpeechError("processFailed", `say -v ? exited with ${String(result.code)}: ${result.stderr.trim()}`);
    }
    return parseSayVoiceList(result.stdout);
  } catch (error: unknown) {
    throw toSpeechError(error);
  }
}
