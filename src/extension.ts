import * as vscode from "vscode";
import { readSettings } from "./config/settings";
import { ReadingController } from "./commands/reading-controller";
import { registerCommands } from "./commands/register-commands";
import { ReaderPanel } from "./reader/reader-panel";
import type { SessionState } from "./session/reading-session";
import { createEngine } from "./speech/create-engine";

/** What `activate` returns. Read-only; used by integration tests to watch reading. */
export interface ReadAloud2MeApi {
  /** Whether anything is being read right now. */
  readonly state: SessionState;
  /** The current sentence, 0-based. */
  readonly current: number;
}

/**
 * Entry point. Builds the speech engine, reader panel and controller, and registers the
 * commands; holds no logic of its own. Everything goes into `context.subscriptions`, so VS Code
 * disposes it, which also stops any speech process.
 */
export function activate(context: vscode.ExtensionContext): ReadAloud2MeApi {
  const log = vscode.window.createOutputChannel("Read Aloud 2 Me", { log: true });
  let onFallback: (error: Error) => void = () => undefined;
  const engine = createEngine(
    process.platform,
    vscode.Uri.joinPath(context.extensionUri, "resources").fsPath,
    {
      source: () => readSettings().voiceSource,
      computerVoice: () => readSettings().voice,
      onFallback: (error) => {
        onFallback(error);
      },
    },
    (message) => {
      log.warn(message);
    },
  );
  const shortcut = process.platform === "darwin" ? "Cmd+'" : "Ctrl+'";
  const reader = new ReaderPanel(
    context.extensionUri,
    context.globalState,
    `Select text and press ${shortcut} to read it here.`,
    (message) => {
      log.warn(message);
    },
  );
  const controller = new ReadingController(engine, reader, log);
  onFallback = (error) => {
    controller.notifyFallback(error);
  };
  const api: ReadAloud2MeApi = {
    get state() {
      return controller.state;
    },
    get current() {
      return controller.current;
    },
  };
  context.subscriptions.push(
    log,
    {
      dispose: () => {
        engine.dispose();
      },
    },
    reader,
    controller,
    ...registerCommands(controller),
  );
  return api;
}

/** Nothing to clean up by hand: every disposable lives in `context.subscriptions`. */
export function deactivate(): void {
  // Intentionally empty.
}
