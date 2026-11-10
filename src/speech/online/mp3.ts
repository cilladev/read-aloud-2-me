/**
 * Just enough MP3 frame reading to know how long the audio is and to cut it at a frame
 * boundary, so a paused sentence can resume from where it stopped without asking the online
 * service again. Pure: works on bytes only.
 */

/** A slice of audio and the time in the original it starts at. */
export interface Mp3Slice {
  readonly audio: Uint8Array;
  /** Where the slice starts in the original audio, in milliseconds. */
  readonly startMs: number;
}

interface Frame {
  readonly offset: number;
  readonly length: number;
  readonly durationMs: number;
}

// Layer III bitrates in kbit/s, by bitrate index.
const MPEG1_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
// Sample rates by version bits (3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5) and rate index.
const SAMPLE_RATES: Readonly<Record<number, readonly number[]>> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

/** Total duration of the MP3 audio in milliseconds. Bytes that aren't frames are skipped. */
export function mp3DurationMs(audio: Uint8Array): number {
  return frames(audio).reduce((total, frame) => total + frame.durationMs, 0);
}

/**
 * Cuts the audio at the first frame that starts at or after `fromMs`.
 * @returns the remaining audio and its real start time; empty audio when `fromMs` is past the end
 */
export function sliceMp3(audio: Uint8Array, fromMs: number): Mp3Slice {
  let elapsed = 0;
  for (const frame of frames(audio)) {
    if (elapsed >= fromMs) {
      return { audio: audio.subarray(frame.offset), startMs: elapsed };
    }
    elapsed += frame.durationMs;
  }
  return { audio: new Uint8Array(0), startMs: elapsed };
}

function frames(audio: Uint8Array): Frame[] {
  const found: Frame[] = [];
  let offset = 0;
  while (offset + 4 <= audio.length) {
    const frame = readFrame(audio, offset);
    if (frame === undefined) {
      offset++;
      continue;
    }
    found.push(frame);
    offset += frame.length;
  }
  return found;
}

/** Reads a Layer III frame header at `offset`, or undefined when there is none. */
function readFrame(audio: Uint8Array, offset: number): Frame | undefined {
  const b1 = audio[offset + 1] ?? 0;
  const b2 = audio[offset + 2] ?? 0;
  if (audio[offset] !== 0xff || (b1 & 0xe0) !== 0xe0 || ((b1 >> 1) & 3) !== 1) {
    return undefined;
  }
  const version = (b1 >> 3) & 3;
  const sampleRate = SAMPLE_RATES[version]?.[(b2 >> 2) & 3];
  const bitrate = (version === 3 ? MPEG1_BITRATES : MPEG2_BITRATES)[b2 >> 4];
  if (sampleRate === undefined || bitrate === undefined || bitrate === 0) {
    return undefined;
  }
  const padding = (b2 >> 1) & 1;
  const samples = version === 3 ? 1152 : 576;
  const length = Math.floor(((samples / 8) * bitrate * 1000) / sampleRate) + padding;
  return { offset, length, durationMs: (samples / sampleRate) * 1000 };
}
