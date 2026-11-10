import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = "cilladev.read-aloud-2-me";

interface Manifest {
  contributes: { commands: { command: string }[] };
}

describe("commands", () => {
  before(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
  });

  it("registers every command in package.json", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const manifest = JSON.parse(readFileSync(join(extension.extensionPath, "package.json"), "utf8")) as Manifest;
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const { command } of manifest.contributes.commands) {
      assert.ok(registered.has(command), `${command} is not registered`);
    }
  });

  it("stop, pause and navigation are safe when nothing is being read", async () => {
    for (const command of [
      "readAloud2Me.stop",
      "readAloud2Me.togglePause",
      "readAloud2Me.pause",
      "readAloud2Me.resume",
      "readAloud2Me.next",
      "readAloud2Me.previous",
    ]) {
      await vscode.commands.executeCommand(command);
    }
  });

  it("does not start reading an empty document", async () => {
    const document = await vscode.workspace.openTextDocument({ content: "", language: "markdown" });
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("readAloud2Me.read");
    await vscode.commands.executeCommand("readAloud2Me.stop");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });
});
