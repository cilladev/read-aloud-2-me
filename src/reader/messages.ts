/**
 * The messages the reader panel host and its webview send each other, plus validation of what
 * the webview sends. media/reader.js mirrors these shapes in JSDoc typedefs.
 * Must not import vscode: it stays pure so it is unit-tested in plain Node.
 */

/** Smallest reader text size in CSS pixels. */
export const MIN_FONT_SIZE = 12;
/** Largest reader text size in CSS pixels. */
export const MAX_FONT_SIZE = 32;
/** How much A− and A+ change the text size. */
export const FONT_SIZE_STEP = 2;
/** Reader text size before the user changes it. */
export const DEFAULT_FONT_SIZE = 16;

/** One sentence as the reader shows it. */
export interface ReaderSentence {
  /** The sentence text, exactly as spoken. */
  readonly text: string;
  /** True when a blank line separated this sentence from the one before it. */
  readonly paragraphStart: boolean;
}

/** The word being spoken, as offsets into the current sentence's text. */
export interface WordRange {
  /** Start offset in the sentence text (UTF-16 code units). */
  readonly start: number;
  /** Length in UTF-16 code units. */
  readonly length: number;
}

/** Replace everything the webview shows. */
export interface RenderMessage {
  readonly type: "render";
  readonly title: string;
  readonly sentences: readonly ReaderSentence[];
  /** Index of the sentence being read, or -1 when not reading. */
  readonly current: number;
  readonly fontSize: number;
  /** One-line hint shown when there are no sentences. */
  readonly emptyHint: string;
  /** The formatted Markdown view. When absent, the sentences are shown as plain paragraphs. */
  readonly markdown?: readonly ViewNode[];
}

/** Move the lit sentence and, optionally, the lit word. */
export interface ProgressMessage {
  readonly type: "progress";
  /** Index of the sentence being read, or -1 when not reading. */
  readonly current: number;
  /** The word inside the current sentence's text, for the plain view. */
  readonly word?: WordRange;
  /** The word as a source range, for the formatted Markdown view. */
  readonly wordSource?: SourceSpan;
}

/** Set the text size. */
export interface FontSizeMessage {
  readonly type: "fontSize";
  readonly value: number;
}

/** Everything the host sends to the webview. */
export type HostToWebview = RenderMessage | ProgressMessage | FontSizeMessage;

/** Elements the reader may draw for Markdown. The webview refuses anything else. */
export type ViewTag =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "p"
  | "strong"
  | "em"
  | "del"
  | "code"
  | "pre"
  | "a"
  | "ul"
  | "ol"
  | "li"
  | "blockquote"
  | "table"
  | "thead"
  | "tbody"
  | "tr"
  | "th"
  | "td"
  | "hr"
  | "br"
  | "sup"
  | "span";

/** An element of the formatted Markdown view. */
export interface ViewElement {
  readonly tag: ViewTag;
  /** A class from a fixed set: "image", "task", "task-done", "footnote". */
  readonly className?: string;
  /** For `ol`: the number of the first item. */
  readonly start?: number;
  readonly children: readonly ViewNode[];
}

/** A run of text in the formatted view. */
export interface ViewText {
  readonly text: string;
  /** The sentence this text is part of, when it is spoken. */
  readonly sentence?: number;
  /** Source offset of the first character, when the text is exactly the source. */
  readonly source?: number;
}

/** One node of the formatted Markdown view. */
export type ViewNode = ViewElement | ViewText;

/** A range of the source document, end exclusive. */
export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

/** Everything the webview sends to the host. */
export type WebviewToHost =
  | { readonly type: "ready" }
  | { readonly type: "jumpTo"; readonly index: number }
  | { readonly type: "fontSize"; readonly value: number };

/**
 * Keep a text size inside the allowed range, rounded to a whole pixel.
 * @param value - Any number; non-finite values give the default.
 * @returns A size between {@link MIN_FONT_SIZE} and {@link MAX_FONT_SIZE}.
 * @example clampFontSize(40) // 32
 */
export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_FONT_SIZE;
  }
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFontSize(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_FONT_SIZE && (value as number) <= MAX_FONT_SIZE;
}

function isIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Check a message from the webview. The webview is untrusted, so anything malformed is dropped.
 * Extra fields are ignored. A `jumpTo` index is only checked to be a non-negative integer;
 * the host checks it against the sentence count.
 * @param value - The raw message.
 * @returns The typed message, or `undefined` when it is not valid.
 * @example parseWebviewMessage({ type: "jumpTo", index: 2 }) // { type: "jumpTo", index: 2 }
 */
export function parseWebviewMessage(value: unknown): WebviewToHost | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const type = value["type"];
  if (type === "ready") {
    return { type: "ready" };
  }
  if (type === "jumpTo") {
    const index = value["index"];
    return isIndex(index) ? { type: "jumpTo", index } : undefined;
  }
  if (type === "fontSize") {
    const size = value["value"];
    return isFontSize(size) ? { type: "fontSize", value: size } : undefined;
  }
  return undefined;
}
