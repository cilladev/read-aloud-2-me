// @ts-check
/**
 * Reader panel webview script. Draws what the host sends, either the formatted Markdown view or
 * plain sentences, lights the sentence and word being read, and reports clicks and text size
 * changes back. The host owns all state; this only draws it.
 * Must not use innerHTML, load anything remote, or trust message shapes blindly: elements are
 * built with createElement from a fixed list of tags, and text only ever goes in textContent.
 */

/**
 * @typedef {{ text: string, paragraphStart: boolean }} ReaderSentence
 * @typedef {{ start: number, length: number }} WordRange
 * @typedef {{ start: number, end: number }} SourceSpan
 * @typedef {{ tag: string, className?: string, start?: number, children: ViewNode[] }} ViewElement
 * @typedef {{ text: string, sentence?: number, source?: number }} ViewText
 * @typedef {ViewElement | ViewText} ViewNode
 * @typedef {{ type: "render", title: string, sentences: ReaderSentence[], current: number, fontSize: number, emptyHint: string, markdown?: ViewNode[] }} RenderMessage
 * @typedef {{ type: "progress", current: number, word?: WordRange, wordSource?: SourceSpan }} ProgressMessage
 * @typedef {{ type: "fontSize", value: number }} FontSizeMessage
 * @typedef {RenderMessage | ProgressMessage | FontSizeMessage} HostToWebview
 * @typedef {{ type: "ready" } | { type: "jumpTo", index: number } | { type: "fontSize", value: number }} WebviewToHost
 * @typedef {{ fontSize?: number }} SavedState
 * @typedef {{ postMessage(message: WebviewToHost): void, getState(): SavedState | undefined, setState(state: SavedState): void }} VsCodeApi
 * @typedef {{ element: HTMLElement, text: string, source: number | undefined }} Run
 */

