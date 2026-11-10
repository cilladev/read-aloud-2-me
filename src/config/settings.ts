/**
 * Typed access to the `readAloud2Me.*` settings. The only place that names setting keys;
 * everything else asks this module. Does not cache: each read reflects the user's settings now.
 */
import * as vscode from "vscode";

/** The settings section; every key below lives under it. */
export const SECTION = "readAloud2Me";

/** What to read when the user presses the shortcut with nothing selected. */
export type WithoutSelection = "cursorToEnd" | "wholeFile";

/** How much of the reading to mark in the editor. */
export type HighlightMode = "wordAndSentence" | "sentence" | "off";

/** All settings, already validated and defaulted. */
export interface Settings {
  /** Voice id, or undefined for the system default voice. */
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
  return {
    voice: voice === "" ? undefined : voice,
    speed: clampSpeed(config.get<number>("speed", 1)),
    skipCodeBlocks: config.get<boolean>("markdown.skipCodeBlocks", true),
    withoutSelection: oneOf(config.get<string>("withoutSelection"), ["cursorToEnd", "wholeFile"], "cursorToEnd"),
    openReaderOnStart: config.get<boolean>("reader.openOnStart", false),
    highlight: oneOf(config.get<string>("highlight"), ["wordAndSentence", "sentence", "off"], "wordAndSentence"),
  };
}

/** Saves the voice in the user's global settings. An empty string means the system default. */
export async function saveVoice(voice: string): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update("voice", voice, vscode.ConfigurationTarget.Global);
}

/** Saves the speed in the user's global settings, clamped to the allowed range. */
export async function saveSpeed(speed: number): Promise<void> {
  await vscode.workspace
    .getConfiguration(SECTION)
    .update("speed", clampSpeed(speed), vscode.ConfigurationTarget.Global);
}

/** True when a configuration change touches voice or speed, which restart the sentence. */
export function affectsVoiceOrSpeed(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration(`${SECTION}.voice`) || event.affectsConfiguration(`${SECTION}.speed`);
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
