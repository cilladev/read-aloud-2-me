/**
 * The JSON-lines protocol between the Windows engine and `resources/speech-host.ps1`.
 * One JSON object per line, UTF-8 without BOM, both directions. Incoming lines are validated
 * here and never throw: anything malformed comes back as a parse error for the caller to log.
 * Must not spawn processes or know about engine state.
 */

/** A voice as the host reports it. */
export interface HostVoice {
  readonly name: string;
  readonly culture: string;
  readonly gender: string;
}

/** Messages the engine sends to the host. */
export type HostRequest =
  | { readonly type: "voices"; readonly id: number }
  | {
      readonly type: "speak";
      readonly run: number;
      readonly index: number;
      readonly text: string;
      readonly voice: string | null;
      readonly rate: number;
    }
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "cancel"; readonly run: number }
  | { readonly type: "play"; readonly id: number; readonly path: string }
  | { readonly type: "stopAudio" }
  | { readonly type: "quit" };

/** Error codes the host can report. */
export type HostErrorCode = "voiceNotFound" | "blockedByPolicy" | "processFailed";

/** Messages the host sends to the engine. */
export type HostEvent =
  | { readonly type: "ready"; readonly languageMode: string }
  | { readonly type: "voices"; readonly id: number; readonly voices: readonly HostVoice[] }
  | { readonly type: "sentenceStart"; readonly run: number; readonly index: number }
  | {
      readonly type: "word";
      readonly run: number;
      readonly index: number;
      readonly start: number;
      readonly length: number;
    }
  | { readonly type: "sentenceEnd"; readonly run: number; readonly index: number }
  | {
      readonly type: "error";
      readonly code: HostErrorCode;
      readonly message: string;
      readonly run: number | undefined;
    };

/** The result of parsing one line from the host. */
export type ParseResult =
  { readonly ok: true; readonly event: HostEvent } | { readonly ok: false; readonly error: string };

const ERROR_CODES: readonly string[] = ["voiceNotFound", "blockedByPolicy", "processFailed"];

/** Turns a request into one line (with trailing "\n") for the host's stdin. */
export function encodeRequest(request: HostRequest): string {
  return `${JSON.stringify(request)}\n`;
}

/** Parses and validates one line from the host. Never throws. */
export function parseEvent(line: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error: unknown) {
    return fail(`not JSON: ${errorText(error)}`);
  }
  if (!isRecord(value)) {
    return fail("not a JSON object");
  }
  const event = toEvent(value);
  return event === undefined ? fail(`unknown or malformed message: ${truncate(line)}`) : { ok: true, event };
}

function toEvent(value: Readonly<Record<string, unknown>>): HostEvent | undefined {
  switch (value["type"]) {
    case "ready":
      return typeof value["languageMode"] === "string"
        ? { type: "ready", languageMode: value["languageMode"] }
        : undefined;
    case "voices":
      return toVoices(value);
    case "sentenceStart":
    case "sentenceEnd":
      return toSentence(value["type"], value);
    case "word":
      return toWord(value);
    case "error":
      return toError(value);
    default:
      return undefined;
  }
}

function toVoices(value: Readonly<Record<string, unknown>>): HostEvent | undefined {
  const id = value["id"];
  // ConvertTo-Json in PowerShell 5.1 writes a one-item array as a bare object, and none as null.
  const raw = value["voices"];
  const list: unknown[] = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
  if (!isCount(id)) {
    return undefined;
  }
  const voices: HostVoice[] = [];
  for (const item of list) {
    const voice = toVoice(item);
    if (voice === undefined) {
      return undefined;
    }
    voices.push(voice);
  }
  return { type: "voices", id, voices };
}

function toVoice(item: unknown): HostVoice | undefined {
  if (!isRecord(item) || typeof item["name"] !== "string") {
    return undefined;
  }
  const culture = typeof item["culture"] === "string" ? item["culture"] : "";
  const gender = typeof item["gender"] === "string" ? item["gender"] : "";
  return { name: item["name"], culture, gender };
}

function toSentence(
  type: "sentenceStart" | "sentenceEnd",
  value: Readonly<Record<string, unknown>>,
): HostEvent | undefined {
  const run = value["run"];
  const index = value["index"];
  return isCount(run) && isCount(index) ? { type, run, index } : undefined;
}

function toWord(value: Readonly<Record<string, unknown>>): HostEvent | undefined {
  const { run, index, start, length } = value;
  if (isCount(run) && isCount(index) && isCount(start) && isCount(length)) {
    return { type: "word", run, index, start, length };
  }
  return undefined;
}

function toError(value: Readonly<Record<string, unknown>>): HostEvent | undefined {
  const code = value["code"];
  const message = value["message"];
  const run = value["run"];
  if (!isErrorCode(code) || typeof message !== "string") {
    return undefined;
  }
  if (run !== undefined && run !== null && !isCount(run)) {
    return undefined;
  }
  return { type: "error", code, message, run: isCount(run) ? run : undefined };
}

function isErrorCode(value: unknown): value is HostErrorCode {
  return typeof value === "string" && ERROR_CODES.includes(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function fail(error: string): ParseResult {
  return { ok: false, error };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(line: string): string {
  return line.length > 200 ? `${line.slice(0, 200)}...` : line;
}
