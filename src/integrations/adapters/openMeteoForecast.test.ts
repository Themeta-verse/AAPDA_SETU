/**
 * Forecast pipeline behaviour tests.
 *
 * These assert OBSERVABLE BEHAVIOUR of the normalization layer: what the
 * pipeline does with a real payload shape, a truncated payload, a malformed
 * payload, an HTTP failure. They deliberately avoid asserting on source-code
 * strings.
 */

import { describe, it, expect } from 'vitest';
import {
  FORECAST_HORIZON_HOURS,
  buildMarineHourlyUrl,
  buildWeatherHourlyUrl,
  emptyNormalizedForecast,
  fetchForecastHorizon,
  joinForecastHours,
  normalizeForecast,
  toUtcEpochMs,
  type NormalizedForecast,
} from './openMeteoForecast';
import type { SourceMetadata } from './types';

const COORDS = { latitude: 19.0988, longitude: 72.8267 };
const IST = 19800;

const marineSource: SourceMetadata = {
  id: 'open-meteo-marine',
  label: 'Open-Meteo Marine',
  authority: 'official',
  url: buildMarineHourlyUrl(COORDS),
  observedAt: null,
};
const weatherSource: SourceMetadata = {
  id: 'open-meteo-weather',
  label: 'Open-Meteo Forecast',
  authority: 'official',
  url: buildWeatherHourlyUrl(COORDS),
  observedAt: null,
};

/** Build a realistic hourly payload with `n` hours from `start`. */
function hours(n: number, startHour = 0, day = 1) {
  const times: string[] = [];
  for (let i = 0; i < n; i++) {
    const h = startHour + i;
    const d = day + Math.floor(h / 24);
    times.push(`2026-10-${String(d).padStart(2, '0')}T${String(h % 24).padStart(2, '0')}:00`);
  }
  return times;
}

function marineBody(n: number, over: Partial<Record<string, unknown>> = {}) {
  const times = hours(n);
  return {
    utc_offset_seconds: IST,
    hourly: {
      time: times,
      wave_height: times.map((_, i) => 0.6 + i * 0.01),
      wave_period: times.map(() => 9.4),
      swell_wave_height: times.map(() => 0.4),
      swell_wave_direction: times.map(() => 220),
    },
    ...over,
  };
}

function weatherBody(n: number, over: Partial<Record<string, unknown>> = {}) {
  const times = hours(n);
  return {
    utc_offset_seconds: IST,
    hourly: {
      time: times,
      temperature_2m: times.map(() => 28),
      wind_speed_10m: times.map(() => 14),
      wind_gusts_10m: times.map(() => 22),
      precipitation: times.map(() => 0),
      precipitation_probability: times.map(() => 10),
      visibility: times.map(() => 12000),
    },
    ...over,
  };
}

function normalize(
  marine: unknown,
  weather: unknown,
  options: Partial<Parameters<typeof normalizeForecast>[5]> = {}
): NormalizedForecast {
  return normalizeForecast(marine, weather, marineSource, weatherSource, '2026-10-01T00:05:00.000Z', {
    now: new Date('2026-10-01T00:05:00.000Z'),
    isOnline: true,
    ...options,
  });
}

