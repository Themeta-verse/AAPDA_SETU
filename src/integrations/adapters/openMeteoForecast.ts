/**
 * Open-Meteo forecast adapter — the NORMALIZED 48-hour horizon.
 *
 * WHY THIS EXISTS
 *
 * Sea state and atmosphere come from two different Open-Meteo endpoints:
 *
 *   marine   -> wave height, wave period, wave direction, swell, current, SST
 *   forecast -> wind, gusts, precipitation, visibility, temperature
 *
 * Neither endpoint publishes the other's fields, and the forecast endpoint does
 * NOT publish wave variables at all (verified live: requesting `wave_height`
 * there returns 72 nulls and `hourly_units.wave_height === "undefined"`).
 * So a complete hourly hazard timeline REQUIRES both payloads, joined by the
 * timestamp each one published.
 *
 * This module owns that join, plus validation and provenance. It is the only
 * place hourly forecast data is parsed; components and hooks consume
 * `NormalizedForecast.hours` and never touch raw arrays.
 *
 * HONESTY RULES ENFORCED HERE
 *
 *  - Every numeric field is `number | null`. `null` means the source did not
 *    publish that variable for that hour. It is never coerced to 0.
 *  - Hours are NEVER padded, interpolated, duplicated or extrapolated. If the
 *    source publishes 40 hours we return 40 hours.
 *  - The join is keyed on the source's own timestamp string, NOT on array
 *    index, so a truncated or reordered array cannot silently mis-pair values.
 *  - Hours are returned in strict chronological order, deduplicated.
 */

import { isRecord, validateField, validateTimestamp } from './validation';
import { resolveFreshness } from './freshness';
import {
  buildForecastUrl as buildWeatherUrl,
  buildMarineUrl,
  FORECAST_REQUEST_DAYS,
} from './openMeteoMarine';
import type {
  AdapterDeps,
  Coordinates,
  SourceError,
  SourceMetadata,
  SourceStatus,
} from './types';

/** Hours the product's forecast timeline presents. */
export const FORECAST_HORIZON_HOURS = 48;

/** Days requested from each endpoint — owned by the marine adapter. */
export { FORECAST_REQUEST_DAYS };

export const SOURCE_TIMEZONE = 'Asia/Kolkata';

/**
 * The two endpoints, built by the marine adapter so there is exactly ONE
 * definition of each URL. Both endpoints are fetched as a pair and shared
 * between the current-conditions reading and this timeline, so requesting
 * `hourly` here costs no extra request.
 */
export const buildMarineHourlyUrl = buildMarineUrl;
export const buildWeatherHourlyUrl = buildWeatherUrl;

/**
 * Plausibility bounds for hourly values.
 *
 * These reject impossible payloads (null, NaN, strings, negative, sign-flipped).
 * They are NOT risk thresholds — the risk engine owns those.
 */
export const FORECAST_RANGES = {
  waveHeightM: { min: 0, max: 30 },
  swellHeightM: { min: 0, max: 30 },
  wavePeriodS: { min: 0, max: 40 },
  directionDeg: { min: 0, max: 360 },
  windSpeedKmh: { min: 0, max: 250 },
  windGustKmh: { min: 0, max: 300 },
  temperatureC: { min: -20, max: 60 },
  precipitationMm: { min: 0, max: 400 },
  precipitationProbabilityPct: { min: 0, max: 100 },
  visibilityM: { min: 0, max: 100000 },
} as const;

/**
 * One validated forecast hour.
 *
 * `time` is the source's own wall-clock string, verbatim. Because we request
 * `timezone=Asia/Kolkata`, that string is Indian Standard Time and is the
 * CORRECT thing to show an operator — independent of where the browser is.
 *
 * `isoTime` is the same instant as a true UTC ISO-8601 string, used only for
 * ordering and arithmetic. Never display it directly without an explicit
 * timezone.
 */
export interface NormalizedForecastHour {
  /** Source-local wall clock, verbatim from the API: `2026-10-01T14:00`. */
  time: string;
  /** The same instant as UTC ISO-8601. For sorting/maths only. */
  isoTime: string;
  /** UTC instant in epoch ms. For sorting/range filtering only. */
  epochMs: number;

  // Marine — Open-Meteo Marine.
  waveHeightM: number | null;
  swellHeightM: number | null;
  swellDirectionDeg: number | null;
  wavePeriodS: number | null;

  // Atmosphere — Open-Meteo Forecast.
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  temperatureC: number | null;
  precipitationMm: number | null;
  precipitationProbabilityPct: number | null;
  visibilityM: number | null;
}

