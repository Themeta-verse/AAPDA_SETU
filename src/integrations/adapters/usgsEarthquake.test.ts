import { describe, it, expect } from 'vitest';
import {
  buildUsgsFeedUrl,
  emptyEarthquakeReading,
  fetchEarthquakeFeed,
  isInMonitoredRegion,
  normalizeFeature,
  normalizeFeatureCollection,
  resolveTsunamiFlag,
  USGS_FEED_DOCS_URL,
  USGS_SOURCE_ID,
  USGS_SOURCE_LABEL,
  type UsgsFeatureCollection,
} from './usgsEarthquake';
import { EARTHQUAKE_RANGES, normalizeTsunamiFlag, validateEpochMs } from './validation';
import type { SourceMetadata } from './types';

const NOW = new Date('2026-09-30T14:00:00.000Z');

const SOURCE: SourceMetadata = {
  id: USGS_SOURCE_ID,
  label: USGS_SOURCE_LABEL,
  authority: 'official',
  url: buildUsgsFeedUrl('all_day'),
  observedAt: null,
};

/**
 * Fixtures are shaped from the live feed's real field names and types, which
 * were confirmed against https://earthquake.usgs.gov/earthquakes/feed/v1.0/
 * summary/all_month.geojson — in particular `time`/`updated` are integer epoch
 * milliseconds and `tsunami` is an integer 0/1, not a boolean.
 */
function feature(overrides: Record<string, unknown> = {}) {
  return {
    type: 'Feature',
    id: 'us7000abcd',
    properties: {
      mag: 6.1,
      place: '120 km SSW of Port Blair, India',
      time: 1_790_000_000_000,
      updated: 1_790_000_120_000,
      alert: 'green',
      status: 'reviewed',
      tsunami: 0,
      type: 'earthquake',
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd',
      ...(overrides.properties as object),
    },
    geometry: {
      type: 'Point',
      coordinates: [88.7, 10.4, 25.5],
      ...(overrides.geometry as object),
    },
    ...(overrides.top as object),
  };
}

