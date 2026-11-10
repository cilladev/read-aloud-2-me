// @ts-check
/**
 * Reader panel webview script. Draws the sentences the host sends, lights the current one,
 * and reports clicks and text size changes back. The host owns all state; this only draws it.
 * Must not use innerHTML with text, load anything remote, or trust message shapes blindly.
 */

/**
 * @typedef {{ text: string, paragraphStart: boolean }} ReaderSentence
 * @typedef {{ start: number, length: number }} WordRange
 * @typedef {{ type: "render", title: string, sentences: ReaderSentence[], current: number, fontSize: number, emptyHint: string }} RenderMessage
 * @typedef {{ type: "progress", current: number, word?: WordRange }} ProgressMessage
 * @typedef {{ type: "fontSize", value: number }} FontSizeMessage
 * @typedef {RenderMessage | ProgressMessage | FontSizeMessage} HostToWebview
 * @typedef {{ type: "ready" } | { type: "jumpTo", index: number } | { type: "fontSize", value: number }} WebviewToHost
 * @typedef {{ fontSize?: number }} SavedState
 * @typedef {{ postMessage(message: WebviewToHost): void, getState(): SavedState | undefined, setState(state: SavedState): void }} VsCodeApi
 */

(function () {
  const MIN_FONT_SIZE = 12;
  const MAX_FONT_SIZE = 32;
  const FONT_SIZE_STEP = 2;
  const DEFAULT_FONT_SIZE = 16;

  /** @type {VsCodeApi} */
  const vscode = acquireVsCodeApi();

  /** @type {HTMLElement[]} */
  let spans = [];
  /** @type {string[]} */
  let texts = [];
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
    texts = message.sentences.map((s) => s.text);
    spans = [];
    current = -1;
    content.replaceChildren(texts.length === 0 ? emptyState(message.emptyHint) : buildParagraphs(message.sentences));
    setCurrent(message.current, undefined);
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
      const span = makeSentence(sentence.text, index);
      spans.push(span);
      paragraph.append(span);
    });
    return fragment;
  }

  /**
   * @param {string} text
   * @param {number} index
   * @returns {HTMLElement}
   */
  function makeSentence(text, index) {
    const span = document.createElement("span");
    span.className = "s";
    span.textContent = text;
    span.dataset["index"] = String(index);
    span.setAttribute("role", "button");
    span.tabIndex = 0;
    return span;
  }

  /**
   * Move the lit sentence, touching only the spans whose state changes.
   * @param {number} next
   * @param {WordRange | undefined} word
   */
  function setCurrent(next, word) {
    const target = Number.isInteger(next) && next >= 0 && next < spans.length ? next : -1;
    if (target !== current) {
      unlight(current);
      markDone(current, target);
      current = target;
      light(current);
    }
    showWord(word);
  }

  /** @param {number} index */
  function unlight(index) {
    const span = spans[index];
    if (!span) {
      return;
    }
    span.classList.remove("now");
    span.removeAttribute("aria-current");
    span.textContent = texts[index] ?? "";
  }

  /** @param {number} index */
  function light(index) {
    const span = spans[index];
    if (!span) {
      return;
    }
    span.classList.add("now");
    span.setAttribute("aria-current", "true");
    scrollIntoViewIfNeeded(span);
  }

  /**
   * @param {number} from
   * @param {number} to
   */
  function markDone(from, to) {
    if (to < 0) {
      spans.forEach((span) => span.classList.remove("done"));
      return;
    }
    const low = Math.max(0, Math.min(from, to));
    const high = Math.max(from, to);
    for (let i = low; i < high; i++) {
      spans[i]?.classList.toggle("done", i < to);
    }
    spans[to]?.classList.remove("done");
  }

  /** @param {WordRange | undefined} word */
  function showWord(word) {
    const span = spans[current];
    const text = texts[current];
    if (!span || text === undefined) {
      return;
    }
    const valid =
      word &&
      Number.isInteger(word.start) &&
      Number.isInteger(word.length) &&
      word.start >= 0 &&
      word.length > 0 &&
      word.start + word.length <= text.length;
    if (!valid) {
      span.textContent = text;
      return;
    }
    const mark = document.createElement("mark");
    mark.textContent = text.slice(word.start, word.start + word.length);
    span.replaceChildren(text.slice(0, word.start), mark, text.slice(word.start + word.length));
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
        setCurrent(message.current, message.word);
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