/**
 * The complete normalized horizon.
 *
 * `marineStatus` and `weatherStatus` are tracked SEPARATELY so one failing
 * endpoint cannot mark the whole forecast unavailable while the other endpoint
 * is serving perfectly good data.
 */
export interface NormalizedForecast {
  /** Freshness of the horizon as a whole. */
  status: SourceStatus;
  /** Freshness of the sea-state endpoint that supplies the wave fields. */
  marineStatus: SourceStatus;
  /** Freshness of the atmosphere endpoint that supplies the wind fields. */
  weatherStatus: SourceStatus;

  /** When these payloads were parsed, ISO-8601. Null if nothing was parsed. */
  fetchedAt: string | null;

  /** Chronological, deduplicated. Length is at most `horizonHours`. */
  hours: NormalizedForecastHour[];

  /** The horizon this payload was built for, for display. */
  horizonHours: number;

  /** Timestamps that failed validation and were dropped. */
  rejectedCount: number;

  /** `utc_offset_seconds` as published by the source, when present. */
  utcOffsetSeconds: number | null;

  /** First hour the source published, ISO-8601 UTC, when available. */
  validFrom: string | null;
  /** Last hour the source published, ISO-8601 UTC, when available. */
  validUntil: string | null;

  marineSource: SourceMetadata;
  weatherSource: SourceMetadata;

  /** First failure encountered, in marine-then-weather order. */
  error: SourceError | null;
}

/** Raw `hourly` block shape, before validation. */
interface RawHourly {
  time?: unknown;
  wave_height?: unknown;
  wave_period?: unknown;
  swell_wave_height?: unknown;
  swell_wave_direction?: unknown;
  wind_speed_10m?: unknown;
  wind_gusts_10m?: unknown;
  temperature_2m?: unknown;
  precipitation?: unknown;
  precipitation_probability?: unknown;
  visibility?: unknown;
}

