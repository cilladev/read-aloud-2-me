/**
 * Reading from VS Code's Markdown preview. The preview belongs to the built-in Markdown
 * extension, so its selection is reached by running the copy command and reading the clipboard.
 * The user's clipboard text is put back afterwards.
 */
import * as vscode from "vscode";
import type { Settings } from "../config/settings";
import { requestFromDocument, requestFromText } from "./read-request";
import type { ReadRequest } from "./read-request";

const PREVIEW_VIEW_TYPE = "markdown.preview";
const COPY_WAIT_MS = 600;
const COPY_POLL_MS = 30;

/** True when the focused tab is a Markdown preview. */
export function isMarkdownPreviewActive(): boolean {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputWebview && input.viewType.endsWith(PREVIEW_VIEW_TYPE);
}

/**
 * Builds a request from the active Markdown preview: its selection if there is one, otherwise
 * its source file from the top. The source is marked in the editor only if it is already open.
 *
 * @returns undefined when there is neither a selection nor a source file to read
 */
export async function requestFromPreview(settings: Settings): Promise<ReadRequest | undefined> {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const selected = await copyPreviewSelection();
  if (selected.trim() !== "") {
    return requestFromText(tab?.label ?? "Markdown preview", selected);
  }
  const source = tab ? findSourceDocument(tab.label) : undefined;
  return source ? requestFromDocument(source, settings) : undefined;
}

/** Copies the preview's selection and restores the clipboard. Returns "" when nothing is selected. */
async function copyPreviewSelection(): Promise<string> {
  const saved = await vscode.env.clipboard.readText();
  const sentinel = `readAloud2Me:${String(Date.now())}:${String(Math.random())}`;
  await vscode.env.clipboard.writeText(sentinel);
  try {
    await vscode.commands.executeCommand("editor.action.clipboardCopyAction");
    const copied = await waitForClipboardChange(sentinel);
    return copied ?? "";
  } finally {
    await vscode.env.clipboard.writeText(saved);
  }
}

/** Polls the clipboard until it no longer holds `sentinel`, or the wait runs out. */
async function waitForClipboardChange(sentinel: string): Promise<string | undefined> {
  for (let waited = 0; waited < COPY_WAIT_MS; waited += COPY_POLL_MS) {
    const text = await vscode.env.clipboard.readText();
    if (text !== sentinel) {
      return text;
    }
    await new Promise((resolve) => setTimeout(resolve, COPY_POLL_MS));
  }
  return undefined;
}

/** Finds the open Markdown document a preview tab shows, from labels like "Preview README.md". */
function findSourceDocument(label: string): vscode.TextDocument | undefined {
  const name = label.replace(/^\[?Preview\]?\s+/, "").trim();
  return vscode.workspace.textDocuments.find(
    (document) => document.languageId === "markdown" && document.uri.path.endsWith(`/${name}`),
  );
}
