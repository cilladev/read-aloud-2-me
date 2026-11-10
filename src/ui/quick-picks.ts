/**
 * The voice and speed pickers. They only ask the user; saving and applying the choice is the
 * caller's job.
 */
import * as vscode from "vscode";
import type { Voice } from "../speech/engine";
import { formatSpeed } from "./status-bar";

/** Speeds offered in the speed picker. */
export const SPEED_CHOICES: readonly number[] = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

interface VoiceItem extends vscode.QuickPickItem {
  readonly voiceId: string;
}

interface SpeedItem extends vscode.QuickPickItem {
  readonly speed: number;
}

/**
 * Asks the user to pick a voice. Best-sounding voices and the current one come first.
 *
 * @param voices - installed voices
 * @param current - the current voice id, or undefined for the system default
 * @returns the chosen voice id ("" for the system default), or undefined when dismissed
 */
export async function pickVoice(voices: readonly Voice[], current: string | undefined): Promise<string | undefined> {
  const items: VoiceItem[] = [
    { label: "System voice", description: "The voice set in your computer's settings", voiceId: "" },
    ...sortVoices(voices).map((voice) => ({
      label: voice.name,
      description: [voice.language, qualityLabel(voice)].filter((part) => part !== "").join("  "),
      voiceId: voice.id,
    })),
  ];
  const active = items.find((item) => item.voiceId === (current ?? ""));
  if (active) {
    active.picked = true;
    active.detail = "Current voice";
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: "Read Aloud 2 Me: Pick Voice",
    placeHolder: "Type to filter by name or language",
    matchOnDescription: true,
  });
  return picked?.voiceId;
}

/**
 * Asks the user to pick a speed.
 *
 * @returns the chosen multiplier, or undefined when dismissed
 */
export async function pickSpeed(current: number): Promise<number | undefined> {
  const items: SpeedItem[] = SPEED_CHOICES.map((speed) => ({
    label: formatSpeed(speed),
    description: [speed === 1 ? "Normal" : "", speed === current ? "Current" : ""].filter((s) => s !== "").join(", "),
    picked: speed === current,
    speed,
  }));
  const picked = await vscode.window.showQuickPick(items, { title: "Read Aloud 2 Me: Set Speed" });
  return picked?.speed;
}

/** Orders voices: premium, then enhanced, then the rest; each group by language then name. */
export function sortVoices(voices: readonly Voice[]): Voice[] {
  const rank = { premium: 0, enhanced: 1, default: 2 } as const;
  return [...voices].sort(
    (a, b) => rank[a.quality] - rank[b.quality] || a.language.localeCompare(b.language) || a.name.localeCompare(b.name),
  );
}

function qualityLabel(voice: Voice): string {
  switch (voice.quality) {
    case "premium":
      return "Premium";
    case "enhanced":
      return "Enhanced";
    case "default":
      return "";
  }
}