// =====================================================================
describe('URL construction', () => {
  it('requests the hourly block on BOTH endpoints', () => {
    // The original defect: buildForecastUrl requested only `current`, so the
    // hourly forecast timeline could never populate.
    expect(buildWeatherHourlyUrl(COORDS)).toContain('hourly=');
    expect(buildMarineHourlyUrl(COORDS)).toContain('hourly=');
  });

  it('requests the wave fields the timeline actually renders', () => {
    const url = buildMarineHourlyUrl(COORDS);
    expect(url).toContain('wave_height');
    expect(url).toContain('wave_period');
    expect(url).toContain('swell_wave_height');
    expect(url).toContain('swell_wave_direction');
  });

  it('requests the atmosphere fields the timeline actually renders', () => {
    const url = buildWeatherHourlyUrl(COORDS);
    for (const field of [
      'temperature_2m',
      'wind_speed_10m',
      'wind_gusts_10m',
      'precipitation',
      'precipitation_probability',
      'visibility',
    ]) {
      expect(url).toContain(field);
    }
  });

  it('asks for enough days to fill a 48-hour horizon', () => {
    // Three days = 72 hours, so 48 can be carved out after part of today.
    expect(buildMarineHourlyUrl(COORDS)).toContain('forecast_days=3');
    expect(buildWeatherHourlyUrl(COORDS)).toContain('forecast_days=3');
  });

  it('pins the timezone so source timestamps are Indian Standard Time', () => {
    expect(buildMarineHourlyUrl(COORDS)).toContain('timezone=Asia%2FKolkata');
    expect(buildWeatherHourlyUrl(COORDS)).toContain('timezone=Asia%2FKolkata');
  });

  it('uses the monitored coordinates', () => {
    expect(buildMarineHourlyUrl(COORDS)).toContain('latitude=19.0988');
    expect(buildMarineHourlyUrl(COORDS)).toContain('longitude=72.8267');
  });

  it('keeps the two endpoints distinct', () => {
    expect(buildMarineHourlyUrl(COORDS)).toContain('marine-api.open-meteo.com');
    expect(buildWeatherHourlyUrl(COORDS)).toContain('api.open-meteo.com');
  });
});

// =====================================================================
describe('timezone conversion', () => {
  it('recovers the true UTC instant from an offset-less source string', () => {
    // 2026-10-01T14:00 in IST (+05:30) is 08:30 UTC.
    expect(toUtcEpochMs('2026-10-01T14:00', IST)).toBe(
      Date.parse('2026-10-01T08:30:00.000Z')
    );
  });

  it('agrees with the ISO string the pipeline publishes', () => {
    const { hours: out } = joinForecastHours(
      marineBody(1).hourly as never,
      weatherBody(1).hourly as never,
      IST
    );
    expect(out[0].isoTime).toBe('2026-09-30T18:30:00.000Z');
  });

  it('returns null for an unparseable timestamp rather than NaN', () => {
    expect(toUtcEpochMs('not-a-time', IST)).toBeNull();
  });

  it('handles the half-hour offset correctly', () => {
    // 19800s = 5h30m, not 5h. A whole-hour assumption would be wrong by 30 min.
    expect(toUtcEpochMs('2026-10-01T00:00', IST)).toBe(
      Date.parse('2026-09-30T18:30:00.000Z')
    );
  });
});

