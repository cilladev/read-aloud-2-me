/**
 * Builds the reader panel's formatted view of a Markdown document: headings, emphasis, lists,
 * tables, quotes and code, as a small tree the webview draws with DOM calls. Each run of text
 * records which sentence it belongs to and where it sits in the source, so the reader can light
 * the sentence and word being read inside the formatting.
 * Pure: no vscode, no DOM, no HTML strings.
 */
import type { Nodes, RootContent } from "mdast";
import { parseMarkdown } from "../text/markdown";
import type { Sentence } from "../text/types";
import type { ViewElement, ViewNode, ViewTag } from "./messages";

interface Context {
  readonly source: string;
  readonly sentences: readonly Sentence[];
}

/**
 * Builds the formatted view of the blocks that hold the sentences being read.
 *
 * @param source - the whole Markdown document
 * @param sentences - the sentences being read, with document offsets, in order
 * @returns top-level view nodes; empty when there is nothing to show
 * @example
 * buildMarkdownView("# Hi\n\nOne. Two.", sentences)
 * // [{ tag: "h1", children: [...] }, { tag: "p", children: [{ text: "One.", sentence: 1, source: 6 }, ...] }]
 */
export function buildMarkdownView(source: string, sentences: readonly Sentence[]): ViewNode[] {
  const first = sentences[0];
  const last = sentences.at(-1);
  if (first === undefined || last === undefined) {
    return [];
  }
  const context: Context = { source, sentences };
  return parseMarkdown(source)
    .children.filter((block) => overlaps(block, first.sourceStart, last.sourceEnd))
    .flatMap((block) => viewOf(block, context));
}

function overlaps(node: Nodes, start: number, end: number): boolean {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  return from !== undefined && to !== undefined && from < end && to > start;
}

function viewOf(node: Nodes, context: Context): ViewNode[] {
  // TOML front matter (`+++`) is parsed but missing from mdast's types; never shown.
  if ((node.type as string) === "toml") {
    return [];
  }
  switch (node.type) {
    case "text":
      return textRuns(node.value, node, context);
    case "inlineCode":
      return [element("code", textRuns(node.value, node, context))];
    case "code":
      return [element("pre", [element("code", textRuns(node.value, node, context))])];
    case "heading":
      return [element(`h${String(node.depth)}` as ViewTag, childrenOf(node.children, context))];
    case "paragraph":
      return [element("p", childrenOf(node.children, context))];
    case "strong":
      return [element("strong", childrenOf(node.children, context))];
    case "emphasis":
      return [element("em", childrenOf(node.children, context))];
    case "delete":
      return [element("del", childrenOf(node.children, context))];
    case "link":
    case "linkReference":
      return [element("a", childrenOf(node.children, context))];
    case "blockquote":
      return [element("blockquote", childrenOf(node.children, context))];
    case "list":
      return [listElement(node.ordered === true, node.start, childrenOf(node.children, context))];
    case "listItem":
      return [element("li", [...taskBox(node.checked), ...childrenOf(node.children, context)])];
    case "table":
      return [tableElement(node.children, context)];
    case "tableRow":
    case "tableCell":
    case "root":
      return childrenOf(node.children, context);
    case "image":
    case "imageReference":
      return node.alt ? [element("span", [{ text: node.alt }], "image")] : [];
    case "footnoteReference":
      return [element("sup", [{ text: node.label ?? node.identifier }])];
    case "thematicBreak":
      return [element("hr", [])];
    case "break":
      return [element("br", [])];
    // Metadata and raw HTML are never shown; footnote text is read where it is defined, so its
    // definition is not repeated in the view.
    case "yaml":
    case "html":
    case "definition":
    case "footnoteDefinition":
      return [];
  }
}

function childrenOf(nodes: readonly RootContent[], context: Context): ViewNode[] {
  return nodes.flatMap((child) => viewOf(child, context));
}

function element(tag: ViewTag, children: ViewNode[], className?: string): ViewElement {
  return className === undefined ? { tag, children } : { tag, className, children };
}

function listElement(ordered: boolean, start: number | null | undefined, children: ViewNode[]): ViewElement {
  if (ordered && typeof start === "number" && start !== 1) {
    return { tag: "ol", start, children };
  }
  return { tag: ordered ? "ol" : "ul", children };
}

function taskBox(checked: boolean | null | undefined): ViewNode[] {
  if (checked === null || checked === undefined) {
    return [];
  }
  return [element("span", [{ text: checked ? "☑ " : "☐ " }], checked ? "task-done" : "task")];
}

function tableElement(rows: readonly Nodes[], context: Context): ViewElement {
  const [header, ...body] = rows;
  const row = (node: Nodes, cell: ViewTag): ViewElement =>
    element(
      "tr",
      "children" in node
        ? (node.children as readonly Nodes[]).map((c) =>
            element(cell, "children" in c ? childrenOf(c.children as readonly RootContent[], context) : []),
          )
        : [],
    );
  const parts: ViewNode[] = [];
  if (header !== undefined) {
    parts.push(element("thead", [row(header, "th")]));
  }
  if (body.length > 0) {
    parts.push(
      element(
        "tbody",
        body.map((node) => row(node, "td")),
      ),
    );
  }
  return element("table", parts);
}

/**
 * Splits a node's text at sentence boundaries. When the text appears verbatim in the source,
 * each run keeps its source offset, so the reader can find the spoken word inside it.
 */
function textRuns(value: string, node: Nodes, context: Context): ViewNode[] {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (value === "" || start === undefined || end === undefined) {
    return value === "" ? [] : [{ text: value }];
  }
  const at = context.source.slice(start, end).indexOf(value);
  if (at < 0) {
    const sentence = sentenceAt(context.sentences, start);
    return [sentence === undefined ? { text: value } : { text: value, sentence }];
  }
  return splitBySentence(value, start + at, context.sentences);
}

function splitBySentence(text: string, offset: number, sentences: readonly Sentence[]): ViewNode[] {
  const runs: ViewNode[] = [];
  const end = offset + text.length;
  let cursor = offset;
  sentences.forEach((sentence, index) => {
    const from = Math.max(cursor, sentence.sourceStart);
    const to = Math.min(end, sentence.sourceEnd);
    if (to <= from) {
      return;
    }
    if (from > cursor) {
      runs.push({ text: text.slice(cursor - offset, from - offset), source: cursor });
    }
    runs.push({ text: text.slice(from - offset, to - offset), sentence: index, source: from });
    cursor = to;
  });
  if (cursor < end) {
    runs.push({ text: text.slice(cursor - offset), source: cursor });
  }
  return runs;
}

function sentenceAt(sentences: readonly Sentence[], offset: number): number | undefined {
  const index = sentences.findIndex((s) => offset >= s.sourceStart && offset < s.sourceEnd);
  return index < 0 ? undefined : index;
}
