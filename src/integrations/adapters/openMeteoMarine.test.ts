import { describe, it, expect } from 'vitest';
import {
  buildForecastUrl,
  buildMarineUrl,
  emptyMarineReading,
  fetchMarineReading,
  normalizeForecastCurrent,
  normalizeMarineCurrent,
  normalizeMarineHourly,
  normalizeMarineSources,
  type ForecastPayload,
  type MarinePayload,
} from './openMeteoMarine';
import { LIVE_MAX_AGE_MS, STALE_MAX_AGE_MS, resolveFreshness } from './freshness';
import type { Coordinates } from './types';

const COORDS: Coordinates = { latitude: 19.1075, longitude: 72.8263 };
const NOW = new Date('2026-09-30T14:00:00.000Z');

/** Minimal but realistic 200 marine payload, mirroring the live shape. */
function marineBody(overrides: Partial<MarinePayload> = {}) {
  return {
    latitude: 19.125,
    longitude: 72.79167,
    timezone: 'Asia/Kolkata',
    current_units: { time: 'iso8601', wave_height: 'm', wave_direction: '°', wave_period: 's' },
    current: { time: '2026-09-30T19:45', interval: 900, wave_height: 0.62, wave_direction: 231, wave_period: 9.4 },
    hourly_units: { time: 'iso8601', wave_height: 'm' },
    hourly: {
      time: ['2026-09-30T00:00', '2026-09-30T01:00', '2026-09-30T02:00'],
      wave_height: [0.8, 0.78, 0.76],
    },
    ...overrides,
  } as MarinePayload;
}

function forecastBody(overrides: Partial<ForecastPayload> = {}) {
  return {
    current: {
      time: '2026-09-30T19:45',
      temperature_2m: 29.6,
      wind_speed_10m: 3.4,
      wind_direction_10m: 16,
      weather_code: 0,
      surface_pressure: 1011.2,
      precipitation_probability: 18,
    },
    ...overrides,
  } as ForecastPayload;
}

/** Build a fetch stub that answers by URL substring. */
function stubFetch(routes: Record<string, () => Promise<Response> | Response>) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`Unexpected request: ${url}`);
    return routes[key]();
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const marineRoute = (body: () => unknown, status = 200) => () => jsonResponse(body(), status);

describe('URL construction', () => {
  it('requests the marine current and hourly wave fields for the given point', () => {
    const url = buildMarineUrl(COORDS);
    expect(url).toContain('latitude=19.1075');
    expect(url).toContain('longitude=72.8263');
    expect(url).toContain('current=wave_height,wave_direction,wave_period');
    expect(url).toContain('hourly=wave_height');
    expect(url).toContain('timezone=Asia%2FKolkata');
  });

  it('requests precipitation probability in the forecast current block', () => {
    expect(buildForecastUrl(COORDS)).toContain('precipitation_probability');
  });
});

describe('normalizeMarineCurrent', () => {
  it('normalizes a valid response into the marine model', () => {
    const result = normalizeMarineCurrent(marineBody());
    expect(result.waveHeight).toBe(0.62);
    expect(result.waveDirection).toBe(231);
    expect(result.wavePeriod).toBe(9.4);
    expect(result.observedAt).toBe('2026-09-30T19:45');
  });

  it('returns nulls rather than defaults when wave data is absent', () => {
    const result = normalizeMarineCurrent({ current: { time: '2026-09-30T19:45' } });
    expect(result.waveHeight).toBeNull();
    expect(result.waveDirection).toBeNull();
    expect(result.wavePeriod).toBeNull();
  });

  it('rejects out-of-range and non-numeric values instead of coercing them', () => {
    const result = normalizeMarineCurrent({
      current: { time: '2026-09-30T19:45', wave_height: -3, wave_direction: 999, wave_period: 'n/a' },
    });
    expect(result.waveHeight).toBeNull();
    expect(result.waveDirection).toBeNull();
    expect(result.wavePeriod).toBeNull();
  });

  it('rejects a NaN payload value', () => {
    const result = normalizeMarineCurrent({
      current: { time: '2026-09-30T19:45', wave_height: Number.NaN },
    });
    expect(result.waveHeight).toBeNull();
  });
});

