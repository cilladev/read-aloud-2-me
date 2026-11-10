/**
 * Text helpers for the online (Edge) voices: escaping text for the SSML request, the speed
 * as an SSML rate, and mapping the service's word timings back to offsets in the sentence.
 * Pure: no network, no processes.
 */

/** A word boundary as the online service reports it. */
export interface WordBoundary {
  /** When the word starts in the audio, in milliseconds. */
  readonly atMs: number;
  /** The word as the service saw it, still XML-escaped. */
  readonly text: string;
  /** How long the word lasts in the audio, in milliseconds, when the service says. */
  readonly durationMs?: number;
}

/**
 * When the last word ends, so the next sentence can start without the silence the service
 * adds after each one. Undefined when there are no timings.
 */
export function speechEndMs(boundaries: readonly WordBoundary[]): number | undefined {
  const last = boundaries.at(-1);
  return last === undefined ? undefined : last.atMs + (last.durationMs ?? 0);
}

/** A word boundary placed in the sentence. Offsets are UTF-16, into the sentence text. */
export interface TimedWord {
  readonly atMs: number;
  readonly start: number;
  readonly length: number;
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

const XML_UNESCAPES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

/**
 * Escapes text so it can sit inside SSML. The service drops a request with a bare `&` or `<`.
 * @example
 * escapeXml("Tom & Jerry"); // "Tom &amp; Jerry"
 */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

/** Reverses {@link escapeXml}, for the word text the service sends back. */
export function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_UNESCAPES[entity] ?? entity);
}

/**
 * Turns a speed multiplier into an SSML prosody rate.
 * @example
 * ssmlRate(1.25); // "+25%"
 * ssmlRate(0.5); // "-50%"
 */
export function ssmlRate(speed: number): string {
  const percent = Math.round((Math.min(2, Math.max(0.5, speed)) - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${String(percent)}%`;
}

/**
 * Places each word boundary in the sentence by searching forward from the previous word.
 * Words that can't be found (the service sometimes rewrites numbers) are left out, so the
 * highlight skips them rather than marking the wrong text.
 *
 * @example
 * timeWords("It's 3.5 now", [{ atMs: 0, text: "It's" }, { atMs: 300, text: "now" }]);
 * // [{ atMs: 0, start: 0, length: 4 }, { atMs: 300, start: 9, length: 3 }]
 */
export function timeWords(sentence: string, boundaries: readonly WordBoundary[]): TimedWord[] {
  const lower = sentence.toLowerCase();
  const words: TimedWord[] = [];
  let cursor = 0;
  for (const boundary of boundaries) {
    const word = unescapeXml(boundary.text).trim();
    if (word === "") {
      continue;
    }
    let start = sentence.indexOf(word, cursor);
    if (start < 0) {
      start = lower.indexOf(word.toLowerCase(), cursor);
    }
    if (start < 0) {
      continue;
    }
    words.push({ atMs: boundary.atMs, start, length: word.length });
    cursor = start + word.length;
  }
  return words;
}