// =====================================================================
describe('joining marine and weather hours', () => {
  it('merges both endpoints onto one timeline', () => {
    const { hours: out } = joinForecastHours(
      marineBody(3).hourly as never,
      weatherBody(3).hourly as never,
      IST
    );
    expect(out).toHaveLength(3);
    expect(out[0].waveHeightM).toBeCloseTo(0.6);
    expect(out[0].windSpeedKmh).toBe(14);
  });

  it('keys on the timestamp, not the array index', () => {
    // The weather payload starts two hours LATER than the marine payload.
    // Index-zipping would pair marine hour 0 with weather hour 0 (a different
    // clock time). Keying on the timestamp must not.
    const marine = marineBody(3);
    const weather = weatherBody(3, {});
    weather.hourly.time = hours(3, 2);
    weather.hourly.wind_speed_10m = [111, 222, 333];

    const { hours: out } = joinForecastHours(
      marine.hourly as never,
      weather.hourly as never,
      IST
    );
    expect(out.map((h) => h.time)).toEqual([
      '2026-10-01T00:00',
      '2026-10-01T01:00',
      '2026-10-01T02:00',
      '2026-10-01T03:00',
      '2026-10-01T04:00',
    ]);
    // 02:00 must get 111 (its own hour), not 0.
    const at2 = out.find((h) => h.time === '2026-10-01T02:00')!;
    expect(at2.windSpeedKmh).toBe(111);
    const at0 = out.find((h) => h.time === '2026-10-01T00:00')!;
    expect(at0.windSpeedKmh).toBeNull();
  });

  it('keeps an hour present in only one payload, leaving the other side null', () => {
    const marine = marineBody(2);
    const weather = weatherBody(2);
    weather.hourly.time = hours(1, 5);

    const { hours: out } = joinForecastHours(
      marine.hourly as never,
      weather.hourly as never,
      IST
    );
    const marineOnly = out.find((h) => h.time === '2026-10-01T00:00')!;
    expect(marineOnly.waveHeightM).not.toBeNull();
    expect(marineOnly.windSpeedKmh).toBeNull();
  });

  it('returns hours in strict chronological order', () => {
    const marine = marineBody(4);
    // Present the arrays in a shuffled order.
    marine.hourly.time = ['2026-10-01T03:00', '2026-10-01T00:00', '2026-10-01T02:00', '2026-10-01T01:00'];

    const { hours: out } = joinForecastHours(marine.hourly as never, null, IST);
    const epochs = out.map((h) => h.epochMs);
    expect(epochs).toEqual([...epochs].sort((a, b) => a - b));
  });

  it('never emits a duplicate hour', () => {
    const marine = marineBody(3);
    marine.hourly.time = ['2026-10-01T00:00', '2026-10-01T00:00', '2026-10-01T01:00'];
    marine.hourly.wave_height = [1, 2, 3];

    const { hours: out } = joinForecastHours(marine.hourly as never, null, IST);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((h) => h.epochMs)).size).toBe(2);
  });

  it('drops unparseable timestamps and counts them as rejected', () => {
    const marine = marineBody(3);
    marine.hourly.time = ['2026-10-01T00:00', 'garbage', '2026-10-01T02:00'];

    const { hours: out, rejected } = joinForecastHours(marine.hourly as never, null, IST);
    expect(out).toHaveLength(2);
    expect(rejected).toBe(1);
  });

  it('returns an empty list for a missing hourly block', () => {
    const { hours: out } = joinForecastHours(null, null, IST);
    expect(out).toEqual([]);
  });

  it('returns an empty list when the time array is not an array', () => {
    const { hours: out } = joinForecastHours({ time: 'nope' } as never, null, IST);
    expect(out).toEqual([]);
  });

  it('never pads or extends a short payload', () => {
    const { hours: out } = joinForecastPoints(5);
    expect(out).toHaveLength(5);
  });
});

function joinForecastPoints(n: number) {
  return joinForecastHours(marineBody(n).hourly as never, weatherBody(n).hourly as never, IST);
}

