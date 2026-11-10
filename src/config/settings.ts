/**
 * Typed access to the `readAloud2Me.*` settings. The only place that names setting keys;
 * everything else asks this module. Does not cache: each read reflects the user's settings now.
 */
import * as vscode from "vscode";
import type { VoiceSource } from "../speech/switching-engine";

/** The settings section; every key below lives under it. */
export const SECTION = "readAloud2Me";

/** What to read when the user presses the shortcut with nothing selected. */
export type WithoutSelection = "cursorToEnd" | "wholeFile";

/** How much of the reading to mark in the editor. */
export type HighlightMode = "wordAndSentence" | "sentence" | "off";

/** The online voice used when none is set. */
export const DEFAULT_ONLINE_VOICE = "en-US-AvaMultilingualNeural";

/** All settings, already validated and defaulted. */
export interface Settings {
  /** Online voices or this computer's voices. */
  readonly voiceSource: VoiceSource;
  /** Online voice id, such as "en-US-AvaMultilingualNeural". */
  readonly onlineVoice: string;
  /** Computer voice id, or undefined for the system default voice. */
  readonly voice: string | undefined;
  /** Speed multiplier, 0.5 to 2. */
  readonly speed: number;
  readonly skipCodeBlocks: boolean;
  readonly withoutSelection: WithoutSelection;
  readonly openReaderOnStart: boolean;
  readonly highlight: HighlightMode;
}

/** Slowest speed the setting allows. */
export const MIN_SPEED = 0.5;
/** Fastest speed the setting allows. */
export const MAX_SPEED = 2;

/** Reads every setting, falling back to defaults for missing or invalid values. */
export function readSettings(): Settings {
  const config = vscode.workspace.getConfiguration(SECTION);
  const voice = config.get<string>("voice", "").trim();
  const onlineVoice = config.get<string>("onlineVoice", DEFAULT_ONLINE_VOICE).trim();
  return {
    voiceSource: oneOf(config.get<string>("voiceSource"), ["online", "computer"], "online"),
    onlineVoice: onlineVoice === "" ? DEFAULT_ONLINE_VOICE : onlineVoice,
    voice: voice === "" ? undefined : voice,
    speed: clampSpeed(config.get<number>("speed", 1)),
    skipCodeBlocks: config.get<boolean>("markdown.skipCodeBlocks", true),
    withoutSelection: oneOf(config.get<string>("withoutSelection"), ["cursorToEnd", "wholeFile"], "cursorToEnd"),
    openReaderOnStart: config.get<boolean>("reader.openOnStart", false),
    highlight: oneOf(config.get<string>("highlight"), ["wordAndSentence", "sentence", "off"], "wordAndSentence"),
  };
}

/**
 * Saves a voice choice in the user's global settings.
 * @param source - where the voice comes from
 * @param voice - the voice id; for the computer, an empty string means the system voice
 */
export async function saveVoice(source: VoiceSource, voice: string): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  await config.update(source === "online" ? "onlineVoice" : "voice", voice, vscode.ConfigurationTarget.Global);
  await config.update("voiceSource", source, vscode.ConfigurationTarget.Global);
}

/** Saves the speed in the user's global settings, clamped to the allowed range. */
export async function saveSpeed(speed: number): Promise<void> {
  await vscode.workspace
    .getConfiguration(SECTION)
    .update("speed", clampSpeed(speed), vscode.ConfigurationTarget.Global);
}

/** True when a configuration change touches voice or speed, which restart the sentence. */
export function affectsVoiceOrSpeed(event: vscode.ConfigurationChangeEvent): boolean {
  return ["voice", "onlineVoice", "voiceSource", "speed"].some((key) =>
    event.affectsConfiguration(`${SECTION}.${key}`),
  );
}

/** True when a configuration change touches any of this extension's settings. */
export function affectsSettings(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration(SECTION);
}

/** Clamps to {@link MIN_SPEED}..{@link MAX_SPEED}; non-numbers become 1. */
export function clampSpeed(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}