function readArray(block: RawHourly | null, key: keyof RawHourly): unknown[] {
  if (!block) return [];
  const value = block[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Convert a source wall-clock string into a real UTC instant.
 *
 * Open-Meteo publishes `2026-10-01T14:00` with NO offset, but it publishes
 * `utc_offset_seconds` alongside it. We therefore treat the naive string as
 * UTC and SUBTRACT the offset, which is the only way to recover a true instant
 * without inventing a timezone. Returns null when the string is unusable.
 */
export function toUtcEpochMs(
  wallClock: string,
  utcOffsetSeconds: number
): number | null {
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wallClock)
    ? `${wallClock}:00`
    : wallClock;
  const asUtc = Date.parse(`${withSeconds}Z`);
  if (Number.isNaN(asUtc)) return null;
  return asUtc - utcOffsetSeconds * 1000;
}

/** Build the set of source timestamps one payload publishes. */
function readTimestamps(block: RawHourly | null): string[] {
  const times = readArray(block, 'time');
  const out: string[] = [];
  for (const t of times) {
    const valid = validateTimestamp(t);
    if (valid) out.push(valid);
  }
  return out;
}

/**
 * Join the marine and weather hourly payloads on the source timestamp.
 *
 * KEYED ON THE TIMESTAMP, NOT THE INDEX. This is the important property: the
 * two endpoints are separate requests and neither guarantees the same array
 * length, ordering, or start hour. Index-zipping them (as an earlier version of
 * this pipeline did) silently pairs the wrong hour with the wrong value as soon
 * as one payload is shorter than the other.
 *
 * An hour present in only ONE payload is still emitted, with the other
 * endpoint's fields left null. That is honest: we know the sea state but not the
 * wind, and the risk engine will report the wind as missing.
 */
export function joinForecastHours(
  marineBlock: RawHourly | null,
  weatherBlock: RawHourly | null,
  utcOffsetSeconds: number,
  options: { horizonHours?: number; startEpochMs?: number } = {}
): { hours: NormalizedForecastHour[]; rejected: number } {
  const horizonHours = options.horizonHours ?? FORECAST_HORIZON_HOURS;
  const marineTimes = readTimestamps(marineBlock);
  const weatherTimes = readTimestamps(weatherBlock);

  let rejected = Math.max(0, readArray(marineBlock, 'time').length - marineTimes.length);
  rejected += Math.max(0, readArray(weatherBlock, 'time').length - weatherTimes.length);

  // Index each payload's values by its own timestamp so the join is by key.
  const marineIndex = new Map<string, number>();
  marineTimes.forEach((t, i) => {
    if (!marineIndex.has(t)) marineIndex.set(t, i);
  });
  const weatherIndex = new Map<string, number>();
  weatherTimes.forEach((t, i) => {
    if (!weatherIndex.has(t)) weatherIndex.set(t, i);
  });

  const allTimes = new Set<string>([...marineIndex.keys(), ...weatherIndex.keys()]);
  const hours: NormalizedForecastHour[] = [];
  const seen = new Set<number>();

  for (const time of allTimes) {
    const epochMs = toUtcEpochMs(time, utcOffsetSeconds);
    if (epochMs === null) {
      rejected += 1;
      continue;
    }
    // Duplicate instants can only arise from duplicate timestamps; keep the first.
    if (seen.has(epochMs)) continue;
    seen.add(epochMs);

    if (options.startEpochMs !== undefined && epochMs < options.startEpochMs) continue;

    const m = marineIndex.get(time);
    const w = weatherIndex.get(time);

    hours.push({
      time,
      isoTime: new Date(epochMs).toISOString(),
      epochMs,

      waveHeightM: validateField(readArray(marineBlock, 'wave_height')[m ?? -1], FORECAST_RANGES.waveHeightM),
      swellHeightM: validateField(
        readArray(marineBlock, 'swell_wave_height')[m ?? -1],
        FORECAST_RANGES.swellHeightM
      ),
      swellDirectionDeg: validateField(
        readArray(marineBlock, 'swell_wave_direction')[m ?? -1],
        FORECAST_RANGES.directionDeg
      ),
      wavePeriodS: validateField(
        readArray(marineBlock, 'wave_period')[m ?? -1],
        FORECAST_RANGES.wavePeriodS
      ),

      windSpeedKmh: validateField(
        readArray(weatherBlock, 'wind_speed_10m')[w ?? -1],
        FORECAST_RANGES.windSpeedKmh
      ),
      windGustKmh: validateField(
        readArray(weatherBlock, 'wind_gusts_10m')[w ?? -1],
        FORECAST_RANGES.windGustKmh
      ),
      temperatureC: validateField(
        readArray(weatherBlock, 'temperature_2m')[w ?? -1],
        FORECAST_RANGES.temperatureC
      ),
      precipitationMm: validateField(
        readArray(weatherBlock, 'precipitation')[w ?? -1],
        FORECAST_RANGES.precipitationMm
      ),
      precipitationProbabilityPct: validateField(
        readArray(weatherBlock, 'precipitation_probability')[w ?? -1],
        FORECAST_RANGES.precipitationProbabilityPct
      ),
      visibilityM: validateField(
        readArray(weatherBlock, 'visibility')[w ?? -1],
        FORECAST_RANGES.visibilityM
      ),
    });
  }

  hours.sort((a, b) => a.epochMs - b.epochMs);
  return { hours: hours.slice(0, horizonHours), rejected };
}

export function emptyNormalizedForecast(
  marineSource: SourceMetadata,
  weatherSource: SourceMetadata,
  error: SourceError | null = null,
  isOnline = true
): NormalizedForecast {
  // A total fetch failure must still distinguish "the source broke" from "this
  // device has no network". Returning a hardcoded `unavailable` here reported a
  // source outage for what was really an offline browser.
  const offlineStatus: SourceStatus = isOnline ? 'unavailable' : 'offline';
  return {
    status: offlineStatus,
    marineStatus: offlineStatus,
    weatherStatus: offlineStatus,
    fetchedAt: null,
    hours: [],
    horizonHours: FORECAST_HORIZON_HOURS,
    rejectedCount: 0,
    utcOffsetSeconds: null,
    validFrom: null,
    validUntil: null,
    marineSource,
    weatherSource,
    error,
  };
}

/**
 * Merge already-parsed marine and weather payload bodies into a horizon.
 *
 * Split from `fetchForecastHorizon` so the merge is testable without a network,
 * and so the same normalization is exercised by both paths.
 */
export function normalizeForecast(
  marineBody: unknown,
  weatherBody: unknown,
  marineSource: SourceMetadata,
  weatherSource: SourceMetadata,
  fetchedAt: string | null,
  options: { horizonHours?: number; startEpochMs?: number; now: Date; isOnline: boolean }
): NormalizedForecast {
  const marineOk = isRecord(marineBody);
  const weatherOk = isRecord(weatherBody);

  if (!marineOk && !weatherOk) {
    return emptyNormalizedForecast(marineSource, weatherSource, null, options.isOnline);
  }

  const marineBlock = marineOk ? ((marineBody as { hourly?: RawHourly }).hourly ?? null) : null;
  const weatherBlock = weatherOk ? ((weatherBody as { hourly?: RawHourly }).hourly ?? null) : null;

  // Prefer the offset the source actually published. Fall back to the known IST
  // offset only when neither payload carried one.
  const publishedOffset =
    (weatherOk && typeof (weatherBody as Record<string, unknown>).utc_offset_seconds === 'number'
      ? ((weatherBody as Record<string, unknown>).utc_offset_seconds as number)
      : null) ??
    (marineOk && typeof (marineBody as Record<string, unknown>).utc_offset_seconds === 'number'
      ? ((marineBody as Record<string, unknown>).utc_offset_seconds as number)
      : null) ??
    19800;

  const { hours, rejected } = joinForecastHours(marineBlock, weatherBlock, publishedOffset, options);

  const marineHasData = hours.some(
    (h) => h.waveHeightM !== null || h.swellHeightM !== null || h.wavePeriodS !== null
  );
  const weatherHasData = hours.some(
    (h) => h.windSpeedKmh !== null || h.precipitationMm !== null || h.visibilityM !== null
  );

  const marineStatus = resolveFreshness(fetchedAt, marineHasData, options.now, options.isOnline);
  const weatherStatus = resolveFreshness(fetchedAt, weatherHasData, options.now, options.isOnline);

  // The horizon as a whole is only live when at least one endpoint is.
  const hasAny = hours.length > 0;
  const status = resolveFreshness(fetchedAt, hasAny, options.now, options.isOnline);

  return {
    status,
    marineStatus,
    weatherStatus,
    fetchedAt,
    hours,
    horizonHours: options.horizonHours ?? FORECAST_HORIZON_HOURS,
    rejectedCount: rejected,
    utcOffsetSeconds: publishedOffset,
    validFrom: hours.length > 0 ? hours[0].isoTime : null,
    validUntil: hours.length > 0 ? hours[hours.length - 1].isoTime : null,
    marineSource,
    weatherSource,
    error: null,
  };
}

/**
 * Fetch the merged horizon from both endpoints.
 *
 * Each endpoint is independent. If one fails we still publish the other's real
 * hours with the failed side left null, and we surface the failure as an error
 * rather than discarding everything.
 */
export async function fetchForecastHorizon(
  coordinates: Coordinates,
  deps: AdapterDeps = {}
): Promise<NormalizedForecast> {
  const {
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  } = deps;

  const marineUrl = buildMarineHourlyUrl(coordinates);
  const weatherUrl = buildWeatherHourlyUrl(coordinates);

  const marineSource: SourceMetadata = {
    id: 'open-meteo-marine',
    label: 'Open-Meteo Marine',
    authority: 'official',
    url: marineUrl,
    observedAt: null,
  };
  const weatherSource: SourceMetadata = {
    id: 'open-meteo-weather',
    label: 'Open-Meteo Forecast',
    authority: 'official',
    url: weatherUrl,
    observedAt: null,
  };

  const read = async (
    url: string,
    sourceId: SourceMetadata['id']
  ): Promise<{ data: unknown; error: SourceError | null }> => {
    let response: Response;
    try {
      response = await fetchImpl(url);
    } catch (err) {
      return {
        data: null,
        error: {
          kind: 'network',
          message: err instanceof Error ? err.message : 'Network request failed',
          sourceId,
        },
      };
    }

    if (!response.ok) {
      return {
        data: null,
        error: {
          kind: 'http',
          message: `Source responded with HTTP ${response.status}`,
          httpStatus: response.status,
          sourceId,
        },
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        data: null,
        error: { kind: 'malformed', message: 'Response body is not valid JSON', sourceId },
      };
    }

    if (!isRecord(body)) {
      return {
        data: null,
        error: { kind: 'malformed', message: 'Response body is not an object', sourceId },
      };
    }

    if (body.error === true) {
      return {
        data: null,
        error: {
          kind: 'source-error',
          message: typeof body.reason === 'string' ? body.reason : 'Source reported an error',
          sourceId,
        },
      };
    }

    return { data: body, error: null };
  };

  const [marine, weather] = await Promise.all([read(marineUrl, 'open-meteo-marine'), read(weatherUrl, 'open-meteo-weather')]);

  const merged = normalizeForecast(marine.data, weather.data, marineSource, weatherSource, now().toISOString(), {
    horizonHours: FORECAST_HORIZON_HOURS,
    startEpochMs: undefined,
    now: now(),
    isOnline: isOnline(),
  });

  const error = marine.error ?? weather.error ?? null;

  if (merged.hours.length === 0) {
    return { ...emptyNormalizedForecast(marineSource, weatherSource, error, isOnline()), error };
  }

  return { ...merged, error };
}