import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { ReaderPanel } from "../../reader/reader-panel";

const EXTENSION_ID = "cilladev.read-aloud-2-me";

/** In-memory stand-in for globalState. */
class FakeMemento implements vscode.Memento {
  private readonly values = new Map<string, unknown>();

  keys(): readonly string[] {
    return [...this.values.keys()];
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
  }

  update(key: string, value: unknown): Thenable<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

function readerTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => tab.label.startsWith("Reader"));
}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("reader panel", () => {
  let panel: ReaderPanel | undefined;

  afterEach(() => {
    panel?.dispose();
    panel = undefined;
  });

  it("opens beside the editor, takes content, and closes on dispose", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} not found`);
    const logs: string[] = [];
    panel = new ReaderPanel(
      extension.extensionUri,
      new FakeMemento(),
      "Select text and press Cmd+' to read it here.",
      (m) => logs.push(m),
    );

    panel.show();
    assert.equal(panel.isOpen, true);
    await waitFor(() => readerTabs().length === 1);

    panel.setDocument("/tmp/notes.md", [
      { text: "First sentence.", paragraphStart: true },
      { text: "Second one.", paragraphStart: false },
      { text: "New paragraph.", paragraphStart: true },
    ]);
    await waitFor(() => readerTabs().some((tab) => tab.label === "Reader: notes.md"));

    panel.setProgress(0, { start: 0, length: 5 });
    panel.setProgress(2);
    panel.setProgress(99);
    panel.clear();
    panel.show();
    assert.equal(readerTabs().length, 1, "show() reuses the open panel");

    panel.dispose();
    panel = undefined;
    await waitFor(() => readerTabs().length === 0);
    assert.deepEqual(
      logs.filter((m) => m.startsWith("Could not")),
      [],
    );
  });

  it("opens again after the user closes it", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    panel = new ReaderPanel(extension.extensionUri, new FakeMemento(), "hint");
    panel.show();
    await waitFor(() => readerTabs().length === 1);

    await vscode.window.tabGroups.close(readerTabs());
    await waitFor(() => !panel!.isOpen);

    panel.show();
    assert.equal(panel.isOpen, true);
    await waitFor(() => readerTabs().length === 1);
  });
});