describe('normalizeMarineHourly', () => {
  it('zips parallel time and wave_height arrays', () => {
    expect(normalizeMarineHourly(marineBody())).toEqual([
      { time: '2026-09-30T00:00', waveHeight: 0.8 },
      { time: '2026-09-30T01:00', waveHeight: 0.78 },
      { time: '2026-09-30T02:00', waveHeight: 0.76 },
    ]);
  });

  it('drops entries with null wave height instead of substituting zero', () => {
    const result = normalizeMarineHourly({
      hourly: {
        time: ['2026-09-30T00:00', '2026-09-30T01:00', '2026-09-30T02:00'],
        wave_height: [0.8, null, 0.76],
      },
    });
    expect(result).toEqual([
      { time: '2026-09-30T00:00', waveHeight: 0.8 },
      { time: '2026-09-30T02:00', waveHeight: 0.76 },
    ]);
  });

  it('truncates to the shorter array instead of inventing values', () => {
    const result = normalizeMarineHourly({
      hourly: {
        time: ['2026-09-30T00:00', '2026-09-30T01:00', '2026-09-30T02:00'],
        wave_height: [0.8, 0.78],
      },
    });
    expect(result).toHaveLength(2);
  });

  it('returns an empty series for a malformed hourly block', () => {
    expect(normalizeMarineHourly({ hourly: { time: 'not-an-array' } })).toEqual([]);
    expect(normalizeMarineHourly({})).toEqual([]);
  });
});

describe('normalizeForecastCurrent', () => {
  it('normalizes wind, rain, temperature and pressure', () => {
    const result = normalizeForecastCurrent(forecastBody());
    expect(result).toEqual({
      windSpeed: 3.4,
      windDirection: 16,
      rainProbability: 18,
      temperature: 29.6,
      pressure: 1011.2,
    });
  });

  it('returns nulls for a missing current block', () => {
    expect(normalizeForecastCurrent({})).toEqual({
      windSpeed: null,
      windDirection: null,
      rainProbability: null,
      temperature: null,
      pressure: null,
    });
  });

  it('rejects an out-of-range precipitation probability', () => {
    const result = normalizeForecastCurrent(
      forecastBody({ current: { precipitation_probability: 480 } })
    );
    expect(result.rainProbability).toBeNull();
  });
});

