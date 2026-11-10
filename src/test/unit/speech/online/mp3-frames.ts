/** Builds fake MPEG-2 Layer III audio: 24 kHz, 48 kbit/s, 144-byte frames of 24 ms each. */
export function fakeMp3(frames: number, junkBefore = 0): Uint8Array {
  const audio = new Uint8Array(junkBefore + frames * 144);
  for (let i = 0; i < frames; i++) {
    audio.set([0xff, 0xf3, 0x64, 0xc4], junkBefore + i * 144);
  }
  return audio;
}
