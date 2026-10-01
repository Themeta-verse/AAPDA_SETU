/**
 * SHARED COASTAL OBSERVATION STORE.
 *
 * PROBLEM THIS SOLVES
 *
 * Before this module, `useWeatherData` and `useCoastalIntelligence` each ran
 * their own `setInterval` against the same two Open-Meteo endpoints, for two
 * slightly different coordinates, and `useCoastalIntelligence` additionally
 * re-fetched both URLs a second time inside the same cycle just to read
 * variables the first URL had never requested. That produced four requests per
 * cycle where two suffice, and it drove real HTTP 429 responses from the
 * Marine endpoint — which was observed live during development.
 *
 * WHAT IT DOES
 *
 * One module-level store, one request pair per cycle, many subscribers:
 *
 *   - SINGLE FLIGHT   concurrent `ensureFresh` callers share one in-flight
 *                     request instead of each starting their own.
 *   - TTL             a request is skipped while the cached payload is younger
 *                     than the refresh interval, so N mounted hooks cost 1
 *                     request, not N.
 *   - RATE LIMITING   an HTTP 429 opens a cooldown during which no request is
 *                     made. Not a retry loop — one attempt after the cooldown.
 *   - FRESHNESS AGING the store re-derives freshness on a timer, so a reading
 *                     ages into STALE and then UNAVAILABLE without a refetch.
 *
 * It also fixes a real dependency-injection bug: the previous code called
 * `fetch(url, deps)`, passing an `AdapterDeps` object as the `RequestInit`, so
 * an injected `fetchImpl` was silently ignored and tests could not stub it.
 */

import { useSyncExternalStore } from 'react';
import {
  buildForecastUrl,
  buildMarineUrl,
  emptyMarineReading,
  normalizeMarineCurrent,
  normalizeForecastCurrent,
  normalizeMarineHourly,
  MARINE_SOURCE_ID,
  WEATHER_SOURCE_ID,
  MARINE_SOURCE_LABEL,
  WEATHER_SOURCE_LABEL,
  readEndpoint,
} from './adapters/openMeteoMarine';
import {
  FORECAST_HORIZON_HOURS,
  normalizeForecast,
} from './adapters/openMeteoForecast';
import {
  FRESHNESS_TICK_MS,
  RATE_LIMIT_COOLDOWN_MS,
  resolveFreshness,
} from './adapters/freshness';
import type {
  Coordinates,
  NormalizedMarine,
  SourceError,
  SourceMetadata,
} from './adapters/types';
// The merged 48-hour shape is owned by the Forecast adapter, which is the layer
// that actually produces it. Re-exporting a duplicate declaration from
// `adapters/types` is what previously left this import unresolvable.
import type { NormalizedForecast } from './adapters/openMeteoForecast';

/** The single monitored point. Both hooks previously disagreed about this. */
export const MONITORED_COORDINATES: Coordinates = { latitude: 19.0988, longitude: 72.8267 };

/** How often the pair of endpoints is re-requested. */
export const OBSERVATION_REFRESH_MS = 10 * 60 * 1000;

function marineSourceMeta(coordinates: Coordinates): SourceMetadata {
  return {
    id: MARINE_SOURCE_ID,
    label: MARINE_SOURCE_LABEL,
    authority: 'official',
    url: buildMarineUrl(coordinates),
    observedAt: null,
  };
}

function weatherSourceMeta(coordinates: Coordinates): SourceMetadata {
  return {
    id: WEATHER_SOURCE_ID,
    label: WEATHER_SOURCE_LABEL,
    authority: 'official',
    url: buildForecastUrl(coordinates),
    observedAt: null,
  };
}

/**
 * Build the current-conditions reading from two already-fetched bodies.
 *
 * Pure: no network. This is the store's single-parse path so one request pair
 * yields both the headline reading and the 48-hour horizon.
 *
 * `fetchedAt` is null when the marine payload carried no usable wave
 * measurement, so a reading can never look current on the strength of a
 * successful HTTP status alone.
 */
