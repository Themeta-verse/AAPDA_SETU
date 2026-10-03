import { resolveFreshness } from './freshness';
import {
  MARINE_RANGES,
  isRecord,
  validateField,
  validateTimestamp,
} from './validation';
import type {
  AdapterDeps,
  AdapterResult,
  Coordinates,
  MarineHourlyPoint,
  NormalizedMarine,
  SourceError,
  SourceMetadata,
  WeatherHourlyPoint,
} from './types';

/**
 * Open-Meteo Marine adapter.
 *
 * Marine endpoint is the AUTHORITATIVE source for sea state (wave height,
 * direction, period and the hourly series). The Forecast endpoint is fetched
 * alongside it because the Marine endpoint does not publish wind, which the
 * existing risk engine consumes. Both are the same provider at the same
 * coordinate and share one fetch window, so they share one `fetchedAt`.
 *
 * This module performs transport, validation and normalisation only. It does
 * not compute risk, does not decide alert thresholds, and never substitutes a
 * default for a value the source did not publish.
 */

export const MARINE_SOURCE_ID = 'open-meteo-marine' as const;
export const MARINE_SOURCE_LABEL = 'Open-Meteo Marine';
export const WEATHER_SOURCE_ID = 'open-meteo-weather' as const;
export const WEATHER_SOURCE_LABEL = 'Open-Meteo Forecast';

const MARINE_BASE = 'https://marine-api.open-meteo.com/v1/marine';
const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';

const MARINE_CURRENT_FIELDS =
  'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,ocean_current_velocity,sea_surface_temperature';
export const MARINE_HOURLY_FIELDS =
  'wave_height,wave_period,swell_wave_height,swell_wave_direction';

/**
 * Atmospheric variables for the current block.
 *
 * Wind, gusts, precipitation probability, temperature and pressure are NOT
 * published by the Marine endpoint, so they come from the Forecast endpoint.
 */
const FORECAST_CURRENT_FIELDS =
  'temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,surface_pressure,precipitation_probability';
export const FORECAST_HOURLY_FIELDS =
  'temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,precipitation_probability,visibility';

/**
 * Days requested from BOTH endpoints.
 *
 * Three days (72 h) rather than one, so a 48-hour timeline can be carved out
 * after part of today has already elapsed. This is the single request that
 * serves both the current-conditions reading and the forecast timeline, so the
 * surplus hours cost nothing and there is no duplicate fetch.
 */
export const FORECAST_REQUEST_DAYS = 3;

export const SOURCE_TIMEZONE = 'Asia/Kolkata';
export const TIMEZONE = SOURCE_TIMEZONE;

export function buildMarineUrl({ latitude, longitude }: Coordinates): string {
  return (
    `${MARINE_BASE}?latitude=${latitude}&longitude=${longitude}` +
    `&current=${MARINE_CURRENT_FIELDS}` +
    `&hourly=${MARINE_HOURLY_FIELDS}` +
    `&forecast_days=${FORECAST_REQUEST_DAYS}` +
    `&timezone=${encodeURIComponent(SOURCE_TIMEZONE)}`
  );
}

export function buildForecastUrl({ latitude, longitude }: Coordinates): string {
  return (
    `${FORECAST_BASE}?latitude=${latitude}&longitude=${longitude}` +
    `&current=${FORECAST_CURRENT_FIELDS}` +
    `&hourly=${FORECAST_HOURLY_FIELDS}` +
    `&forecast_days=${FORECAST_REQUEST_DAYS}` +
    `&timezone=${encodeURIComponent(SOURCE_TIMEZONE)}`
  );
}

/** Shape the adapter can normalise. Exported so tests can build fixtures. */
export interface MarinePayload {
  current?: unknown;
  hourly?: unknown;
}

/** Shape the forecast endpoint can normalise. Exported for tests. */
export interface ForecastPayload {
  current?: unknown;
  hourly?: unknown;
}

function emptyMetadata(url: string, id: SourceMetadata['id'], label: string): SourceMetadata {
  return { id, label, authority: 'official', url, observedAt: null };
}

/**
 * Read one endpoint. Distinguishes transport failure, HTTP failure, an
 * explicit `{ error: true }` payload, and unparseable bodies.
 *
 * EXPORTED so the shared observation store can read each endpoint ONCE and
 * feed the raw bodies to both the current-conditions normalizer and the
 * forecast-horizon normalizer. When each adapter fetched independently the
 * same two URLs were requested twice per cycle, which was observed causing real
 * HTTP 429 responses from the Marine endpoint.
 */
export async function readEndpoint(
  url: string,
  sourceId: SourceMetadata['id'],
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<AdapterResult<unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network request failed';
    return {
      data: null,
      error: { kind: 'network', message, sourceId },
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
    const reason = typeof body.reason === 'string' ? body.reason : 'Source reported an error';
    return {
      data: null,
      error: { kind: 'source-error', message: reason, sourceId },
    };
  }

  return { data: body, error: null };
}

