/**
 * Turns Markdown into the sentences a listener wants to hear. Markup is dropped, and anything
 * skipped (images, HTML, front matter, code when asked) is silent, never announced.
 * Pure: no vscode, no I/O.
 */

import type { Code, Nodes, Table, TableRow } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { BlockBuilder, type SpokenBlock } from "./builder";
import { appendInline, spanOf } from "./markdown-inline";
import { codeLineSentences } from "./plain";
import { splitSentences, wholeSentence } from "./sentences";
import type { Sentence, TextOptions } from "./types";

const FRONT_MATTER = ["yaml", "toml"] as const;

interface Walk {
  readonly source: string;
  readonly options: TextOptions;
  readonly out: Sentence[];
}

/**
 * Parses Markdown (with GFM and front matter) and returns its spoken sentences in order.
 * @param source - the Markdown text; offsets in the result are UTF-16 indexes into it.
 * @example
 * markdownToSentences("# Setup\n\nRun **npm ci**. Then test.", { skipCodeBlocks: true })
 *   .map((s) => s.text);
 * // ["Setup.", "Run npm ci.", "Then test."]
 */
export function markdownToSentences(source: string, options: TextOptions): Sentence[] {
  const tree = fromMarkdown(source, {
    extensions: [gfm(), frontmatter([...FRONT_MATTER])],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown([...FRONT_MATTER])],
  });
  const walk: Walk = { source, options, out: [] };
  walkBlock(tree, walk, false);
  return walk.out;
}

// `inItem` is true inside a list item, whose paragraphs end with a pause.
function walkChildren(nodes: readonly Nodes[], walk: Walk, inItem: boolean): void {
  for (const node of nodes) {
    walkBlock(node, walk, inItem);
  }
}

function walkBlock(node: Nodes, walk: Walk, inItem: boolean): void {
  switch (node.type) {
    case "paragraph":
      speakParagraph(node.children, walk, inItem);
      return;
    case "heading":
      speakHeading(node.children, walk);
      return;
    case "list":
    case "listItem":
      // Rule: markers, numbers and task boxes are silent; each item ends as a sentence.
      walkChildren(node.children, walk, true);
      return;
    case "table":
      speakTable(node, walk);
      return;
    case "code":
      speakCode(node, walk);
      return;
    // Rule: blockquotes read their content with no prefix; footnotes read where they are.
    case "blockquote":
    case "footnoteDefinition":
      walkChildren(node.children, walk, inItem);
      return;
    case "root":
      walkChildren(node.children, walk, inItem);
      return;
    // HTML, front matter, thematic breaks and link definitions are silent.
    case "html":
    case "yaml":
    case "thematicBreak":
    case "definition":
      return;
    // Inline and table-internal nodes are handled by their parents.
    case "break":
    case "delete":
    case "emphasis":
    case "footnoteReference":
    case "image":
    case "imageReference":
    case "inlineCode":
    case "link":
    case "linkReference":
    case "strong":
    case "tableCell":
    case "tableRow":
    case "text":
      return;
  }
}

// Rule: a paragraph is split into sentences.
function speakParagraph(children: readonly Nodes[], walk: Walk, inItem: boolean): void {
  const builder = new BlockBuilder();
  appendInline(children, walk.source, builder);
  if (inItem) {
    builder.terminate();
  }
  walk.out.push(...splitSentences(builder.build()));
}

// Rule: a heading is its own sentence and ends with a pause.
function speakHeading(children: readonly Nodes[], walk: Walk): void {
  const builder = new BlockBuilder();
  appendInline(children, walk.source, builder);
  builder.terminate();
  walk.out.push(...wholeSentence(builder.build()));
}

// Rule: code blocks are silent when skipped; otherwise each line is read as written.
function speakCode(node: Code, walk: Walk): void {
  const span = spanOf(node);
  if (walk.options.skipCodeBlocks || span === undefined) {
    return;
  }
  walk.out.push(...codeLineSentences(node.value, walk.source, span.start, span.end));
}

// Rule: one sentence per body row, "Header: cell, Header: cell." The header row is folded in.
function speakTable(node: Table, walk: Walk): void {
  const [head, ...body] = node.children;
  const headers = head === undefined ? [] : head.children.map((cell) => inlineBlock(cell.children, walk.source).text);
  for (const row of body) {
    walk.out.push(...wholeSentence(rowBlock(row, headers, walk.source)));
  }
}

function rowBlock(row: TableRow, headers: readonly string[], source: string): SpokenBlock {
  const builder = new BlockBuilder();
  row.children.forEach((cell, index) => {
    const span = spanOf(cell);
    const content = inlineBlock(cell.children, source);
    if (span === undefined || content.text.length === 0) {
      return;
    }
    if (!builder.isEmpty) {
      builder.appendSynthetic(", ", span.start, span.end);
    }
    const header = headers[index] ?? "";
    // The header is mapped to this row's cell so the highlight stays on the row being read.
    if (header.length > 0) {
      builder.appendSynthetic(`${header}: `, span.start, span.end);
    }
    builder.appendBlock(content);
  });
  builder.terminate();
  return builder.build();
}

function inlineBlock(children: readonly Nodes[], source: string): SpokenBlock {
  const builder = new BlockBuilder();
  appendInline(children, source, builder);
  return builder.build();
}
