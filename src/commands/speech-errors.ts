/**
 * Turns a failure into one calm sentence for the user, with a button that helps, and the
 * details into the log. Never shows raw error text to the user.
 */
import * as vscode from "vscode";
import { SpeechError } from "../speech/engine";

const PICK_VOICE = "Pick Voice";
const SHOW_DETAILS = "Show Details";

/**
 * Shows a failure to the user and logs the details.
 *
 * @param error - whatever was thrown or reported
 * @param log - the extension's log channel
 */
export async function showSpeechError(error: unknown, log: vscode.LogOutputChannel): Promise<void> {
  log.error(error instanceof Error ? error : String(error));
  const { message, actions } = describe(error);
  const choice = await vscode.window.showErrorMessage(message, ...actions);
  if (choice === PICK_VOICE) {
    await vscode.commands.executeCommand("readAloud2Me.pickVoice");
  } else if (choice === SHOW_DETAILS) {
    log.show(true);
  }
}

/** The user message and buttons for an error. Exported for tests. */
export function describe(error: unknown): { message: string; actions: string[] } {
  if (!(error instanceof SpeechError)) {
    return { message: "Read Aloud 2 Me ran into a problem.", actions: [SHOW_DETAILS] };
  }
  switch (error.code) {
    case "unsupportedPlatform":
      return { message: "Read Aloud 2 Me works on macOS and Windows.", actions: [] };
    case "toolMissing":
      return { message: "The computer's speech tool could not be started.", actions: [SHOW_DETAILS] };
    case "voiceNotFound":
      return { message: "The chosen voice is not installed on this computer.", actions: [PICK_VOICE] };
    case "blockedByPolicy":
      return {
        message: "This computer's security policy blocks PowerShell, so Read Aloud 2 Me can't speak.",
        actions: [SHOW_DETAILS],
      };
    case "processFailed":
      return { message: "Reading stopped because the speech tool failed.", actions: [SHOW_DETAILS] };
  }
}
