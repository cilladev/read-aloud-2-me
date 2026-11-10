/**
 * Status bar items shown while reading: a speaker with "3 of 12" (click stops), the speed and
 * the voice (click to change). Hidden when idle. Holds no reading logic.
 */
import * as vscode from "vscode";
import type { SessionState } from "../session/reading-session";

/** What the status bar shows. */
export interface StatusView {
  readonly state: SessionState;
  /** 0-based current sentence. */
  readonly current: number;
  readonly total: number;
  readonly speed: number;
  /** Voice name to show, or undefined for the system default. */
  readonly voice: string | undefined;
  /** The sentence being read, shown in the tooltip. */
  readonly sentence: string | undefined;
}

/** The three reading items in the status bar. */
export class ReadingStatusBar implements vscode.Disposable {
  private readonly progress: vscode.StatusBarItem;
  private readonly speed: vscode.StatusBarItem;
  private readonly voice: vscode.StatusBarItem;

  constructor() {
    this.progress = vscode.window.createStatusBarItem("readAloud2Me.progress", vscode.StatusBarAlignment.Right, 1000);
    this.progress.name = "Read Aloud 2 Me";
    this.progress.command = "readAloud2Me.stop";
    this.speed = vscode.window.createStatusBarItem("readAloud2Me.speed", vscode.StatusBarAlignment.Right, 999);
    this.speed.name = "Read Aloud 2 Me: Speed";
    this.speed.command = "readAloud2Me.setSpeed";
    this.speed.tooltip = "Change reading speed";
    this.voice = vscode.window.createStatusBarItem("readAloud2Me.voice", vscode.StatusBarAlignment.Right, 998);
    this.voice.name = "Read Aloud 2 Me: Voice";
    this.voice.command = "readAloud2Me.pickVoice";
    this.voice.tooltip = "Change voice";
  }

  /** Shows the items for a reading state, or hides them when idle. */
  update(view: StatusView): void {
    if (view.state === "idle") {
      this.hide();
      return;
    }
    const icon = view.state === "paused" ? "$(debug-pause)" : "$(unmute)";
    this.progress.text = `${icon} ${String(view.current + 1)} of ${String(view.total)}`;
    const action = view.state === "paused" ? "Paused. Click to stop reading." : "Click to stop reading.";
    this.progress.tooltip = view.sentence === undefined ? action : `${view.sentence}\n\n${action}`;
    this.speed.text = formatSpeed(view.speed);
    this.voice.text = `$(person) ${view.voice ?? "System voice"}`;
    this.progress.show();
    this.speed.show();
    this.voice.show();
  }

  /** Hides every item. */
  hide(): void {
    this.progress.hide();
    this.speed.hide();
    this.voice.hide();
  }

  dispose(): void {
    this.progress.dispose();
    this.speed.dispose();
    this.voice.dispose();
  }
}

/** Formats a speed multiplier for display, for example `1.25x`. */
export function formatSpeed(speed: number): string {
  return `${String(Math.round(speed * 100) / 100)}x`;
}
