import * as assert from "node:assert/strict";
import * as vscode from "vscode";

const EXTENSION_ID = "cilladev.read-aloud-2-me";

describe("extension", () => {
  it("is installed in the test instance", () => {
    assert.ok(vscode.extensions.getExtension(EXTENSION_ID), `${EXTENSION_ID} not found`);
  });

  it("activates without errors", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();
    assert.equal(extension.isActive, true);
  });
});
