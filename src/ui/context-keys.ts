/**
 * The one place that sets this extension's context keys. Keybindings and menus read them
 * in `when` clauses, so Escape and the player buttons only act while something is being read.
 */
import * as vscode from "vscode";
import type { SessionState } from "../session/reading-session";

/** True while reading or paused. */
export const IS_READING = "readAloud2Me.isReading";
/** True while paused. */
export const IS_PAUSED = "readAloud2Me.isPaused";

/** Mirrors the session state into the context keys. Errors go to `log`; they never throw. */
export function setReadingContext(state: SessionState, log: (message: string) => void): void {
  set(IS_READING, state !== "idle", log);
  set(IS_PAUSED, state === "paused", log);
}

function set(key: string, value: boolean, log: (message: string) => void): void {
  vscode.commands.executeCommand("setContext", key, value).then(undefined, (error: unknown) => {
    log(`Could not set context key ${key}: ${String(error)}`);
  });
}