/**
 * The marine `current` block, normalized.
 *
 * `observedAt` is the timestamp the SOURCE published for this reading. It is
 * deliberately a property of this block rather than of `NormalizedMarine`,
 * because on a `NormalizedMarine` the observation time lives on
 * `source.observedAt` — keeping it out of the measurement fields stops the two
 * from being able to disagree.
 */
export interface MarineCurrentReading {
  waveHeight: number | null;
  waveDirection: number | null;
  wavePeriod: number | null;
  swellHeight: number | null;
  swellDirection: number | null;
  oceanCurrentVelocity: number | null;
  seaSurfaceTemperature: number | null;
  observedAt: string | null;
}

/** Normalise the marine `current` block. Missing fields stay `null`. */
export function normalizeMarineCurrent(payload: MarinePayload): MarineCurrentReading {
  const current = isRecord(payload.current) ? payload.current : null;
  if (!current) {
    return {
      waveHeight: null,
      waveDirection: null,
      wavePeriod: null,
      swellHeight: null,
      swellDirection: null,
      oceanCurrentVelocity: null,
      seaSurfaceTemperature: null,
      observedAt: null,
    };
  }
  return {
    waveHeight: validateField(current.wave_height, MARINE_RANGES.waveHeight),
    waveDirection: validateField(current.wave_direction, MARINE_RANGES.waveDirection),
    wavePeriod: validateField(current.wave_period, MARINE_RANGES.wavePeriod),
    swellHeight: validateField(current.swell_wave_height, MARINE_RANGES.swellHeight),
    swellDirection: validateField(current.swell_wave_direction, MARINE_RANGES.waveDirection),
    oceanCurrentVelocity: validateField(
      current.ocean_current_velocity,
      MARINE_RANGES.oceanCurrentVelocity
    ),
    seaSurfaceTemperature: validateField(
      current.sea_surface_temperature,
      MARINE_RANGES.seaSurfaceTemperature
    ),
    observedAt: validateTimestamp(current.time),
  };
}

/**
 * Normalise the marine `hourly` block into aligned points.
 *
 * The source returns parallel arrays (`time[]`, `wave_height[]`). Entries are
 * dropped when either array is short or a value fails validation — we never
 * backfill a missing wave height with `0`.
 */
export function normalizeMarineHourly(payload: MarinePayload): MarineHourlyPoint[] {
  const hourly = isRecord(payload.hourly) ? payload.hourly : null;
  if (!hourly) return [];

  const times = Array.isArray(hourly.time) ? hourly.time : null;
  const heights = Array.isArray(hourly.wave_height) ? hourly.wave_height : null;
  if (!times || !heights) return [];

  const points: MarineHourlyPoint[] = [];
  const length = Math.min(times.length, heights.length);

  for (let i = 0; i < length; i += 1) {
    const time = validateTimestamp(times[i]);
    const waveHeight = validateField(heights[i], MARINE_RANGES.waveHeight);
    if (!time || waveHeight === null) continue;
    points.push({ time, waveHeight });
  }

  return points;
}

/** Normalise the forecast `current` block. */
export function normalizeForecastCurrent(payload: ForecastPayload): Pick<
  NormalizedMarine,
  'windSpeed' | 'windDirection' | 'rainProbability' | 'temperature' | 'pressure'
> {
  const current = isRecord(payload.current) ? payload.current : null;
  if (!current) {
    return {
      windSpeed: null,
      windDirection: null,
      rainProbability: null,
      temperature: null,
      pressure: null,
    };
  }
  return {
    windSpeed: validateField(current.wind_speed_10m, MARINE_RANGES.windSpeed),
    windDirection: validateField(current.wind_direction_10m, MARINE_RANGES.windDirection),
    rainProbability: validateField(current.precipitation_probability, MARINE_RANGES.rainProbability),
    temperature: validateField(current.temperature_2m, MARINE_RANGES.temperature),
    pressure: validateField(current.surface_pressure, MARINE_RANGES.pressure),
  };
}

/** Normalise the forecast `hourly` block into aligned points. */
export function normalizeForecastHourly(payload: ForecastPayload): WeatherHourlyPoint[] {
  const hourly = isRecord(payload.hourly) ? payload.hourly : null;
  if (!hourly) return [];

  const times = Array.isArray(hourly.time) ? hourly.time : null;
  if (!times) return [];

  const rainProbs = Array.isArray(hourly.precipitation_probability) ? hourly.precipitation_probability : null;
  const precipitations = Array.isArray(hourly.precipitation) ? hourly.precipitation : null;
  const windSpeeds = Array.isArray(hourly.wind_speed_10m) ? hourly.wind_speed_10m : null;

  const points: WeatherHourlyPoint[] = [];
  const length = times.length;

  for (let i = 0; i < length; i += 1) {
    const time = validateTimestamp(times[i]);
    if (!time) continue;

    const rainProbability = rainProbs ? validateField(rainProbs[i], MARINE_RANGES.rainProbability) : null;
    const precipitation = precipitations ? validateField(precipitations[i], MARINE_RANGES.precipitation) : null;
    const windSpeed = windSpeeds ? validateField(windSpeeds[i], MARINE_RANGES.windSpeed) : null;

    points.push({ time, rainProbability, precipitation, windSpeed });
  }

  return points;
}