describe('fetchMarineReading', () => {
  it('returns a live normalized reading for a valid response', async () => {
    const fetchImpl = stubFetch({
      'marine-api.open-meteo.com': marineRoute(() => marineBody()),
      'api.open-meteo.com': marineRoute(() => forecastBody()),
    });

    const result = await fetchMarineReading(COORDS, {
      fetchImpl,
      now: () => NOW,
      isOnline: () => true,
    });

    expect(result.status).toBe('live');
    expect(result.waveHeight).toBe(0.62);
    expect(result.waveDirection).toBe(231);
    expect(result.wavePeriod).toBe(9.4);
    expect(result.windSpeed).toBe(3.4);
    expect(result.rainProbability).toBe(18);
    expect(result.hourly).toHaveLength(3);
    expect(result.fetchedAt).toBe(NOW.toISOString());
    expect(result.error).toBeNull();
    expect(result.source.id).toBe('open-meteo-marine');
    expect(result.source.authority).toBe('official');
    expect(result.source.url).toContain('marine-api.open-meteo.com');
    expect(result.source.observedAt).toBe('2026-09-30T19:45');
  });

  it('reports offline and no data when the network request fails while offline', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    const result = await fetchMarineReading(COORDS, {
      fetchImpl,
      now: () => NOW,
      isOnline: () => false,
    });

    expect(result.status).toBe('offline');
    expect(result.waveHeight).toBeNull();
    expect(result.hourly).toEqual([]);
    expect(result.fetchedAt).toBeNull();
    expect(result.error?.kind).toBe('network');
  });

  it('reports unavailable and no data when online but the request fails', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    const result = await fetchMarineReading(COORDS, {
      fetchImpl,
      now: () => NOW,
      isOnline: () => true,
    });

    expect(result.status).toBe('unavailable');
    expect(result.waveHeight).toBeNull();
    expect(result.error?.kind).toBe('network');
  });

  it('surfaces an HTTP failure without inventing values', async () => {
    const fetchImpl = stubFetch({
      'marine-api.open-meteo.com': marineRoute(() => ({ message: 'boom' }), 503),
      'api.open-meteo.com': marineRoute(() => forecastBody()),
    });

    const result = await fetchMarineReading(COORDS, {
      fetchImpl,
      now: () => NOW,
      isOnline: () => true,
    });

    expect(result.status).toBe('unavailable');
    expect(result.waveHeight).toBeNull();
    expect(result.error?.kind).toBe('http');
    expect(result.error?.httpStatus).toBe(503);
  });

  it('surfaces an explicit source error payload', async () => {
    const fetchImpl = stubFetch({
      'marine-api.open-meteo.com': marineRoute(
        () => ({ error: true, reason: 'Cannot initialize from invalid String' }),
        400
      ),
      'api.open-meteo.com': marineRoute(() => forecastBody()),
    });

    const result = await fetchMarineReading(COORDS, {
      fetchImpl,
      now: () => NOW,
      isOnline: () => true,
    });

    expect(result.status).toBe('unavailable');
    expect(result.error?.kind).toBe('http');
  });

  it('treats an unparseable body as malformed and never as live', async () => {
    const fetchImpl = stubFetch({
      'marine-api.open-meteo.com': () => new Response('<html>oops</html>', { status: 200 }),
      'api.open-meteo.com': marineRoute(() => forecastBody()),
    });

    const result = await fetchMarineReading(COORDS, {
      fetchImpl,
      now: () => NOW,
      isOnline: () => true,
    });

    expect(result.status).toBe('unavailable');
    expect(result.waveHeight).toBeNull();
    expect(result.error?.kind).toBe('malformed');
  });

  it('rejects a 200 response whose body is not an object', async () => {
    const fetchImpl = stubFetch({
      'marine-api.open-meteo.com': () => jsonResponse([1, 2, 3]),
      'api.open-meteo.com': marineRoute(() => forecastBody()),
    });

    const result = await fetchMarineReading(COORDS, {
      fetchImpl,
      now: () => NOW,
      isOnline: () => true,
    });

    expect(result.status).toBe('unavailable');
    expect(result.error?.kind).toBe('malformed');
  });

  it('refuses to report live when the body carries no usable wave fields', async () => {
    const fetchImpl = stubFetch({
      'marine-api.open-meteo.com': marineRoute(() => marineBody({ current: undefined, hourly: undefined })),
      'api.open-meteo.com': marineRoute(() => forecastBody()),
    });

    const result = await fetchMarineReading(COORDS, {
      fetchImpl,
      now: () => NOW,
      isOnline: () => true,
    });

    expect(result.status).toBe('unavailable');
    expect(result.waveHeight).toBeNull();
    expect(result.error?.kind).toBe('missing-fields');
  });

  it('keeps real sea state when only the forecast endpoint fails', async () => {
    const fetchImpl = stubFetch({
      'marine-api.open-meteo.com': marineRoute(() => marineBody()),
      'api.open-meteo.com': () => {
        throw new TypeError('Failed to fetch');
      },
    });

    const result = await fetchMarineReading(COORDS, {
      fetchImpl,
      now: () => NOW,
      isOnline: () => true,
    });

    expect(result.status).toBe('live');
    expect(result.waveHeight).toBe(0.62);
    expect(result.windSpeed).toBeNull();
    expect(result.rainProbability).toBeNull();
    expect(result.error?.sourceId).toBe('open-meteo-weather');
  });
});

