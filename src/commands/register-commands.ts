/**
 * Registers every command with VS Code. Each handler is one line that calls the controller,
 * so this file is the map from command id to behaviour.
 */
import * as vscode from "vscode";
import type { ReadingController } from "./reading-controller";
import { showSpeechError } from "./speech-errors";

/** Command ids, as contributed in package.json. */
export const COMMANDS = {
  toggle: "readAloud2Me.toggle",
  read: "readAloud2Me.read",
  stop: "readAloud2Me.stop",
  togglePause: "readAloud2Me.togglePause",
  pause: "readAloud2Me.pause",
  resume: "readAloud2Me.resume",
  next: "readAloud2Me.next",
  previous: "readAloud2Me.previous",
  pickVoice: "readAloud2Me.pickVoice",
  setSpeed: "readAloud2Me.setSpeed",
  openReader: "readAloud2Me.openReader",
} as const;

/**
 * Registers the commands. Every handler is guarded: an unexpected failure is logged and shown
 * as one plain message, never as a raw system error, and never leaves a command half done.
 *
 * @param controller - does the work
 * @param log - the extension's log channel
 * @returns disposables for `context.subscriptions`
 */
export function registerCommands(controller: ReadingController, log: vscode.LogOutputChannel): vscode.Disposable[] {
  const register = (id: string, handler: () => unknown): vscode.Disposable =>
    vscode.commands.registerCommand(id, async () => {
      try {
        await handler();
      } catch (error: unknown) {
        log.error(`${id} failed`);
        await showSpeechError(error, log);
      }
    });
  return [
    register(COMMANDS.toggle, () => controller.toggle()),
    register(COMMANDS.read, () => controller.read()),
    register(COMMANDS.stop, () => {
      controller.stop();
    }),
    register(COMMANDS.togglePause, () => {
      controller.togglePause();
    }),
    register(COMMANDS.pause, () => {
      controller.pause();
    }),
    register(COMMANDS.resume, () => {
      controller.resume();
    }),
    register(COMMANDS.next, () => {
      controller.next();
    }),
    register(COMMANDS.previous, () => {
      controller.previous();
    }),
    register(COMMANDS.pickVoice, () => controller.pickVoice()),
    register(COMMANDS.setSpeed, () => controller.setSpeed()),
    register(COMMANDS.openReader, () => {
      controller.openReader();
    }),
  ];
}