function buildMarineReading(
  marineBody: unknown,
  weatherBody: unknown,
  coordinates: Coordinates,
  fetchedAt: string,
  now: Date,
  isOnline: boolean,
  marineError: SourceError | null,
  weatherError: SourceError | null
): NormalizedMarine {
  const source = marineSourceMeta(coordinates);
  const marinePayload = (marineBody ?? {}) as { current?: unknown; hourly?: unknown };

  const sea = normalizeMarineCurrent(marinePayload);
  const atmosphere = normalizeForecastCurrent((weatherBody ?? {}) as { current?: unknown });
  const hourly = normalizeMarineHourly(marinePayload);

  const hasSeaState =
    sea.waveHeight !== null || sea.waveDirection !== null || sea.wavePeriod !== null;

  const status = resolveFreshness(fetchedAt, hasSeaState, now, isOnline);

  if (!hasSeaState) {
    // No usable wave measurement: never LIVE, and say why. A transport or HTTP
    // failure is the more useful reason, so it is preferred over a generic
    // "missing fields" — otherwise a real HTTP 429 would be reported as if the
    // source had simply omitted a variable.
    return {
      ...emptyMarineReading(coordinates),
      status: isOnline ? 'unavailable' : 'offline',
      fetchedAt: null,
      error: marineError ?? {
        kind: 'missing-fields',
        message: 'Source response contained no usable wave measurements',
        sourceId: MARINE_SOURCE_ID,
      },
    };
  }

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
    hourly,
    ...atmosphere,
    error: weatherError,
  };
}

export interface CoastalObservations {
  /** Current sea state + atmosphere. `status` ages with the clock. */
  marine: NormalizedMarine;
  /** The merged 48-hour horizon. `status` ages with the clock. */
  forecast: NormalizedForecast;

  /** When the pair was last successfully parsed, ISO-8601, or null. */
  fetchedAt: string | null;
  /** When a request was last attempted, ISO-8601, or null. */
  lastAttemptedAt: string | null;
  /** HTTP status of a rate-limit response, when the last attempt was limited. */
  rateLimitHttpStatus: number | null;
  /** ISO timestamp until which no request will be made, when limited. */
  rateLimitedUntil: string | null;

  /** True while a request pair is in flight. Drives real loading UI. */
  isFetching: boolean;
  /** The first source error observed in the last cycle. */
  error: SourceError | null;

  marineUrl: string;
  weatherUrl: string;
}

function emptySnapshot(): CoastalObservations {
  const marineUrl = buildMarineUrl(MONITORED_COORDINATES);
  const weatherUrl = buildForecastUrl(MONITORED_COORDINATES);
  return {
    marine: {
      status: 'unavailable',
      fetchedAt: null,
      source: {
        id: 'open-meteo-marine',
        label: 'Open-Meteo Marine',
        authority: 'official',
        url: marineUrl,
        observedAt: null,
      },
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
      error: null,
    },
    forecast: {
      status: 'unavailable',
      marineStatus: 'unavailable',
      weatherStatus: 'unavailable',
      fetchedAt: null,
      hours: [],
      horizonHours: 48,
      rejectedCount: 0,
      utcOffsetSeconds: null,
      validFrom: null,
      validUntil: null,
      marineSource: {
        id: 'open-meteo-marine',
        label: 'Open-Meteo Marine',
        authority: 'official',
        url: marineUrl,
        observedAt: null,
      },
      weatherSource: {
        id: 'open-meteo-weather',
        label: 'Open-Meteo Forecast',
        authority: 'official',
        url: weatherUrl,
        observedAt: null,
      },
      error: null,
    },
    fetchedAt: null,
    lastAttemptedAt: null,
    rateLimitHttpStatus: null,
    rateLimitedUntil: null,
    isFetching: false,
    error: null,
    marineUrl,
    weatherUrl,
  };
}

type Listener = () => void;

let snapshot: CoastalObservations = emptySnapshot();
let listeners = new Set<Listener>();
let inFlight: Promise<void> | null = null;
/** Set when a cycle's payload is younger than this; suppresses redundant work. */
let freshUntilMs = 0;
let rateLimitedUntilMs = 0;

export function subscribeCoastalObservations(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startFreshnessTicker();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopFreshnessTicker();
  };
}