// =====================================================================
describe('nullable values', () => {
  it('turns an explicit null in the payload into null, never 0', () => {
    const marine = marineBody(2);
    marine.hourly.wave_height = [0, null];

    const { hours: out } = joinForecastPoints(2);
    const joined = joinForecastHours(marine.hourly as never, weatherBody(2).hourly as never, IST);
    expect(joined.hours[0].waveHeightM).toBe(0);
    expect(joined.hours[1].waveHeightM).toBeNull();
    expect(out[0].waveHeightM).not.toBeNull();
  });

  it('rejects a negative wave height rather than accepting it', () => {
    const marine = marineBody(2);
    marine.hourly.wave_height = [-1, 1];
    const { hours: out } = joinForecastHours(marine.hourly as never, null, IST);
    expect(out[0].waveHeightM).toBeNull();
    expect(out[1].waveHeightM).toBe(1);
  });

  it('rejects a non-numeric value', () => {
    const marine = marineBody(2);
    marine.hourly.wave_height = ['high', 1] as unknown as number[];
    const { hours: out } = joinForecastHours(marine.hourly as never, null, IST);
    expect(out[0].waveHeightM).toBeNull();
  });

  it('rejects NaN and Infinity', () => {
    const marine = marineBody(3);
    marine.hourly.wave_height = [NaN, Infinity, 1.2];
    const { hours: out } = joinForecastHours(marine.hourly as never, null, IST);
    expect(out[0].waveHeightM).toBeNull();
    expect(out[1].waveHeightM).toBeNull();
    expect(out[2].waveHeightM).toBe(1.2);
  });

  it('rejects a wind speed beyond the plausible range', () => {
    const weather = weatherBody(2);
    weather.hourly.wind_speed_10m = [9999, 14];
    const { hours: out } = joinForecastHours(null, weather.hourly as never, IST);
    expect(out[0].windSpeedKmh).toBeNull();
    expect(out[1].windSpeedKmh).toBe(14);
  });

  it('rejects a precipitation probability above 100', () => {
    const weather = weatherBody(2);
    weather.hourly.precipitation_probability = [180, 40];
    const { hours: out } = joinForecastHours(null, weather.hourly as never, IST);
    expect(out[0].precipitationProbabilityPct).toBeNull();
    expect(out[1].precipitationProbabilityPct).toBe(40);
  });

  it('produces no NaN anywhere in a fully populated horizon', () => {
    const { hours: out } = joinForecastPoints(10);
    for (const hour of out) {
      for (const value of Object.values(hour)) {
        if (typeof value === 'number') expect(Number.isNaN(value)).toBe(false);
      }
    }
  });
});

// =====================================================================
describe('48-hour horizon', () => {
  it('caps the horizon at 48 hours', () => {
    const { hours: out } = joinForecastHours(
      marineBody(72).hourly as never,
      weatherBody(72).hourly as never,
      IST,
      { horizonHours: FORECAST_HORIZON_HOURS }
    );
    expect(out).toHaveLength(48);
  });

  it('reports a shorter real horizon rather than manufacturing hours', () => {
    const forecast = normalize(marineBody(12), weatherBody(12));
    expect(forecast.hours).toHaveLength(12);
    expect(forecast.horizonHours).toBe(FORECAST_HORIZON_HOURS);
  });

  it('reports zero hours as unavailable, not as a full horizon', () => {
    const marine = marineBody(0);
    const weather = weatherBody(0);
    const forecast = normalize(marine, weather);
    expect(forecast.hours).toHaveLength(0);
    expect(forecast.status).toBe('unavailable');
  });

  it('records the published validity window from real timestamps', () => {
    const forecast = normalize(marineBody(6), weatherBody(6));
    expect(forecast.validFrom).toBe('2026-09-30T18:30:00.000Z');
    expect(forecast.validUntil).toBe(new Date(toUtcEpochMs('2026-10-01T05:00', IST)!).toISOString());
  });

  it('drops hours before the start instant', () => {
    const { hours: out } = joinForecastHours(
      marineBody(6).hourly as never,
      weatherBody(6).hourly as never,
      IST,
      { startEpochMs: toUtcEpochMs('2026-10-01T03:00', IST)! }
    );
    expect(out.map((h) => h.time)).toEqual([
      '2026-10-01T03:00',
      '2026-10-01T04:00',
      '2026-10-01T05:00',
    ]);
  });
});

