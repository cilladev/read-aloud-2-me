/**
 * Fetches speech from Microsoft Edge's online neural voices (the service behind Edge's own
 * "Read aloud") through the `msedge-tts` package. This is the only code that sends text off
 * the computer: the sentence being read goes to Microsoft, nothing else does.
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { SpeechError } from "../engine";
import type { Voice } from "../engine";
import { escapeXml, ssmlRate } from "./edge-text";
import type { WordBoundary } from "./edge-text";
import { mp3DurationMs } from "./mp3";

/** One sentence of downloaded speech. */
export interface Synthesis {
  readonly audio: Uint8Array;
  readonly durationMs: number;
  readonly words: readonly WordBoundary[];
}

/** Turns text into speech audio. The engine depends on this, so tests can fake it. */
export interface Synthesizer {
  /** Downloads one sentence. Rejects with a `networkFailed` {@link SpeechError}. */
  synthesize(text: string, voice: string, speed: number): Promise<Synthesis>;
  /** Lists the online voices. */
  listVoices(): Promise<readonly Voice[]>;
  /** Closes the connection. */
  dispose(): void;
}

/** The default online voice: natural, and reads many languages. */
export const DEFAULT_ONLINE_VOICE = "en-US-AvaMultilingualNeural";

const SYNTHESIS_TIMEOUT_MS = 20_000;

/** {@link Synthesizer} over Edge's online voices. One connection per voice, reused. */
export class EdgeSynthesizer implements Synthesizer {
  private client: MsEdgeTTS | undefined;
  private clientVoice: string | undefined;
  private ready: Promise<void> | undefined;

  /** Downloads one sentence with word timings. */
  async synthesize(text: string, voice: string, speed: number): Promise<Synthesis> {
    try {
      const client = await this.connect(voice);
      const { audioStream, metadataStream } = client.toStream(escapeXml(text), { rate: ssmlRate(speed) });
      const words: WordBoundary[] = [];
      metadataStream?.on("data", (chunk: Buffer) => {
        words.push(...parseBoundaries(chunk.toString("utf8")));
      });
      const audio = await readAll(audioStream);
      if (audio.length === 0) {
        throw new Error("the online voice returned no audio");
      }
      return { audio, durationMs: mp3DurationMs(audio), words };
    } catch (error: unknown) {
      this.reset();
      throw networkError(error);
    }
  }

  /** Lists the online voices from the service. */
  async listVoices(): Promise<readonly Voice[]> {
    try {
      const voices = await new MsEdgeTTS().getVoices();
      return voices.map((voice) => ({
        id: voice.ShortName,
        name: onlineVoiceName(voice.ShortName),
        language: voice.Locale,
        quality: "premium" as const,
      }));
    } catch (error: unknown) {
      throw networkError(error);
    }
  }

  /** Closes the connection. */
  dispose(): void {
    this.reset();
  }

  private async connect(voice: string): Promise<MsEdgeTTS> {
    if (this.client === undefined || this.clientVoice !== voice || this.ready === undefined) {
      this.reset();
      const client = new MsEdgeTTS({ synthesisTimeoutMs: SYNTHESIS_TIMEOUT_MS });
      this.client = client;
      this.clientVoice = voice;
      this.ready = client.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
        wordBoundaryEnabled: true,
      });
    }
    await this.ready;
    return this.client;
  }

  private reset(): void {
    this.client?.close();
    this.client = undefined;
    this.clientVoice = undefined;
    this.ready = undefined;
  }
}

/**
 * A readable name for an online voice id.
 * @example
 * onlineVoiceName("en-US-AvaMultilingualNeural"); // "Ava (multilingual)"
 */
export function onlineVoiceName(id: string): string {
  const base = id
    .split("-")
    .slice(2)
    .join("-")
    .replace(/Neural$/, "");
  const multilingual = base.endsWith("Multilingual");
  const name = base.replace(/Multilingual$/, "");
  return multilingual ? `${name} (multilingual)` : name;
}

/** Reads word boundaries out of one metadata message. Ignores anything else. */
export function parseBoundaries(message: string): WordBoundary[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    // Not every metadata message is JSON; those carry nothing we use.
    return [];
  }
  const items = isRecord(parsed) && Array.isArray(parsed["Metadata"]) ? parsed["Metadata"] : [];
  const words: WordBoundary[] = [];
  for (const item of items) {
    const data = isRecord(item) && item["Type"] === "WordBoundary" ? item["Data"] : undefined;
    const text = isRecord(data) && isRecord(data["text"]) ? data["text"]["Text"] : undefined;
    const offset = isRecord(data) ? data["Offset"] : undefined;
    const duration = isRecord(data) ? data["Duration"] : undefined;
    if (typeof text === "string" && typeof offset === "number") {
      words.push(
        typeof duration === "number"
          ? { atMs: offset / 10_000, text, durationMs: duration / 10_000 }
          : { atMs: offset / 10_000, text },
      );
    }
  }
  return words;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAll(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    stream.on("error", reject);
  });
}

function networkError(error: unknown): SpeechError {
  if (error instanceof SpeechError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new SpeechError("networkFailed", `Online voices: ${message}`);
}
