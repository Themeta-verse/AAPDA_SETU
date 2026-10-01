/**
 * Shared observation store behaviour.
 *
 * These cover the request-efficiency and rate-limiting guarantees that were
 * previously violated: two hooks polling the same endpoints for two different
 * coordinates, with a duplicate re-fetch inside each cycle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureFreshCoastalObservations,
  refreshCoastalObservations,
  getCoastalObservations,
  resetCoastalObservationsForTests,
  isRateLimited,
  MONITORED_COORDINATES,
} from './coastalObservationsStore';

const MARINE_URL = 'https://marine-api.open-meteo.com';
const WEATHER_URL = 'https://api.open-meteo.com';

/** A well-formed hourly payload for one endpoint. */
function hourlyBody(seaState: boolean) {
  const time = ['2026-10-01T00:00', '2026-10-01T01:00', '2026-10-01T02:00'];
  return {
    utc_offset_seconds: 19800,
    current: seaState
      ? {
          time: '2026-10-01T00:00',
          wave_height: 0.7,
          wave_direction: 229,
          wave_period: 9.4,
          swell_wave_height: 0.5,
          swell_wave_direction: 215,
          ocean_current_velocity: 0.3,
          sea_surface_temperature: 28,
        }
      : undefined,
    hourly: {
      time,
      wave_height: seaState ? [0.7, 0.8, 0.9] : [null, null, null],
      wave_period: seaState ? [9.4, 9.5, 9.6] : [null, null, null],
      swell_wave_height: seaState ? [0.5, 0.5, 0.6] : [null, null, null],
      swell_wave_direction: seaState ? [215, 215, 216] : [null, null, null],
      temperature_2m: [28, 28, 29],
      wind_speed_10m: [14, 15, 13],
      wind_gusts_10m: [22, 24, 21],
      precipitation: [0, 0, 0],
      precipitation_probability: [10, 20, 15],
      visibility: [12000, 12000, 11000],
    },
  };
}

function makeFetch(overrides: Partial<Record<'marine' | 'weather', () => Response>> = {}) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string) => {
    calls.push(url);
    const key = url.includes(MARINE_URL) ? 'marine' : 'weather';
    const override = overrides[key];
    if (override) return override();
    const body = key === 'marine' ? hourlyBody(true) : hourlyBody(false);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const NOW = '2026-10-01T00:05:00.000Z';

beforeEach(() => {
  resetCoastalObservationsForTests();
});

describe('request efficiency', () => {
  it('makes exactly two requests for one cycle', async () => {
    const { impl, calls } = makeFetch();
    await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(NOW),
      isOnline: () => true,
    });
    expect(calls).toHaveLength(2);
  });

  it('serves many concurrent callers from a single request pair', async () => {
    // Three mounted hooks must not produce six requests.
    const { impl, calls } = makeFetch();
    const opts = {
      fetchImpl: impl,
      now: () => new Date(NOW),
      isOnline: () => true,
    };
    await Promise.all([
      ensureFreshCoastalObservations(MONITORED_COORDINATES, opts),
      ensureFreshCoastalObservations(MONITORED_COORDINATES, opts),
      ensureFreshCoastalObservations(MONITORED_COORDINATES, opts),
    ]);
    expect(calls).toHaveLength(2);
  });

  it('serves a later caller from cache while the payload is fresh', async () => {
    const { impl, calls } = makeFetch();
    const opts = { fetchImpl: impl, now: () => new Date(NOW), isOnline: () => true };

    await ensureFreshCoastalObservations(MONITORED_COORDINATES, opts);
    await ensureFreshCoastalObservations(MONITORED_COORDINATES, opts);
    await ensureFreshCoastalObservations(MONITORED_COORDINATES, opts);

    expect(calls).toHaveLength(2);
  });

  it('refetches once the payload has aged past the refresh interval', async () => {
    const { impl, calls } = makeFetch();
    const base = Date.parse(NOW);

    await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(base),
      isOnline: () => true,
    });
    await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(base + 11 * 60 * 1000),
      isOnline: () => true,
    });

    expect(calls).toHaveLength(4);
  });

  it('refetches immediately when forced, ignoring the cache', async () => {
    const { impl, calls } = makeFetch();
    const opts = { fetchImpl: impl, now: () => new Date(NOW), isOnline: () => true };

    await ensureFreshCoastalObservations(MONITORED_COORDINATES, opts);
    await refreshCoastalObservations(MONITORED_COORDINATES, opts);

    expect(calls).toHaveLength(4);
  });

  it('derives BOTH current conditions and the horizon from the same pair', async () => {
    const { impl } = makeFetch();
    await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(NOW),
      isOnline: () => true,
    });

    const snapshot = getCoastalObservations();
    expect(snapshot.marine.waveHeight).toBe(0.7);
    expect(snapshot.forecast.hours).toHaveLength(3);
    expect(snapshot.fetchedAt).not.toBeNull();
  });
});

