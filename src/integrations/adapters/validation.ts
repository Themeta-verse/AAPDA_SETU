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
  swellHeight: { min: 0, max: 30 },
  oceanCurrentVelocity: { min: 0, max: 5 },
  seaSurfaceTemperature: { min: -5, max: 45 },
  windSpeed: { min: 0, max: 200 },
  windDirection: { min: 0, max: 360 },
  rainProbability: { min: 0, max: 100 },
  temperature: { min: -90, max: 70 },
  pressure: { min: 800, max: 1200 },
} as const satisfies Record<string, NumberRange>;

export type RangeName = keyof typeof MARINE_RANGES;

/**
 * Plausible bounds for USGS event values.
 *
 * Deliberately wider than anything the feed has published: these exist to
 * catch `null`, `NaN`, strings and impossible coordinates, not to filter
 * unusual-but-real seismicity. USGS magnitudes are routinely negative (small
 * quarry blasts) and have exceeded 9.
 */
export const EARTHQUAKE_RANGES = {
  magnitude: { min: -10, max: 12 },
  longitude: { min: -180, max: 180 },
  latitude: { min: -90, max: 90 },
  depthKm: { min: -50, max: 1000 },
  /** Epoch milliseconds, bounded to 1970..2100 to reject junk. */
  epochMs: { min: 0, max: 4_102_444_800_000 },
} as const satisfies Record<string, NumberRange>;

/**
 * Validate a USGS epoch-millisecond timestamp and convert it to ISO-8601.
 *
 * USGS publishes `properties.time`, `properties.updated` and
 * `metadata.generated` as integer epoch milliseconds. Converting to ISO is a
 * deterministic, lossless transformation that matches the ISO convention used
 * by the rest of the adapter layer. Anything unusable returns `null`.
 */
export function validateEpochMs(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    // Some USGS serialisations emit these as numeric strings.
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) value = asNumber;
  }
  const ms = validateNumber(value, EARTHQUAKE_RANGES.epochMs);
  if (ms === null) return null;
  return new Date(ms).toISOString();
}

/**
 * Normalize the USGS tsunami indicator into a nullable boolean.
 *
 * MAPPING (per the USGS GeoJSON schema, `properties.tsunami`):
 *   1  -> true   the source flags this event as a tsunami
 *   0  -> false  the source explicitly flags it as not a tsunami
 *   absent / null / any other value -> null  (unknown, NOT false)
 *
 * Deliberately absent: any magnitude-based inference. USGS tsunami flags are
 * assigned from oceanographic modelling and are independent of magnitude — in
 * the live all-month feed, 8 of the 10 events flagged `tsunami: 1` are below
 * magnitude 6.0. A `magnitude >= 6` heuristic both misses real tsunami flags
 * and invents them for large non-tsunami events.
 */
export function normalizeTsunamiFlag(value: unknown): boolean | null {
  if (value === 1) return true;
  if (value === 0) return false;
  // Accept the numeric-string serialisation USGS occasionally emits.
  if (value === '1') return true;
  if (value === '0') return false;
  return null;
}

/** Return a trimmed non-empty string, or null. */
export function validateText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

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