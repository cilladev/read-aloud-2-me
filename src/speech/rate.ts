/**
 * Maps the user's speed multiplier to each platform's rate unit.
 * Pure arithmetic: no processes, no platform checks.
 */

/** Slowest speed multiplier the extension offers. */
export const MIN_SPEED = 0.5;
/** Fastest speed multiplier the extension offers. */
export const MAX_SPEED = 2;
/** `say`'s normal pace in words per minute, measured on Samantha. */
export const SAY_BASE_WPM = 175;

const SAPI_MIN = -10;
const SAPI_MAX = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamps a speed multiplier to 0.5..2; non-finite values become 1. */
export function clampSpeed(speed: number): number {
  return Number.isFinite(speed) ? clamp(speed, MIN_SPEED, MAX_SPEED) : 1;
}

/** Words per minute for `say -r`, from a speed multiplier. */
export function sayWordsPerMinute(speed: number): number {
  return Math.round(SAY_BASE_WPM * clampSpeed(speed));
}

/** SAPI `Rate` (-10..10, where +10 is about 3x), from a speed multiplier. */
export function sapiRate(speed: number): number {
  const rate = Math.round((10 * Math.log(clampSpeed(speed))) / Math.log(3));
  // Math.round(-0) is -0; normalise so callers and tests see plain 0.
  return clamp(rate, SAPI_MIN, SAPI_MAX) + 0;
}