function collection(features: unknown[], metadata: Record<string, unknown> = {}) {
  return {
    type: 'FeatureCollection',
    metadata: { generated: 1_790_000_500_000, count: features.length, ...metadata },
    features,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(handler: () => Promise<Response> | Response) {
  return handler as unknown as typeof fetch;
}

describe('endpoint construction', () => {
  it('builds the official USGS summary feed URL', () => {
    expect(buildUsgsFeedUrl('all_day')).toBe(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'
    );
  });

  it('uses the exact filenames USGS publishes', () => {
    // Verified live. An unrecognised name is not a 404: USGS answers HTTP 200
    // with the body "404 File Not Found", so a wrong name would otherwise be
    // silently swallowed.
    expect(buildUsgsFeedUrl('all_hour')).toContain('/summary/all_hour.geojson');
    expect(buildUsgsFeedUrl('all_week')).toContain('/summary/all_week.geojson');
    expect(buildUsgsFeedUrl('2.5_day')).toContain('/summary/2.5_day.geojson');
    expect(buildUsgsFeedUrl('all_month')).toContain('/summary/all_month.geojson');
  });

  it('points documentation at the official feed reference', () => {
    expect(USGS_FEED_DOCS_URL).toBe(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php'
    );
  });
});

describe('normalizeFeature — valid input', () => {
  it('normalizes every field from a well-formed feature', () => {
    const event = normalizeFeature(feature(), SOURCE);
    expect(event).not.toBeNull();
    expect(event!.id).toBe('us7000abcd');
    expect(event!.magnitude).toBe(6.1);
    expect(event!.place).toBe('120 km SSW of Port Blair, India');
    expect(event!.longitude).toBe(88.7);
    expect(event!.latitude).toBe(10.4);
    expect(event!.depthKm).toBe(25.5);
    expect(event!.tsunami).toBe(false);
    expect(event!.alert).toBe('green');
    expect(event!.reviewStatus).toBe('reviewed');
    expect(event!.eventType).toBe('earthquake');
    expect(event!.eventUrl).toBe(
      'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd'
    );
  });

  it('converts epoch-millisecond timestamps to ISO-8601', () => {
    const event = normalizeFeature(feature(), SOURCE)!;
    expect(event.occurredAt).toBe(new Date(1_790_000_000_000).toISOString());
    expect(event.updatedAt).toBe(new Date(1_790_000_120_000).toISOString());
  });

  it('accepts a negative magnitude without rejecting the event', () => {
    const event = normalizeFeature(
      feature({ properties: { mag: -1.4 } }),
      SOURCE
    );
    expect(event).not.toBeNull();
    expect(event!.magnitude).toBe(-1.4);
  });
});

describe('normalizeFeature — tsunami flag mapping', () => {
  it('maps tsunami = 1 to true', () => {
    expect(normalizeTsunamiFlag(1)).toBe(true);
  });

  it('maps tsunami = 0 to false', () => {
    expect(normalizeTsunamiFlag(0)).toBe(false);
  });

  it('does NOT convert a missing tsunami field to false', () => {
    expect(normalizeTsunamiFlag(undefined)).toBeNull();
    expect(normalizeTsunamiFlag(null)).toBeNull();
    expect(normalizeTsunamiFlag('')).toBeNull();
  });

  it('does NOT invent a flag for an unrecognised value', () => {
    expect(normalizeTsunamiFlag(2)).toBeNull();
    expect(normalizeTsunamiFlag('yes')).toBeNull();
    expect(normalizeTsunamiFlag(true)).toBeNull();
  });

  it('keeps a magnitude-6+ event with tsunami = 0 as false', () => {
    const event = normalizeFeature(
      feature({ properties: { mag: 7.8, tsunami: 0 } }),
      SOURCE
    )!;
    expect(event.magnitude).toBe(7.8);
    expect(event.tsunami).toBe(false);
  });

  it('keeps a sub-magnitude-6 event with tsunami = 1 as true', () => {
    // Live all_month feed: 8 of 10 tsunami:1 events are below M6. A
    // magnitude heuristic would have discarded every one of them.
    const event = normalizeFeature(
      feature({ properties: { mag: 5.2, tsunami: 1 } }),
      SOURCE
    )!;
    expect(event.magnitude).toBe(5.2);
    expect(event.tsunami).toBe(true);
  });

  it('leaves the flag null when the property is absent on the event', () => {
    const raw = feature();
    delete (raw.properties as Record<string, unknown>).tsunami;
    const event = normalizeFeature(raw, SOURCE)!;
    expect(event.tsunami).toBeNull();
  });

  it('accepts the numeric-string serialisation USGS sometimes emits', () => {
    expect(normalizeTsunamiFlag('1')).toBe(true);
    expect(normalizeTsunamiFlag('0')).toBe(false);
  });
});

describe('normalizeFeature — invalid data never becomes zero', () => {
  it('nulls a non-numeric magnitude instead of coercing it', () => {
    const event = normalizeFeature(feature({ properties: { mag: 'strong' } }), SOURCE)!;
    expect(event.magnitude).toBeNull();
  });

  it('nulls a NaN magnitude', () => {
    const event = normalizeFeature(
      feature({ properties: { mag: Number.NaN } }),
      SOURCE
    )!;
    expect(event.magnitude).toBeNull();
  });

  it('nulls a null magnitude while keeping the event', () => {
    const event = normalizeFeature(feature({ properties: { mag: null } }), SOURCE)!;
    expect(event.magnitude).toBeNull();
    expect(event.id).toBe('us7000abcd');
  });

  it('nulls a null place rather than showing an empty string', () => {
    const event = normalizeFeature(feature({ properties: { place: null } }), SOURCE)!;
    expect(event.place).toBeNull();
  });

  it('nulls an invalid event timestamp', () => {
    const event = normalizeFeature(feature({ properties: { time: 'yesterday' } }), SOURCE)!;
    expect(event.occurredAt).toBeNull();
  });

  it('nulls an out-of-bounds epoch timestamp', () => {
    // Beyond the year-2100 bound, and beyond MAX_SAFE_INTEGER, so it cannot
    // survive as a representable instant.
    const event = normalizeFeature(
      feature({ properties: { time: Number.MAX_SAFE_INTEGER } }),
      SOURCE
    )!;
    expect(event.occurredAt).toBeNull();
  });

  it('nulls an invalid depth without discarding the event', () => {
    const event = normalizeFeature(
      feature({ geometry: { coordinates: [88.7, 10.4, -9999] } }),
      SOURCE
    )!;
    expect(event.depthKm).toBeNull();
    expect(event.id).toBe('us7000abcd');
  });

  it('rejects impossible coordinates instead of clamping them', () => {
    const outOfRangeLon = normalizeFeature(
      feature({ geometry: { coordinates: [999, 10.4, 10] } }),
      SOURCE
    );
    const outOfRangeLat = normalizeFeature(
      feature({ geometry: { coordinates: [88.7, 91, 10] } }),
      SOURCE
    );
    expect(outOfRangeLon).toBeNull();
    expect(outOfRangeLat).toBeNull();
  });
});

describe('normalizeFeature — structural rejection', () => {
  it('rejects a feature without an id', () => {
    expect(normalizeFeature(feature({ top: { id: '' } }), SOURCE)).toBeNull();
  });

  it('rejects a non-Point geometry', () => {
    const event = normalizeFeature(
      feature({ geometry: { type: 'LineString' } }),
      SOURCE
    );
    expect(event).toBeNull();
  });

  it('rejects coordinates that are not a 3-element array', () => {
    const event = normalizeFeature(
      feature({ geometry: { coordinates: [88.7, 10.4] } }),
      SOURCE
    );
    expect(event).toBeNull();
  });

  it('rejects a feature that is not an object', () => {
    expect(normalizeFeature('nope', SOURCE)).toBeNull();
    expect(normalizeFeature(null, SOURCE)).toBeNull();
  });
});

describe('normalizeFeatureCollection', () => {
  it('returns null when the payload is not a FeatureCollection', () => {
    expect(normalizeFeatureCollection({ features: [] } as UsgsFeatureCollection, SOURCE)).toBeNull();
  });

  it('returns null when the features array is absent', () => {
    expect(
      normalizeFeatureCollection({ type: 'FeatureCollection' } as UsgsFeatureCollection, SOURCE)
    ).toBeNull();
  });

  it('drops a malformed feature but preserves the valid ones', () => {
    const result = normalizeFeatureCollection(
      collection([feature(), { type: 'Feature', id: 'broken' }, feature({ top: { id: 'us7000wxyz' } })]),
      SOURCE
    );
    expect(result).not.toBeNull();
    expect(result!.rejected).toBe(1);
    expect(result!.events).toHaveLength(2);
    expect(result!.events.map((e) => e.id).sort()).toEqual(['us7000abcd', 'us7000wxyz']);
  });

  it('orders events newest first', () => {
    const older = feature({
      top: { id: 'older' },
      properties: { time: 1_000_000_000_000 },
    });
    const newer = feature({
      top: { id: 'newer' },
      properties: { time: 1_700_000_000_000 },
    });
    const result = normalizeFeatureCollection(collection([older, newer]), SOURCE)!;
    expect(result.events.map((e) => e.id)).toEqual(['newer', 'older']);
  });

  it('accepts an empty features array as a valid, empty feed', () => {
    const result = normalizeFeatureCollection(collection([]), SOURCE);
    expect(result).not.toBeNull();
    expect(result!.events).toEqual([]);
    expect(result!.rejected).toBe(0);
  });
});

describe('regional filter', () => {
  it('accepts an event inside the monitored bounding box', () => {
    expect(isInMonitoredRegion(10.4, 88.7)).toBe(true);
  });

  it('rejects an event outside the monitored bounding box', () => {
    expect(isInMonitoredRegion(58.2, -155.1)).toBe(false);
  });

  it('uses the event coordinates from the feed, never a hardcoded location', () => {
    const inside = normalizeFeatureCollection(
      collection([feature({ geometry: { coordinates: [72.8267, 19.1075, 10] } })]),
      SOURCE
    )!;
    const outside = normalizeFeatureCollection(
      collection([feature({ geometry: { coordinates: [-155.1, 58.2, 10] } })]),
      SOURCE
    )!;
    // Filtering happens later in the adapter; normalisation must keep both.
    expect(inside.events[0].latitude).toBe(19.1075);
    expect(outside.events[0].latitude).toBe(58.2);
  });
});

describe('fetchEarthquakeFeed — success', () => {
  it('parses a valid feed and stamps provenance', async () => {
    const fetchImpl = stubFetch(() => jsonResponse(collection([feature()])));
    const result = await fetchEarthquakeFeed({ window: 'all_day' }, {
      fetchImpl,
      now: () => NOW,
      isOnline: () => true,
    });

    expect(result.status).toBe('live');
    expect(result.error).toBeNull();
    expect(result.fetchedAt).toBe(NOW.toISOString());
    expect(result.feedGeneratedAt).toBe(new Date(1_790_000_500_000).toISOString());
    expect(result.totalInFeed).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.source.id).toBe('usgs-earthquakes');
    expect(result.source.authority).toBe('official');
    expect(result.source.label).toBe('USGS Earthquake Hazards Program');
    expect(result.source.url).toContain('earthquake.usgs.gov/earthquakes/feed/');
  });

  it('stamps fetchedAt onto every event and preserves the event URL', async () => {
    const fetchImpl = stubFetch(() => jsonResponse(collection([feature()])));
    const result = await fetchEarthquakeFeed({}, { fetchImpl, now: () => NOW, isOnline: () => true });
    expect(result.events[0].fetchedAt).toBe(NOW.toISOString());
    expect(result.events[0].source.observedAt).toBe(result.events[0].occurredAt);
    expect(result.events[0].eventUrl).toContain('eventpage/us7000abcd');
  });

  it('applies the regional filter by default and reports the full feed size', async () => {
    const inside = feature({ top: { id: 'in' }, geometry: { coordinates: [88.7, 10.4, 25] } });
    const outside = feature({ top: { id: 'out' }, geometry: { coordinates: [-155.1, 58.2, 25] } });
    const fetchImpl = stubFetch(() => jsonResponse(collection([inside, outside])));

    const result = await fetchEarthquakeFeed({}, { fetchImpl, now: () => NOW, isOnline: () => true });
    expect(result.totalInFeed).toBe(2);
    expect(result.events.map((e) => e.id)).toEqual(['in']);
  });

  it('can return the unfiltered feed when asked', async () => {
    const inside = feature({ top: { id: 'in' }, geometry: { coordinates: [88.7, 10.4, 25] } });
    const outside = feature({ top: { id: 'out' }, geometry: { coordinates: [-155.1, 58.2, 25] } });
    const fetchImpl = stubFetch(() => jsonResponse(collection([inside, outside])));

    const result = await fetchEarthquakeFeed({ regionOnly: false }, { fetchImpl, now: () => NOW, isOnline: () => true });
    expect(result.events).toHaveLength(2);
  });

  it('treats a readable but empty feed as live, not unavailable', async () => {
    const fetchImpl = stubFetch(() => jsonResponse(collection([])));
    const result = await fetchEarthquakeFeed({}, { fetchImpl, now: () => NOW, isOnline: () => true });

    // A quiet day is a real reading. Reporting "unavailable" would imply the
    // source had broken.
    expect(result.status).toBe('live');
    expect(result.events).toEqual([]);
    expect(result.error).toBeNull();
  });
});

describe('fetchEarthquakeFeed — failure modes', () => {
  it('reports offline on a network failure while offline, with no events', async () => {
    const fetchImpl = stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const result = await fetchEarthquakeFeed({}, { fetchImpl, now: () => NOW, isOnline: () => false });

    expect(result.status).toBe('offline');
    expect(result.events).toEqual([]);
    expect(result.fetchedAt).toBeNull();
    expect(result.error?.kind).toBe('network');
  });

  it('reports unavailable on a network failure while online', async () => {
    const fetchImpl = stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const result = await fetchEarthquakeFeed({}, { fetchImpl, now: () => NOW, isOnline: () => true });

    expect(result.status).toBe('unavailable');
    expect(result.error?.kind).toBe('network');
  });

  it('preserves HTTP status information on an HTTP failure', async () => {
    const fetchImpl = stubFetch(() => new Response('Service Unavailable', { status: 503 }));
    const result = await fetchEarthquakeFeed({}, { fetchImpl, now: () => NOW, isOnline: () => true });

    expect(result.status).toBe('unavailable');
    expect(result.events).toEqual([]);
    expect(result.error?.kind).toBe('http');
    expect(result.error?.httpStatus).toBe(503);
  });

  it('reports malformed on unparseable JSON', async () => {
    const fetchImpl = stubFetch(() => new Response('<html>not json</html>', { status: 200 }));
    const result = await fetchEarthquakeFeed({}, { fetchImpl, now: () => NOW, isOnline: () => true });

    expect(result.status).toBe('unavailable');
    expect(result.events).toEqual([]);
    expect(result.error?.kind).toBe('malformed');
  });

  it('reports malformed when the body is valid JSON but not a FeatureCollection', async () => {
    const fetchImpl = stubFetch(() => jsonResponse({ earthquakes: [] }));
    const result = await fetchEarthquakeFeed({}, { fetchImpl, now: () => NOW, isOnline: () => true });

    expect(result.status).toBe('unavailable');
    expect(result.events).toEqual([]);
    expect(result.error?.kind).toBe('malformed');
  });

  it('does not accept a 200 response whose body is USGS "404 File Not Found"', async () => {
    // Observed live: requesting an unpublished feed name returns HTTP 200
    // with Content-Type text/plain and that literal body. Treating a 200 as
    // sufficient would let a dead endpoint look like a quiet earthquake day.
    const fetchImpl = stubFetch(
      () => new Response('404 File Not Found', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    );
    const result = await fetchEarthquakeFeed({}, { fetchImpl, now: () => NOW, isOnline: () => true });

    expect(result.status).toBe('unavailable');
    expect(result.events).toEqual([]);
    expect(result.fetchedAt).toBeNull();
    expect(result.error?.kind).toBe('malformed');
  });

  it('never fabricates an earthquake to cover a failure', async () => {
    const fetchImpl = stubFetch(() => new Response('boom', { status: 500 }));
    const result = await fetchEarthquakeFeed({}, { fetchImpl, now: () => NOW, isOnline: () => true });

    expect(result.events).toEqual([]);
    expect(result.totalInFeed).toBe(0);
    expect(result.fetchedAt).toBeNull();
  });
});

describe('resolveTsunamiFlag', () => {
  const feedWith = (events: ReturnType<typeof normalizeFeatureCollection>) =>
    ({
      ...emptyEarthquakeReading(buildUsgsFeedUrl('all_day')),
      status: 'live' as const,
      events: events!.events,
    });

  const withTsunami = normalizeFeatureCollection(
    collection([feature({ properties: { tsunami: 1 } })]),
    SOURCE
  )!;

  const allClear = normalizeFeatureCollection(
    collection([feature({ properties: { tsunami: 0 } })]),
    SOURCE
  )!;

  const oneUnknown = normalizeFeatureCollection(
    collection([
      feature({ top: { id: 'a' }, properties: { tsunami: 0 } }),
      (() => {
        const raw = feature({ top: { id: 'b' }, properties: { tsunami: 0 } });
        delete (raw.properties as Record<string, unknown>).tsunami;
        return raw;
      })(),
    ]),
    SOURCE
  )!;

  it('returns true when any event carries the USGS tsunami flag', () => {
    expect(resolveTsunamiFlag(feedWith(withTsunami))).toBe(true);
  });

  it('returns false when every matched event explicitly reports 0', () => {
    expect(resolveTsunamiFlag(feedWith(allClear))).toBe(false);
  });

  it('returns null when a matched event has no usable flag', () => {
    expect(resolveTsunamiFlag(feedWith(oneUnknown))).toBeNull();
  });

  it('returns null when the source could not be read', () => {
    const failed = { ...emptyEarthquakeReading(buildUsgsFeedUrl('all_day')), status: 'unavailable' as const };
    expect(resolveTsunamiFlag(failed)).toBeNull();
  });

  it('returns null when offline rather than claiming no tsunami', () => {
    const offline = { ...emptyEarthquakeReading(buildUsgsFeedUrl('all_day')), status: 'offline' as const };
    expect(resolveTsunamiFlag(offline)).toBeNull();
  });

  it('returns false for a readable feed with no events in the region', () => {
    expect(resolveTsunamiFlag(feedWith(normalizeFeatureCollection(collection([]), SOURCE)!))).toBe(false);
  });
});

describe('validation helpers', () => {
  it('rejects epoch values outside the bounded range', () => {
    expect(validateEpochMs(-1)).toBeNull();
    expect(validateEpochMs(4_102_444_800_001)).toBeNull();
    expect(validateEpochMs(Number.NaN)).toBeNull();
    expect(validateEpochMs(null)).toBeNull();
  });

  it('accepts numeric-string epoch values from the feed', () => {
    expect(validateEpochMs('1790000000000')).toBe(new Date(1_790_000_000_000).toISOString());
  });

  it('keeps the earthquake range wide enough for real seismicity', () => {
    expect(EARTHQUAKE_RANGES.magnitude.min).toBeLessThan(-1);
    expect(EARTHQUAKE_RANGES.magnitude.max).toBeGreaterThanOrEqual(9.5);
    expect(EARTHQUAKE_RANGES.longitude).toEqual({ min: -180, max: 180 });
    expect(EARTHQUAKE_RANGES.latitude).toEqual({ min: -90, max: 90 });
  });
});

describe('emptyEarthquakeReading', () => {
  it('produces an unavailable reading containing no fabricated values', () => {
    const empty = emptyEarthquakeReading(buildUsgsFeedUrl('all_day'));
    expect(empty.status).toBe('unavailable');
    expect(empty.fetchedAt).toBeNull();
    expect(empty.events).toEqual([]);
    expect(empty.totalInFeed).toBe(0);
    expect(empty.rejectedCount).toBe(0);
    expect(empty.feedGeneratedAt).toBeNull();
    expect(empty.error).toBeNull();
    expect(empty.source.id).toBe('usgs-earthquakes');
  });
});