(function () {
  const MIN_FONT_SIZE = 12;
  const MAX_FONT_SIZE = 32;
  const FONT_SIZE_STEP = 2;
  const DEFAULT_FONT_SIZE = 16;
  const ALLOWED_TAGS = new Set([
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "strong",
    "em",
    "del",
    "code",
    "pre",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "hr",
    "br",
    "sup",
    "span",
  ]);
  const ALLOWED_CLASSES = new Set(["image", "task", "task-done"]);

  /** @type {VsCodeApi} */
  const vscode = acquireVsCodeApi();

  /** The text runs of each sentence, in order. A sentence may span several runs (bold, links). */
  /** @type {Run[][]} */
  let runs = [];
  /** True when showing the formatted Markdown view, where words are found by source offset. */
  let formatted = false;
  let current = -1;
  let fontSize = DEFAULT_FONT_SIZE;

  const toolbar = document.createElement("header");
  toolbar.className = "toolbar";
  const titleEl = document.createElement("span");
  titleEl.className = "title";
  const smaller = makeButton("A−", "Smaller text");
  const larger = makeButton("A+", "Larger text");
  toolbar.append(titleEl, smaller, larger);

  const content = document.createElement("main");
  content.className = "content";
  content.setAttribute("aria-live", "off");
  document.body.append(toolbar, content);

  /**
   * @param {string} label
   * @param {string} ariaLabel
   * @returns {HTMLButtonElement}
   */
  function makeButton(label, ariaLabel) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "size";
    button.textContent = label;
    button.setAttribute("aria-label", ariaLabel);
    button.title = ariaLabel;
    return button;
  }

  /** @param {number} value */
  function applyFontSize(value) {
    fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)));
    document.documentElement.style.setProperty("--reader-font-size", `${fontSize}px`);
    smaller.disabled = fontSize <= MIN_FONT_SIZE;
    larger.disabled = fontSize >= MAX_FONT_SIZE;
    vscode.setState({ fontSize });
  }

  /** @param {number} delta */
  function changeFontSize(delta) {
    const before = fontSize;
    applyFontSize(fontSize + delta);
    if (fontSize !== before) {
      vscode.postMessage({ type: "fontSize", value: fontSize });
    }
  }

  /** @param {RenderMessage} message */
  function render(message) {
    titleEl.textContent = message.title;
    applyFontSize(message.fontSize);
    runs = message.sentences.map(() => []);
    current = -1;
    formatted = Array.isArray(message.markdown) && message.markdown.length > 0;
    content.classList.toggle("markdown", formatted);
    if (message.sentences.length === 0) {
      content.replaceChildren(emptyState(message.emptyHint));
    } else if (formatted && message.markdown) {
      const fragment = document.createDocumentFragment();
      message.markdown.forEach((node) => appendNode(fragment, node));
      content.replaceChildren(fragment);
    } else {
      content.replaceChildren(buildParagraphs(message.sentences));
    }
    setCurrent(message.current, undefined, undefined);
  }

  /**
   * @param {string} hint
   * @returns {HTMLElement}
   */
  function emptyState(hint) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = hint;
    return p;
  }

  /**
   * Plain view: one paragraph per group of sentences, one run per sentence.
   * @param {ReaderSentence[]} sentences
   * @returns {DocumentFragment}
   */
  function buildParagraphs(sentences) {
    const fragment = document.createDocumentFragment();
    /** @type {HTMLParagraphElement | undefined} */
    let paragraph;
    sentences.forEach((sentence, index) => {
      if (!paragraph || sentence.paragraphStart) {
        paragraph = document.createElement("p");
        fragment.append(paragraph);
      } else {
        paragraph.append(" ");
      }
      paragraph.append(makeRun(sentence.text, index, undefined));
    });
    return fragment;
  }

  /**
   * Formatted view: draws one node of the Markdown tree under `parent`.
   * @param {Node} parent
   * @param {unknown} node
   */
  function appendNode(parent, node) {
    if (typeof node !== "object" || node === null) {
      return;
    }
    if ("text" in node && typeof node.text === "string") {
      const sentence = "sentence" in node && Number.isInteger(node.sentence) ? Number(node.sentence) : undefined;
      const source = "source" in node && Number.isInteger(node.source) ? Number(node.source) : undefined;
      parent.appendChild(
        sentence !== undefined && sentence >= 0 && sentence < runs.length
          ? makeRun(node.text, sentence, source)
          : document.createTextNode(node.text),
      );
      return;
    }
    if (!("tag" in node) || typeof node.tag !== "string" || !ALLOWED_TAGS.has(node.tag)) {
      return;
    }
    const element = document.createElement(node.tag);
    if ("className" in node && typeof node.className === "string" && ALLOWED_CLASSES.has(node.className)) {
      element.className = node.className;
    }
    if (element instanceof HTMLOListElement && "start" in node && Number.isInteger(node.start)) {
      element.start = Number(node.start);
    }
    if ("children" in node && Array.isArray(node.children)) {
      node.children.forEach((child) => appendNode(element, child));
    }
    parent.appendChild(element);
  }

  /**
   * One run of sentence text, clickable to read from that sentence.
   * @param {string} text
   * @param {number} index
   * @param {number | undefined} source
   * @returns {HTMLElement}
   */
  function makeRun(text, index, source) {
    const span = document.createElement("span");
    span.className = "s";
    span.textContent = text;
    span.dataset["index"] = String(index);
    span.setAttribute("role", "button");
    span.tabIndex = 0;
    runs[index]?.push({ element: span, text, source });
    return span;
  }

  /**
   * Moves the lit sentence, touching only runs whose state changes, then marks the word.
   * @param {number} next
   * @param {WordRange | undefined} word
   * @param {SourceSpan | undefined} wordSource
   */
  function setCurrent(next, word, wordSource) {
    const target = Number.isInteger(next) && next >= 0 && next < runs.length ? next : -1;
    if (target !== current) {
      unlight(current);
      markDone(current, target);
      current = target;
      light(current);
    }
    if (formatted) {
      showWordBySource(wordSource);
    } else {
      showWordByOffset(word);
    }
  }

  /** @param {number} index */
  function unlight(index) {
    for (const run of runs[index] ?? []) {
      run.element.classList.remove("now");
      run.element.removeAttribute("aria-current");
      run.element.textContent = run.text;
    }
  }

  /** @param {number} index */
  function light(index) {
    const sentenceRuns = runs[index] ?? [];
    for (const run of sentenceRuns) {
      run.element.classList.add("now");
      run.element.setAttribute("aria-current", "true");
    }
    const first = sentenceRuns[0];
    if (first) {
      scrollIntoViewIfNeeded(first.element);
    }
  }

  /**
   * @param {number} from
   * @param {number} to
   */
  function markDone(from, to) {
    if (to < 0) {
      runs.forEach((sentenceRuns) => sentenceRuns.forEach((run) => run.element.classList.remove("done")));
      return;
    }
    const low = Math.max(0, Math.min(from, to));
    const high = Math.max(from, to);
    for (let i = low; i <= high; i++) {
      for (const run of runs[i] ?? []) {
        run.element.classList.toggle("done", i < to);
      }
    }
  }

  /**
   * Plain view: the word is an offset into the sentence's single run.
   * @param {WordRange | undefined} word
   */
  function showWordByOffset(word) {
    const run = runs[current]?.[0];
    if (!run) {
      return;
    }
    const valid =
      word &&
      Number.isInteger(word.start) &&
      Number.isInteger(word.length) &&
      word.start >= 0 &&
      word.length > 0 &&
      word.start + word.length <= run.text.length;
    markRun(run, valid && word ? word.start : -1, valid && word ? word.start + word.length : -1);
  }

  /**
   * Formatted view: the word is a source range; mark it inside whichever runs it falls in.
   * @param {SourceSpan | undefined} span
   */
  function showWordBySource(span) {
    const valid = span && Number.isInteger(span.start) && Number.isInteger(span.end) && span.end > span.start;
    for (const run of runs[current] ?? []) {
      if (!valid || !span || run.source === undefined) {
        markRun(run, -1, -1);
        continue;
      }
      const from = Math.max(span.start, run.source) - run.source;
      const to = Math.min(span.end, run.source + run.text.length) - run.source;
      markRun(run, from, to);
    }
  }

  /**
   * Shows `run` with text[from, to) in a <mark>, or plain when the range is empty.
   * @param {Run} run
   * @param {number} from
   * @param {number} to
   */
  function markRun(run, from, to) {
    if (from < 0 || to <= from) {
      run.element.textContent = run.text;
      return;
    }
    const mark = document.createElement("mark");
    mark.textContent = run.text.slice(from, to);
    run.element.replaceChildren(run.text.slice(0, from), mark, run.text.slice(to));
  }

  /** @param {HTMLElement} element */
  function scrollIntoViewIfNeeded(element) {
    const box = element.getBoundingClientRect();
    const top = toolbar.getBoundingClientRect().bottom;
    if (box.top >= top && box.bottom <= window.innerHeight) {
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }

  /**
   * @param {EventTarget | null} target
   * @returns {number | undefined}
   */
  function sentenceIndex(target) {
    if (!(target instanceof Element)) {
      return undefined;
    }
    const span = target.closest(".s");
    const index = span instanceof HTMLElement ? Number(span.dataset["index"]) : NaN;
    return Number.isInteger(index) ? index : undefined;
  }

  /** @param {EventTarget | null} target */
  function jumpTo(target) {
    const index = sentenceIndex(target);
    if (index !== undefined) {
      vscode.postMessage({ type: "jumpTo", index });
    }
  }

  /**
   * @param {unknown} data
   * @returns {data is HostToWebview}
   */
  function isHostMessage(data) {
    return typeof data === "object" && data !== null && "type" in data;
  }

  /** @param {HostToWebview} message */
  function handle(message) {
    switch (message.type) {
      case "render":
        render(message);
        return;
      case "progress":
        setCurrent(message.current, message.word, message.wordSource);
        return;
      case "fontSize":
        applyFontSize(message.value);
        return;
    }
  }

  content.addEventListener("click", (event) => {
    jumpTo(event.target);
  });
  content.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      jumpTo(event.target);
    }
  });
  smaller.addEventListener("click", () => {
    changeFontSize(-FONT_SIZE_STEP);
  });
  larger.addEventListener("click", () => {
    changeFontSize(FONT_SIZE_STEP);
  });
  window.addEventListener("message", (event) => {
    if (isHostMessage(event.data)) {
      handle(event.data);
    }
  });

  applyFontSize(vscode.getState()?.fontSize ?? DEFAULT_FONT_SIZE);
  vscode.postMessage({ type: "ready" });
})();