/**
 * Age the cached reading on a timer.
 *
 * Started when the first subscriber mounts and stopped when the last one
 * unmounts, so there is no interval running with nobody watching. The ticker
 * NEVER fetches — it only re-derives freshness, which is what makes a reading
 * decay from LIVE to STALE to UNAVAILABLE while the request count stays flat.
 */
let freshnessTicker: ReturnType<typeof setInterval> | null = null;

function startFreshnessTicker(): void {
  if (freshnessTicker !== null) return;
  freshnessTicker = setInterval(() => {
    const isOnlineFn = () =>
      typeof navigator === 'undefined' ? true : navigator.onLine;
    const next = rederiveFreshness(snapshot, new Date(), isOnlineFn());
    if (next !== snapshot) emit(next);
  }, FRESHNESS_TICK_MS);
}

function stopFreshnessTicker(): void {
  if (freshnessTicker === null) return;
  clearInterval(freshnessTicker);
  freshnessTicker = null;
}

export function getCoastalObservations(): CoastalObservations {
  return snapshot;
}

function emit(next: CoastalObservations) {
  snapshot = next;
  for (const listener of listeners) listener();
}

/**
 * Re-derive freshness against the current clock.
 *
 * This is what makes a reading age from LIVE to STALE to UNAVAILABLE without a
 * refetch, and it reuses the one freshness policy rather than inventing a
 * second age calculation.
 */
function rederiveFreshness(base: CoastalObservations, now: Date, isOnline: boolean): CoastalObservations {
  const marineHasData = base.marine.waveHeight !== null;
  const marineStatus = resolveFreshness(base.fetchedAt, marineHasData, now, isOnline);

  const forecastHasData = base.forecast.hours.length > 0;
  const forecastStatus = resolveFreshness(base.fetchedAt, forecastHasData, now, isOnline);
  const marineForecastStatus = resolveFreshness(
    base.fetchedAt,
    base.forecast.hours.some((h) => h.waveHeightM !== null),
    now,
    isOnline
  );
  const weatherForecastStatus = resolveFreshness(
    base.fetchedAt,
    base.forecast.hours.some((h) => h.windSpeedKmh !== null || h.precipitationMm !== null),
    now,
    isOnline
  );

  if (
    base.marine.status === marineStatus &&
    base.forecast.status === forecastStatus &&
    base.forecast.marineStatus === marineForecastStatus &&
    base.forecast.weatherStatus === weatherForecastStatus
  ) {
    return base;
  }

  return {
    ...base,
    marine: { ...base.marine, status: marineStatus },
    forecast: {
      ...base.forecast,
      status: forecastStatus,
      marineStatus: marineForecastStatus,
      weatherStatus: weatherForecastStatus,
    },
  };
}

/**
 * Fetch the endpoint pair once and derive BOTH current conditions and the
 * 48-hour horizon from those two responses.
 *
 * `fetchImpl` is threaded into the adapters correctly here — the previous code
 * passed an `AdapterDeps` object in the `RequestInit` slot, which meant an
 * injected fetcher was never used.
 */