// =====================================================================
describe('freshness', () => {
  it('is live for a freshly fetched populated horizon', () => {
    expect(normalize(marineBody(4), weatherBody(4)).status).toBe('live');
  });

  it('ages into stale as the clock advances past the live window', () => {
    const later = new Date(Date.parse('2026-10-01T00:05:00.000Z') + 20 * 60 * 1000);
    const forecast = normalize(marineBody(4), weatherBody(4), { now: later });
    expect(forecast.status).toBe('stale');
  });

  it('ages into unavailable past the stale window', () => {
    const later = new Date(Date.parse('2026-10-01T00:05:00.000Z') + 3 * 60 * 60 * 1000);
    const forecast = normalize(marineBody(4), weatherBody(4), { now: later });
    expect(forecast.status).toBe('unavailable');
  });

  it('reports offline only when there is no data to show', () => {
    // Policy: `offline` explains why data is absent. A reading taken seconds
    // ago is still current even if connectivity then dropped, so it stays
    // `live` and the UI reports the connectivity separately.
    const fresh = normalize(marineBody(4), weatherBody(4), { isOnline: false });
    expect(fresh.status).toBe('live');
  });

  it('reports offline when offline AND nothing was ever fetched', () => {
    const forecast = normalize(null, null, { isOnline: false });
    expect(forecast.status).toBe('offline');
  });

  it('is never live when nothing was fetched', () => {
    const forecast = normalizeForecast(marineBody(4), weatherBody(4), marineSource, weatherSource, null, {
      now: new Date(),
      isOnline: true,
    });
    expect(forecast.status).toBe('unavailable');
  });

  it('tracks marine and weather freshness separately', () => {
    // Marine succeeded; the weather endpoint answered but published no usable
    // atmospheric values at all.
    const weather = weatherBody(4);
    weather.hourly.wind_speed_10m = [null, null, null, null];
    weather.hourly.precipitation = [null, null, null, null];
    weather.hourly.precipitation_probability = [null, null, null, null];
    weather.hourly.wind_gusts_10m = [null, null, null, null];
    weather.hourly.temperature_2m = [null, null, null, null];
    weather.hourly.visibility = [null, null, null, null];

    const forecast = normalize(marineBody(4), weather);
    expect(forecast.marineStatus).toBe('live');
    expect(forecast.weatherStatus).toBe('unavailable');
    // One dead endpoint must not blank the whole horizon.
    expect(forecast.status).toBe('live');
  });
});

// =====================================================================
describe('error payloads', () => {
  it('never reports live when both payloads are null', () => {
    const forecast = normalize(null, null);
    expect(forecast.status).toBe('unavailable');
    expect(forecast.hours).toHaveLength(0);
  });

  it('ignores a payload with an error flag rather than reading its fields', () => {
    const broken = { error: true, reason: 'Parameter invalid', hourly: { time: hours(3) } };
    const forecast = normalize(broken, weatherBody(3));
    // Marine contributes nothing; weather still serves real hours.
    expect(forecast.hours).toHaveLength(3);
    expect(forecast.hours.every((h) => h.waveHeightM === null)).toBe(true);
  });

  it('treats a non-array hourly block as absent', () => {
    const forecast = normalize({ hourly: { time: 'nope' } }, weatherBody(3));
    expect(forecast.hours).toHaveLength(3);
    expect(forecast.hours[0].waveHeightM).toBeNull();
  });

  it('survives a payload whose value arrays are shorter than its time array', () => {
    const marine = marineBody(5);
    marine.hourly.wave_height = [1, 2];
    const { hours: out, rejected } = joinForecastHours(marine.hourly as never, null, IST);
    expect(out).toHaveLength(5);
    expect(out[0].waveHeightM).toBe(1);
    expect(out[1].waveHeightM).toBe(2);
    expect(out[2].waveHeightM).toBeNull();
    expect(rejected).toBe(0);
  });

  it('produces a fully-null horizon from a payload of all nulls', () => {
    const marine = marineBody(3);
    marine.hourly.wave_height = [null, null, null];
    const { hours: out } = joinForecastHours(marine.hourly as never, null, IST);
    expect(out).toHaveLength(3);
    expect(out.every((h) => h.waveHeightM === null)).toBe(true);
  });

  it('exposes an empty, honest default', () => {
    const empty = emptyNormalizedForecast(marineSource, weatherSource);
    expect(empty.hours).toEqual([]);
    expect(empty.status).toBe('unavailable');
    expect(empty.fetchedAt).toBeNull();
    expect(empty.rejectedCount).toBe(0);
  });
});