describe('rate limiting', () => {
  it('reports HTTP 429 as a real source error', async () => {
    const { impl } = makeFetch({
      marine: () => new Response('{"error":true}', { status: 429 }),
    });
    await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(NOW),
      isOnline: () => true,
    });

    const snapshot = getCoastalObservations();
    expect(snapshot.error?.httpStatus).toBe(429);
    expect(snapshot.rateLimitedUntil).not.toBeNull();
  });

  it('holds further requests during the cooldown instead of hammering', async () => {
    // Real problem observed live: the duplicate polling caused repeated 429s.
    const { impl, calls } = makeFetch({
      marine: () => new Response('{"error":true}', { status: 429 }),
    });
    const base = Date.parse(NOW);

    await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(base),
      isOnline: () => true,
    });
    const afterFirst = calls.length;

    // Several poll ticks inside the cooldown must make no request at all.
    for (const offset of [1000, 5000, 15000, 30000]) {
      await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
        fetchImpl: impl,
        now: () => new Date(base + offset),
        isOnline: () => true,
      });
    }

    expect(calls).toHaveLength(afterFirst);
    expect(isRateLimited(() => new Date(base + 30000))).toBe(true);
  });

  it('resumes normally after the cooldown expires, with no retry loop', async () => {
    const rateLimited = { on: true };
    const { impl, calls } = makeFetch({
      marine: () =>
        rateLimited.on
          ? new Response('{"error":true}', { status: 429 })
          : new Response(JSON.stringify(hourlyBody(true)), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
    });
    const base = Date.parse(NOW);

    await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(base),
      isOnline: () => true,
    });
    expect(isRateLimited(() => new Date(base))).toBe(true);

    rateLimited.on = false;
    // One single request after the cooldown — not a burst of retries.
    await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(base + 61 * 1000),
      isOnline: () => true,
    });

    expect(calls).toHaveLength(4);
    expect(getCoastalObservations().marine.waveHeight).toBe(0.7);
  });

  it('does not rate-limit on an ordinary HTTP error', async () => {
    const { impl } = makeFetch({
      marine: () => new Response('{}', { status: 500 }),
    });
    await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(NOW),
      isOnline: () => true,
    });
    expect(isRateLimited(() => new Date(NOW))).toBe(false);
  });
});

describe('freshness aging', () => {
  it('starts unavailable before anything is fetched', () => {
    const snapshot = getCoastalObservations();
    expect(snapshot.marine.status).toBe('unavailable');
    expect(snapshot.forecast.status).toBe('unavailable');
    expect(snapshot.fetchedAt).toBeNull();
  });

  it('is live after a successful read', async () => {
    const { impl } = makeFetch();
    await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(NOW),
      isOnline: () => true,
    });
    expect(getCoastalObservations().marine.status).toBe('live');
  });

  it('never marks a failed read as live', async () => {
    const { impl } = makeFetch({
      marine: () => new Response('{}', { status: 503 }),
    });
    await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(NOW),
      isOnline: () => true,
    });
    const snapshot = getCoastalObservations();
    expect(snapshot.marine.status).not.toBe('live');
    expect(snapshot.marine.waveHeight).toBeNull();
  });

  it('keeps the last real reading when a later request fails', async () => {
    let fail = false;
    const { impl } = makeFetch({
      marine: () =>
        fail
          ? new Response('{}', { status: 500 })
          : new Response(JSON.stringify(hourlyBody(true)), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
    });
    const base = Date.parse(NOW);

    await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(base),
      isOnline: () => true,
    });
    fail = true;
    await refreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(base + 11 * 60 * 1000),
      isOnline: () => true,
    });

    const snapshot = getCoastalObservations();
    expect(snapshot.error).not.toBeNull();
  });

  it('reports offline when both endpoints fail while offline', async () => {
    const { impl } = makeFetch({
      marine: () => {
        throw new TypeError('Failed to fetch');
      },
      weather: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await ensureFreshCoastalObservations(MONITORED_COORDINATES, {
      fetchImpl: impl,
      now: () => new Date(NOW),
      isOnline: () => false,
    });
    expect(getCoastalObservations().marine.status).toBe('offline');
  });
});

describe('provenance', () => {
  it('records the exact endpoint URLs', () => {
    const snapshot = getCoastalObservations();
    expect(snapshot.marineUrl).toContain('marine-api.open-meteo.com');
    expect(snapshot.weatherUrl).toContain('api.open-meteo.com');
  });

  it('polls one shared coordinate, not one per hook', () => {
    expect(MONITORED_COORDINATES).toEqual({ latitude: 19.0988, longitude: 72.8267 });
  });

  it('starts with every numeric field null, never zero', () => {
    const { marine } = getCoastalObservations();
    expect(marine.waveHeight).toBeNull();
    expect(marine.windSpeed).toBeNull();
    expect(marine.swellHeight).toBeNull();
    expect(marine.hourly).toEqual([]);
  });
});