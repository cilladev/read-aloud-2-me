/**
 * The voice and speed pickers. They only ask the user; saving and applying the choice is the
 * caller's job.
 */
import * as vscode from "vscode";
import type { Voice } from "../speech/engine";
import type { VoiceSource } from "../speech/switching-engine";
import { formatSpeed } from "./status-bar";

/** Speeds offered in the speed picker. */
export const SPEED_CHOICES: readonly number[] = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

interface VoiceItem extends vscode.QuickPickItem {
  readonly choice?: VoiceChoice;
}

interface SpeedItem extends vscode.QuickPickItem {
  readonly speed: number;
}

/** A voice the user picked, and where it comes from. */
export interface VoiceChoice {
  readonly source: VoiceSource;
  /** Voice id; "" means the computer's system voice. */
  readonly voice: string;
}

/** The voices to offer, grouped by source. A group that failed to load is left out. */
export interface VoiceLists {
  readonly online: readonly Voice[];
  readonly computer: readonly Voice[];
}

/**
 * Asks the user to pick a voice: online neural voices first, then this computer's voices.
 * Voices in the user's language come first in each group.
 *
 * @param lists - the voices to offer
 * @param current - the current choice
 * @param language - VS Code's display language, such as "en" or "en-gb"
 * @returns the choice, or undefined when dismissed
 */
export async function pickVoice(
  lists: VoiceLists,
  current: VoiceChoice,
  language: string,
): Promise<VoiceChoice | undefined> {
  const items: VoiceItem[] = [];
  if (lists.online.length > 0) {
    items.push({ label: "Online voices: natural, need internet", kind: vscode.QuickPickItemKind.Separator });
    items.push(...sortByLanguage(lists.online, language).map((voice) => voiceItem("online", voice, current)));
  }
  items.push({ label: "This computer's voices: work offline", kind: vscode.QuickPickItemKind.Separator });
  items.push(
    markCurrent(
      {
        label: "System voice",
        description: "The voice set in your computer's settings",
        choice: { source: "computer", voice: "" },
      },
      current,
    ),
  );
  items.push(...sortVoices(lists.computer).map((voice) => voiceItem("computer", voice, current)));
  const picked = await vscode.window.showQuickPick(items, {
    title: "Read Aloud 2 Me: Pick Voice",
    placeHolder: "Type to filter by name or language",
    matchOnDescription: true,
  });
  return picked?.choice;
}

function voiceItem(source: VoiceSource, voice: Voice, current: VoiceChoice): VoiceItem {
  return markCurrent(
    {
      label: voice.name,
      description: [voice.language, source === "computer" ? qualityLabel(voice) : ""]
        .filter((p) => p !== "")
        .join("  "),
      choice: { source, voice: voice.id },
    },
    current,
  );
}

function markCurrent(item: VoiceItem, current: VoiceChoice): VoiceItem {
  const isCurrent = item.choice?.source === current.source && item.choice.voice === current.voice;
  return isCurrent ? { ...item, picked: true, detail: "Current voice" } : item;
}

/** Puts voices in the user's language first (exact locale, then same language), then by name. */
export function sortByLanguage(voices: readonly Voice[], language: string): Voice[] {
  const wanted = language.toLowerCase();
  const base = wanted.split("-")[0] ?? wanted;
  const rank = (voice: Voice): number => {
    const tag = voice.language.toLowerCase();
    if (tag === wanted) {
      return 0;
    }
    return tag.split("-")[0] === base ? 1 : 2;
  };
  return [...voices].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(b.name.includes("multilingual")) - Number(a.name.includes("multilingual")) ||
      a.language.localeCompare(b.language) ||
      a.name.localeCompare(b.name),
  );
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