async function runFetch(
  coordinates: Coordinates,
  fetchImpl: typeof fetch,
  nowFn: () => Date,
  isOnlineFn: () => boolean
): Promise<void> {
  const attemptedAt = nowFn().toISOString();
  const deps = { fetchImpl, now: nowFn, isOnline: isOnlineFn };

  emit({ ...snapshot, isFetching: true, lastAttemptedAt: attemptedAt });

  const marineUrl = buildMarineUrl(coordinates);
  const weatherUrl = buildForecastUrl(coordinates);

  /**
   * Read each endpoint EXACTLY ONCE, then derive both outputs from those two
   * bodies.
   *
   * Calling `fetchMarineReading` and `fetchForecastHorizon` here would be the
   * obvious-looking implementation and it is wrong: each of them fetches BOTH
   * URLs internally, so the cycle would issue four requests. That is precisely
   * the duplication that produced live HTTP 429 responses.
   */
  const [marine, weather] = await Promise.all([
    readEndpoint(marineUrl, MARINE_SOURCE_ID, fetchImpl),
    readEndpoint(weatherUrl, WEATHER_SOURCE_ID, fetchImpl),
  ]);

  const now = nowFn();
  const online = isOnlineFn();
  const fetchedAt = now.toISOString();

  const reading = buildMarineReading(
    marine.data,
    weather.data,
    coordinates,
    fetchedAt,
    now,
    online,
    marine.error,
    weather.error
  );

  const forecast = normalizeForecast(
    marine.data,
    weather.data,
    marineSourceMeta(coordinates),
    weatherSourceMeta(coordinates),
    fetchedAt,
    { horizonHours: FORECAST_HORIZON_HOURS, now, isOnline: online }
  );

  // A 429 from either endpoint is a real source error, and it opens a cooldown
  // so the next poll tick does not immediately re-hit a limiting source.
  const limited = [marine.error, weather.error].find(
    (e) => e?.kind === 'http' && e.httpStatus === 429
  );
  if (limited) {
    rateLimitedUntilMs = now.getTime() + RATE_LIMIT_COOLDOWN_MS;
  }

  const succeeded = reading.fetchedAt !== null || forecast.hours.length > 0;
  // A rate-limited cycle must NOT arm the TTL, or the cooldown would be
  // pointless: the cache would suppress the retry that should follow it.
  freshUntilMs = succeeded && !limited ? now.getTime() + OBSERVATION_REFRESH_MS : 0;

  const next: CoastalObservations = {
    marine: reading,
    forecast: {
      ...forecast,
      error: forecast.error ?? marine.error ?? weather.error ?? null,
    },
    fetchedAt: succeeded ? fetchedAt : null,
    lastAttemptedAt: attemptedAt,
    rateLimitHttpStatus: limited?.httpStatus ?? null,
    rateLimitedUntil: limited ? new Date(rateLimitedUntilMs).toISOString() : null,
    isFetching: false,
    error: reading.error ?? forecast.error ?? marine.error ?? weather.error ?? null,
    marineUrl,
    weatherUrl,
  };

  emit(rederiveFreshness(next, now, online));
}

/**
 * Fetch unless the cached payload is still fresh or we are rate-limited.
 *
 * Returns the in-flight promise when it joins an existing request, so several
 * mounted hooks mount to one network call.
 */
export function ensureFreshCoastalObservations(
  coordinates: Coordinates = MONITORED_COORDINATES,
  options: {
    fetchImpl?: typeof fetch;
    now?: () => Date;
    isOnline?: () => boolean;
    force?: boolean;
  } = {}
): Promise<void> {
  const nowFn = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const isOnlineFn = options.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  if (inFlight) return inFlight;

  const nowMs = nowFn().getTime();
  if (!options.force) {
    if (nowMs < rateLimitedUntilMs) return Promise.resolve();
    if (nowMs < freshUntilMs) return Promise.resolve();
  }

  inFlight = runFetch(coordinates, fetchImpl, nowFn, isOnlineFn).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Force a request, bypassing the TTL. Used by the manual refresh control. */
export function refreshCoastalObservations(
  coordinates: Coordinates = MONITORED_COORDINATES,
  options: { fetchImpl?: typeof fetch; now?: () => Date; isOnline?: () => boolean } = {}
): Promise<void> {
  return ensureFreshCoastalObservations(coordinates, { ...options, force: true });
}

/** Test seam: reset the module-level cache. */
export function resetCoastalObservationsForTests(): void {
  snapshot = emptySnapshot();
  listeners = new Set();
  inFlight = null;
  freshUntilMs = 0;
  rateLimitedUntilMs = 0;
}

/** True while a rate-limit cooldown is active, so callers can explain it. */
export function isRateLimited(now: () => Date = () => new Date()): boolean {
  return now().getTime() < rateLimitedUntilMs;
}

/**
 * Subscribe to the store and keep freshness aging.
 *
 * The interval only re-derives freshness; it does not fetch. Fetching is
 * driven by `ensureFreshCoastalObservations` on the refresh interval.
 */
export function useCoastalObservations(): CoastalObservations {
  return useSyncExternalStore(
    subscribeCoastalObservations,
    getCoastalObservations,
    getCoastalObservations
  );
}