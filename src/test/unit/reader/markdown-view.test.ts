import * as assert from "node:assert/strict";
import type { ViewElement, ViewNode, ViewText } from "../../../reader/messages";
import { buildMarkdownView } from "../../../reader/markdown-view";
import { toSentences } from "../../../text/prepare";

function view(source: string, selection?: [number, number]): ViewNode[] {
  const [start, end] = selection ?? [0, source.length];
  const sentences = toSentences(source.slice(start, end), "markdown", { skipCodeBlocks: true }, start);
  return buildMarkdownView(source, sentences);
}

function isText(node: ViewNode): node is ViewText {
  return "text" in node;
}

/** Every text run in document order. */
function texts(nodes: readonly ViewNode[]): ViewText[] {
  return nodes.flatMap((node) => (isText(node) ? [node] : texts(node.children)));
}

/** Tags in document order, depth first. */
function tags(nodes: readonly ViewNode[]): string[] {
  return nodes.flatMap((node) => (isText(node) ? [] : [node.tag, ...tags(node.children)]));
}

describe("buildMarkdownView", () => {
  it("keeps the formatting: headings, emphasis, code, links, lists and quotes", () => {
    const source =
      "# Title\n\nSome **bold** and *em* with `code` and [a link](https://x.com).\n\n- one\n- two\n\n> quoted\n";
    assert.deepEqual(tags(view(source)), [
      "h1",
      "p",
      "strong",
      "em",
      "code",
      "a",
      "ul",
      "li",
      "p",
      "li",
      "p",
      "blockquote",
      "p",
    ]);
  });

  it("splits a sentence across formatting, every run tagged with its sentence and source offset", () => {
    const source = "First **bold** part. Second one.";
    const runs = texts(view(source)).filter((run) => run.text.trim() !== "");
    assert.deepEqual(
      runs.map((run) => [run.text, run.sentence]),
      [
        ["First ", 0],
        ["bold", 0],
        [" part.", 0],
        ["Second one.", 1],
      ],
    );
    for (const run of runs) {
      assert.equal(source.slice(run.source ?? -1, (run.source ?? -1) + run.text.length), run.text);
    }
  });

  it("shows code blocks and tables without making skipped code readable", () => {
    const source = "Intro.\n\n```js\nlet a = 1;\n```\n\n| H | I |\n| - | - |\n| a | b |\n";
    const nodes = view(source);
    assert.ok(tags(nodes).includes("pre"));
    assert.deepEqual(
      tags(nodes).filter((t) => ["table", "thead", "tbody", "th", "td"].includes(t)),
      ["table", "thead", "th", "th", "tbody", "td", "td"],
    );
    const code = texts(nodes).find((run) => run.text.includes("let a"));
    assert.equal(code?.sentence, undefined, "skipped code is shown but not a sentence");
  });

  it("leaves out front matter and raw HTML, keeps image alt text and task boxes", () => {
    const source = "---\ntitle: x\n---\n\nIntro.\n\n<div>raw</div>\n\n![a cat](cat.png)\n\n- [x] done\n- [ ] todo\n";
    const nodes = view(source);
    const all = texts(nodes)
      .map((run) => run.text)
      .join("|");
    assert.ok(!all.includes("title: x"));
    assert.ok(!all.includes("raw"));
    assert.ok(all.includes("a cat"));
    assert.ok(all.includes("☑") && all.includes("☐"));
    const image = nodes.filter((node): node is ViewElement => !isText(node) && node.tag === "p")[1];
    assert.equal((image?.children[0] as ViewElement | undefined)?.className, "image");
  });

  it("keeps an ordered list's start number", () => {
    const list = view("3. three\n4. four\n")[0] as ViewElement;
    assert.equal(list.tag, "ol");
    assert.equal(list.start, 3);
  });

  it("shows only the blocks the selection touches", () => {
    const source = "# One\n\nFirst para.\n\nSecond para.\n\nThird para.";
    const start = source.indexOf("Second");
    const nodes = view(source, [start, start + "Second para.".length]);
    assert.deepEqual(
      texts(nodes).map((run) => run.text),
      ["Second para."],
    );
  });

  it("returns nothing for nothing to read", () => {
    assert.deepEqual(buildMarkdownView("# Hi", []), []);
  });
});
