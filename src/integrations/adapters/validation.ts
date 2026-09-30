/**
 * Field-level validation helpers shared by adapters.
 *
 * Every helper returns `null` for anything that is not provably a usable
 * number. Callers must treat `null` as "source did not publish this" and must
 * never substitute a default constant.
 */

export interface NumberRange {
  min: number;
  max: number;
}

/**
 * Physically plausible bounds, used to reject corrupt payloads.
 *
 * These are deliberately generous: they exist to catch `null`, `NaN`, strings,
 * sentinels and sign-flipped values, not to second-guess the source.
 */
export const MARINE_RANGES = {
  waveHeight: { min: 0, max: 30 },
  waveDirection: { min: 0, max: 360 },
  wavePeriod: { min: 0, max: 60 },
  windSpeed: { min: 0, max: 200 },
  windDirection: { min: 0, max: 360 },
  rainProbability: { min: 0, max: 100 },
  temperature: { min: -90, max: 70 },
  pressure: { min: 800, max: 1200 },
} as const satisfies Record<string, NumberRange>;

export type RangeName = keyof typeof MARINE_RANGES;

/** Return the value only if it is a finite number inside the given range. */
export function validateNumber(
  value: unknown,
  range: NumberRange
): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  if (value < range.min || value > range.max) return null;
  return value;
}

export function validateField(
  value: unknown,
  range: NumberRange
): number | null {
  return validateNumber(value, range);
}

/** True when the value is a plain object we can safely index. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate an ISO-8601 timestamp string from a source.
 *
 * Open-Meteo publishes local wall-clock timestamps without an offset
 * (`2026-09-30T19:45`) alongside `utc_offset_seconds`. We keep the string
 * verbatim for display and only require that it parses.
 */
export function validateTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  // Accept `YYYY-MM-DDTHH:mm` (no offset) as well as full ISO with offset.
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? `${value}:00`
    : value;
  return Number.isNaN(new Date(normalized).getTime()) ? null : value;
}