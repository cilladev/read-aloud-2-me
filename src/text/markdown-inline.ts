/**
 * Speaks Markdown inline content (text, emphasis, links, inline code) into a BlockBuilder.
 * Markers are dropped and skipped content is silent, never announced. Pure: no vscode, no I/O.
 */

import type { InlineCode, Link, Nodes, Text } from "mdast";
import { alignValue, type Segment } from "./align";
import type { BlockBuilder } from "./builder";

/** A node's source range in UTF-16 offsets. */
export interface NodeSpan {
  readonly start: number;
  readonly end: number;
}

// `:smile:` style shortcodes: silent, because a listener gains nothing from hearing "smile".
const SHORTCODE = /(?<![\p{L}\p{N}]):[a-z0-9_+-]+:(?![\p{L}\p{N}])/gu;
const URL_LABEL = /^(?:https?:\/\/|www\.)\S+$/i;

/** Returns the node's source range, or undefined for a generated node without a position. */
export function spanOf(node: Nodes): NodeSpan | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
}

/**
 * Appends the spoken form of inline nodes to `builder`.
 * @param nodes - phrasing children of a paragraph, heading or table cell.
 * @param source - the whole Markdown source, for exact offsets.
 */
export function appendInline(nodes: readonly Nodes[], source: string, builder: BlockBuilder): void {
  for (const node of nodes) {
    appendInlineNode(node, source, builder);
  }
}

function appendInlineNode(node: Nodes, source: string, builder: BlockBuilder): void {
  switch (node.type) {
    case "text":
      appendText(node, source, builder);
      return;
    case "inlineCode":
      appendInlineCode(node, source, builder);
      return;
    case "break":
      builder.space();
      return;
    case "link":
      appendLink(node, source, builder);
      return;
    // Emphasis, strong, delete and link references: read the children, drop the markers.
    case "emphasis":
    case "strong":
    case "delete":
    case "linkReference":
      appendInline(node.children, source, builder);
      return;
    // Images, raw HTML and footnote markers are silent.
    case "image":
    case "imageReference":
    case "footnoteReference":
    case "html":
      return;
    // Block nodes never appear inside phrasing content.
    case "blockquote":
    case "code":
    case "definition":
    case "footnoteDefinition":
    case "heading":
    case "list":
    case "listItem":
    case "paragraph":
    case "root":
    case "table":
    case "tableCell":
    case "tableRow":
    case "thematicBreak":
    case "yaml":
      return;
  }
}

// Rule: text is read as written; escapes and entities map back through alignment.
function appendText(node: Text, source: string, builder: BlockBuilder): void {
  const span = spanOf(node);
  if (span === undefined) {
    return;
  }
  const segments = alignValue(node.value, source, span.start, span.end) ?? [wholeNode(node.value, span)];
  emitSegments(segments, shortcodeSpans(node.value), builder);
}

// Rule: inline code is read as its content, mapped inside the backticks.
function appendInlineCode(node: InlineCode, source: string, builder: BlockBuilder): void {
  const span = spanOf(node);
  if (span === undefined) {
    return;
  }
  const fence = /^`+/.exec(source.slice(span.start, span.end))?.[0].length ?? 0;
  const segments = alignValue(node.value, source, span.start + fence, span.end - fence) ?? [
    wholeNode(node.value, span),
  ];
  emitSegments(segments, [], builder);
}

// Rule: a link reads its label. A label that is itself a URL reads as its domain only.
function appendLink(node: Link, source: string, builder: BlockBuilder): void {
  const span = spanOf(node);
  const label = plainLabel(node);
  if (span !== undefined && URL_LABEL.test(label)) {
    builder.appendSynthetic(domainOf(label), span.start, span.end);
    return;
  }
  appendInline(node.children, source, builder);
}

/**
 * Returns the host of a URL without its scheme and "www.".
 * @example
 * domainOf("https://www.github.com/foo/bar"); // "github.com"
 */
export function domainOf(url: string): string {
  const host = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  return host.split(/[/?#:]/)[0] ?? host;
}

function plainLabel(node: Nodes): string {
  if ("value" in node) {
    return node.value;
  }
  return "children" in node ? node.children.map(plainLabel).join("") : "";
}

function wholeNode(value: string, span: NodeSpan): Segment {
  return { kind: "synthetic", valueStart: 0, text: value, sourceStart: span.start, sourceEnd: span.end };
}

function shortcodeSpans(value: string): NodeSpan[] {
  return Array.from(value.matchAll(SHORTCODE), (match) => ({ start: match.index, end: match.index + match[0].length }));
}

function emitSegments(segments: readonly Segment[], removed: readonly NodeSpan[], builder: BlockBuilder): void {
  for (const segment of segments) {
    switch (segment.kind) {
      case "space":
        builder.space();
        break;
      case "synthetic":
        builder.appendSynthetic(segment.text.replace(SHORTCODE, ""), segment.sourceStart, segment.sourceEnd);
        break;
      case "verbatim":
        emitVerbatim(segment, removed, builder);
        break;
    }
  }
}

// Appends a verbatim segment minus any shortcodes inside it, keeping exact offsets.
function emitVerbatim(segment: Segment, removed: readonly NodeSpan[], builder: BlockBuilder): void {
  let cursor = segment.valueStart;
  const end = segment.valueStart + segment.text.length;
  for (const cut of removed) {
    if (cut.end <= cursor || cut.start >= end) {
      continue;
    }
    appendSlice(segment, cursor, Math.max(cursor, cut.start), builder);
    cursor = Math.min(end, cut.end);
  }
  appendSlice(segment, cursor, end, builder);
}

function appendSlice(segment: Segment, from: number, to: number, builder: BlockBuilder): void {
  if (to > from) {
    const offset = from - segment.valueStart;
    builder.appendVerbatim(segment.text.slice(offset, to - segment.valueStart), segment.sourceStart + offset);
  }
}
