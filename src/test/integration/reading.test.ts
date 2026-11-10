import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ReadAloud2MeApi } from "../../extension";

// Reads aloud for real, so it makes sound. Runs only with READ_ALOUD_E2E=1 on macOS or Windows:
//   READ_ALOUD_E2E=1 npm run test:integration
const ENABLED =
  process.env["READ_ALOUD_E2E"] === "1" && (process.platform === "darwin" || process.platform === "win32");

async function waitFor(check: () => boolean, what: string, timeoutMs = 20000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      assert.fail(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("reading aloud (real speech)", function () {
  this.timeout(60000);
  let api: ReadAloud2MeApi;

  before(async function () {
    if (!ENABLED) {
      this.skip();
    }
    const extension = vscode.extensions.getExtension<ReadAloud2MeApi>("cilladev.read-aloud-2-me");
    assert.ok(extension);
    api = await extension.activate();
    await vscode.workspace.getConfiguration("readAloud2Me").update("speed", 2, vscode.ConfigurationTarget.Global);
  });

  after(async () => {
    if (ENABLED) {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.workspace
        .getConfiguration("readAloud2Me")
        .update("speed", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  it("reads a Markdown selection to the end, sentence by sentence", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: "# Hello\n\nFirst **bold** sentence. Second one!\n",
      language: "markdown",
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, 3, 0);
    await vscode.commands.executeCommand("readAloud2Me.read");
    assert.equal(api.state, "reading");
    await waitFor(() => api.current === 2, "the third sentence");
    await waitFor(() => api.state === "idle", "reading to finish");
  });

  it("pauses, resumes, skips and stops", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: "One sentence here. Two sentence here. Three sentence here. Four sentence here.",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("readAloud2Me.toggle");
    assert.equal(api.state, "reading");
    await vscode.commands.executeCommand("readAloud2Me.pause");
    assert.equal(api.state, "paused");
    await vscode.commands.executeCommand("readAloud2Me.resume");
    assert.equal(api.state, "reading");
    await vscode.commands.executeCommand("readAloud2Me.next");
    assert.equal(api.current, 1);
    await vscode.commands.executeCommand("readAloud2Me.openReader");
    await waitFor(
      () => vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.label.startsWith("Reader"))),
      "the reader panel tab",
    );
    await vscode.commands.executeCommand("readAloud2Me.toggle");
    assert.equal(api.state, "idle");
  });
});