// =====================================================================
describe('transport failures', () => {
  function mockFetch(impl: (url: string) => Promise<Response>) {
    return vi.fn(impl) as unknown as typeof fetch;
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('reports a network failure without inventing hours', async () => {
    const forecast = await fetchForecastHorizon(COORDS, {
      fetchImpl: mockFetch(async () => {
        throw new TypeError('Failed to fetch');
      }),
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      isOnline: () => true,
    });
    expect(forecast.hours).toHaveLength(0);
    expect(forecast.status).toBe('unavailable');
    expect(forecast.error?.kind).toBe('network');
  });

  it('reports offline when the network fails while the device is offline', async () => {
    const forecast = await fetchForecastHorizon(COORDS, {
      fetchImpl: mockFetch(async () => {
        throw new TypeError('Failed to fetch');
      }),
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      isOnline: () => false,
    });
    expect(forecast.marineStatus).toBe('offline');
    expect(forecast.weatherStatus).toBe('offline');
  });

  it('treats HTTP 429 as a real source error, not as empty data', async () => {
    const forecast = await fetchForecastHorizon(COORDS, {
      fetchImpl: mockFetch(async (url) =>
        url.includes('marine-api')
          ? json({ error: true }, 429)
          : json(weatherBody(4))
      ),
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      isOnline: () => true,
    });
    expect(forecast.error?.kind).toBe('http');
    expect(forecast.error?.httpStatus).toBe(429);
  });

  it('keeps the other endpoint\'s real hours when one is rate-limited', async () => {
    const forecast = await fetchForecastHorizon(COORDS, {
      fetchImpl: mockFetch(async (url) =>
        url.includes('marine-api') ? json({}, 429) : json(weatherBody(4))
      ),
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      isOnline: () => true,
    });
    expect(forecast.hours).toHaveLength(4);
    expect(forecast.hours.every((h) => h.waveHeightM === null)).toBe(true);
    expect(forecast.weatherStatus).toBe('live');
  });

  it('reports HTTP 500 as an http error', async () => {
    const forecast = await fetchForecastHorizon(COORDS, {
      fetchImpl: mockFetch(async () => json({}, 500)),
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      isOnline: () => true,
    });
    expect(forecast.error?.httpStatus).toBe(500);
    expect(forecast.hours).toHaveLength(0);
  });

  it('reports malformed JSON without crashing', async () => {
    const forecast = await fetchForecastHorizon(COORDS, {
      fetchImpl: mockFetch(async () => new Response('<html>not json</html>', { status: 200 })),
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      isOnline: () => true,
    });
    expect(forecast.error?.kind).toBe('malformed');
    expect(forecast.hours).toHaveLength(0);
  });

  it('reports a non-object body as malformed', async () => {
    const forecast = await fetchForecastHorizon(COORDS, {
      fetchImpl: mockFetch(async () => new Response('"a string"', { status: 200 })),
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      isOnline: () => true,
    });
    expect(forecast.error?.kind).toBe('malformed');
  });

  it('surfaces an explicit source-error payload', async () => {
    const forecast = await fetchForecastHorizon(COORDS, {
      fetchImpl: mockFetch(async () => json({ error: true, reason: 'Latitude must be in -90..90' })),
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      isOnline: () => true,
    });
    expect(forecast.error?.kind).toBe('source-error');
    expect(forecast.error?.message).toContain('Latitude');
  });

  it('makes exactly two requests, one per endpoint', async () => {
    const spy = mockFetch(async () => json(marineBody(2)));
    await fetchForecastHorizon(COORDS, {
      fetchImpl: spy,
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      isOnline: () => true,
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('carries the exact source URLs into provenance', async () => {
    const forecast = await fetchForecastHorizon(COORDS, {
      fetchImpl: mockFetch(async () => json(marineBody(2))),
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      isOnline: () => true,
    });
    expect(forecast.marineSource.url).toContain('marine-api.open-meteo.com');
    expect(forecast.weatherSource.url).toContain('api.open-meteo.com');
  });
});