describe('freshness', () => {
  // Ageing is a property of the policy, not of a single fetch, so it is
  // exercised against `resolveFreshness` directly. `useMonitoring` re-runs
  // this same function on every tick, which is how a retained reading ages.
  const now = new Date('2026-09-30T14:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('reports live within the live window', () => {
    expect(resolveFreshness(ago(LIVE_MAX_AGE_MS - 1000), true, now, true)).toBe('live');
  });

  it('reports stale past the live window but inside the stale window', () => {
    expect(resolveFreshness(ago(LIVE_MAX_AGE_MS + 60_000), true, now, true)).toBe('stale');
  });

  it('reports unavailable past the stale window', () => {
    expect(resolveFreshness(ago(STALE_MAX_AGE_MS + 60_000), true, now, true)).toBe('unavailable');
  });

  it('reports unavailable when there are no measurements, even if freshly fetched', () => {
    expect(resolveFreshness(now.toISOString(), false, now, true)).toBe('unavailable');
  });

  it('reports offline instead of unavailable when the browser is offline', () => {
    expect(resolveFreshness(null, false, now, false)).toBe('offline');
  });

  it('reports unavailable for an unparseable timestamp', () => {
    expect(resolveFreshness('not-a-date', true, now, true)).toBe('unavailable');
  });

  it('reports live for a payload fetched at exactly the live boundary', async () => {
    const fetchImpl = stubFetch({
      'marine-api.open-meteo.com': marineRoute(() => marineBody()),
      'api.open-meteo.com': marineRoute(() => forecastBody()),
    });

    const result = await fetchMarineReading(COORDS, {
      fetchImpl,
      now: () => now,
      isOnline: () => true,
    });
    expect(result.status).toBe('live');
  });

  it('never marks a null sea state as live regardless of timestamp', async () => {
    const fetchImpl = stubFetch({
      'marine-api.open-meteo.com': marineRoute(() => marineBody({ current: {}, hourly: undefined })),
      'api.open-meteo.com': marineRoute(() => forecastBody()),
    });

    const result = await fetchMarineReading(COORDS, {
      fetchImpl,
      now: () => NOW,
      isOnline: () => true,
    });
    expect(result.status).toBe('unavailable');
    expect(result.waveHeight).toBeNull();
  });
});

describe('normalizeMarineSources', () => {
  it('preserves source metadata and never fills absent fields', () => {
    const reading = normalizeMarineSources(
      { current: { time: '2026-09-30T19:45', wave_height: 1.2 } },
      {},
      {
        id: 'open-meteo-marine',
        label: 'Open-Meteo Marine',
        authority: 'official',
        url: buildMarineUrl(COORDS),
        observedAt: null,
      },
      '2026-09-30T14:00:00.000Z',
      'live',
      null
    );

    expect(reading.waveHeight).toBe(1.2);
    expect(reading.waveDirection).toBeNull();
    expect(reading.wavePeriod).toBeNull();
    expect(reading.windSpeed).toBeNull();
    expect(reading.pressure).toBeNull();
    expect(reading.hourly).toEqual([]);
    expect(reading.source.observedAt).toBe('2026-09-30T19:45');
  });
});

describe('emptyMarineReading', () => {
  it('produces a fully unavailable reading with no fabricated values', () => {
    const reading = emptyMarineReading(COORDS);
    expect(reading.status).toBe('unavailable');
    expect(reading.fetchedAt).toBeNull();
    expect(reading.waveHeight).toBeNull();
    expect(reading.windSpeed).toBeNull();
    expect(reading.rainProbability).toBeNull();
    expect(reading.temperature).toBeNull();
    expect(reading.pressure).toBeNull();
    expect(reading.hourly).toEqual([]);
    expect(reading.error).toBeNull();
  });
});