/** Assemble the normalized payload from already-parsed bodies. */
export function normalizeMarineSources(
  marineBody: MarinePayload,
  forecastBody: ForecastPayload,
  source: SourceMetadata,
  fetchedAt: string,
  status: NormalizedMarine['status'],
  error: SourceError | null
): NormalizedMarine {
  const sea = normalizeMarineCurrent(marineBody);
  return {
    status,
    fetchedAt,
    source: { ...source, observedAt: sea.observedAt },
    waveHeight: sea.waveHeight,
    waveDirection: sea.waveDirection,
    wavePeriod: sea.wavePeriod,
    swellHeight: sea.swellHeight,
    swellDirection: sea.swellDirection,
    oceanCurrentVelocity: sea.oceanCurrentVelocity,
    seaSurfaceTemperature: sea.seaSurfaceTemperature,
    hourly: normalizeMarineHourly(marineBody),
    ...normalizeForecastCurrent(forecastBody),
    hourlyWeather: normalizeForecastHourly(forecastBody),
    error,
  };
}

/**
 * A reading with no usable value in it. Used as the hook's initial state and
 * whenever a fetch fails, so the UI never renders a plausible-looking number
 * that the source did not supply.
 */
export function emptyMarineReading(coordinates: Coordinates): NormalizedMarine {
  return {
    status: 'unavailable',
    fetchedAt: null,
    source: emptyMetadata(buildMarineUrl(coordinates), MARINE_SOURCE_ID, MARINE_SOURCE_LABEL),
    waveHeight: null,
    waveDirection: null,
    wavePeriod: null,
    swellHeight: null,
    swellDirection: null,
    oceanCurrentVelocity: null,
    seaSurfaceTemperature: null,
    hourly: [],
    windSpeed: null,
    windDirection: null,
    rainProbability: null,
    temperature: null,
    pressure: null,
    hourlyWeather: [],
    error: null,
  };
}

/**
 * Fetch and normalize one marine reading.
 *
 * The marine endpoint is required. The forecast endpoint is best-effort: if it
 * fails we still return real sea state, and the affected wind/rain fields stay
 * `null` so the risk engine can refuse to reason about them.
 */
export async function fetchMarineReading(
  coordinates: Coordinates,
  deps: AdapterDeps = {}
): Promise<NormalizedMarine> {
  const {
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  } = deps;

  const marineUrl = buildMarineUrl(coordinates);
  const forecastUrl = buildForecastUrl(coordinates);
  const source: SourceMetadata = {
    id: MARINE_SOURCE_ID,
    label: MARINE_SOURCE_LABEL,
    authority: 'official',
    url: marineUrl,
    observedAt: null,
  };

  const [marine, forecast] = await Promise.all([
    readEndpoint(marineUrl, MARINE_SOURCE_ID, fetchImpl),
    readEndpoint(forecastUrl, WEATHER_SOURCE_ID, fetchImpl),
  ]);

  if (!marine.data) {
    const empty = emptyMarineReading(coordinates);
    const offline = !isOnline();
    return {
      ...empty,
      status: offline ? 'offline' : 'unavailable',
      fetchedAt: null,
      error: marine.error,
    };
  }

  const fetchedAt = now().toISOString();
  const sea = normalizeMarineCurrent(marine.data as MarinePayload);
  const atmosphere = normalizeForecastCurrent((forecast.data ?? {}) as ForecastPayload);

  const hasData =
    sea.waveHeight !== null || sea.waveDirection !== null || sea.wavePeriod !== null;
  const status = resolveFreshness(fetchedAt, hasData, now(), isOnline());

  const reading = normalizeMarineSources(
    marine.data as MarinePayload,
    (forecast.data ?? {}) as ForecastPayload,
    source,
    fetchedAt,
    status,
    forecast.error
  );

  // If the sea state validated away, this must never read as live, and the
  // reason must be explicit so the UI can explain itself.
  if (!hasData) {
    return {
      ...reading,
      status: isOnline() ? 'unavailable' : 'offline',
      fetchedAt: null,
      error: reading.error ?? {
        kind: 'missing-fields',
        message: 'Source response contained no usable wave measurements',
        sourceId: MARINE_SOURCE_ID,
      },
    };
  }

  return reading;
}