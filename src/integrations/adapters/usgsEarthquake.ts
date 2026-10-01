import { resolveFreshness } from './freshness';
import {
  EARTHQUAKE_RANGES,
  isRecord,
  normalizeTsunamiFlag,
  validateEpochMs,
  validateField,
  validateText,
} from './validation';
import type {
  AdapterDeps,
  Coordinates,
  NormalizedEarthquake,
  NormalizedEarthquakeFeed,
  SourceError,
  SourceMetadata,
} from './types';

/**
 * USGS Earthquake Hazards Program adapter.
 *
 * Source: the official USGS real-time GeoJSON feed, which USGS documents as a
 * programmatic interface and recommends for applications displaying recent
 * earthquakes.
 *   https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 *
 * This module owns transport, validation and normalisation only. It does not
 * render, does not decide risk, does not compute severity, and never
 * substitutes a value the feed did not publish.
 */

export const USGS_SOURCE_ID = 'usgs-earthquakes' as const;
export const USGS_SOURCE_LABEL = 'USGS Earthquake Hazards Program';

/** Official feed documentation, used as the human-facing provenance link. */
export const USGS_FEED_DOCS_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php';

const USGS_FEED_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary';

/**
 * Regional scope.
 *
 * PRESERVED FROM THE EXISTING PRODUCT, UNCHANGED. The previous hook selected
 * events inside a rectangular Indian Ocean bounding box. This is NOT a
 * distance-to-Mumbai calculation — it is a coarse rectangle, and a point
 * inside it can still be thousands of kilometres from Juhu.
 *
 * Coordinates used for the filter are always the event's own USGS-published
 * coordinates. Nothing is substituted or invented.
 */
export const INDIAN_OCEAN_BOUNDS = {
  latMin: -10,
  latMax: 25,
  lonMin: 40,
  lonMax: 100,
} as const;

/** Reference point for the product (Juhu Beach). Never used as event data. */
export const MONITORED_POINT: Coordinates = { latitude: 19.1075, longitude: 72.8263 };

/**
 * Summary feed windows, using the exact filenames USGS publishes at
 * /summary/<name>.geojson. These were verified live: an unrecognised name is
 * NOT a 404 — USGS answers HTTP 200 with the body "404 File Not Found", which
 * the adapter correctly classifies as `malformed`.
 */
export type UsgsFeedWindow = 'all_hour' | 'all_day' | 'all_week' | '2.5_day' | 'all_month';

export function buildUsgsFeedUrl(window: UsgsFeedWindow = 'all_day'): string {
  return `${USGS_FEED_BASE}/${window}.geojson`;
}

/** Region test using the event's real USGS coordinates. */
export function isInMonitoredRegion(
  latitude: number,
  longitude: number,
  bounds: typeof INDIAN_OCEAN_BOUNDS = INDIAN_OCEAN_BOUNDS
): boolean {
  return (
    latitude >= bounds.latMin &&
    latitude <= bounds.latMax &&
    longitude >= bounds.lonMin &&
    longitude <= bounds.lonMax
  );
}

/** Structural shapes accepted from the feed, exported for fixtures. */
export interface UsgsFeatureCollection {
  metadata?: unknown;
  features?: unknown;
}

function buildSource(url: string): SourceMetadata {
  return {
    id: USGS_SOURCE_ID,
    label: USGS_SOURCE_LABEL,
    authority: 'official',
    url,
    observedAt: null,
  };
}

export interface NormalizedFeatureResult {
  events: NormalizedEarthquake[];
  rejected: number;
}

/**
 * Normalize one GeoJSON Feature, or return null if it is structurally unusable.
 *
 * ADMISSIBILITY RULE (explicit, and tested):
 *   A feature is admitted only when it carries a usable `id` and a Point
 *   geometry with valid longitude and latitude. Those three values are the
 *   event's identity and physical location; without them the event cannot be
 *   keyed, filtered or displayed truthfully.
 *
 *   Every OTHER field is independently validated and may be `null`. A real
 *   event with a missing magnitude or place is still a real event, so it is
 *   kept with that field null rather than discarded or defaulted.
 *
 *   Malformed features are dropped individually; valid events in the same feed
 *   are preserved. This mirrors the marine adapter's hourly-series handling and
 *   keeps one bad record from discarding an entire real feed.
 */
export function normalizeFeature(
  feature: unknown,
  source: SourceMetadata
): NormalizedEarthquake | null {
  if (!isRecord(feature)) return null;

  const id = validateText(feature.id);
  if (!id) return null;

  const geometry = isRecord(feature.geometry) ? feature.geometry : null;
  if (!geometry || geometry.type !== 'Point') return null;

  const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
  if (!coordinates || coordinates.length < 3) return null;

  const longitude = validateField(coordinates[0], EARTHQUAKE_RANGES.longitude);
  const latitude = validateField(coordinates[1], EARTHQUAKE_RANGES.latitude);
  if (longitude === null || latitude === null) return null;

  const properties = isRecord(feature.properties) ? feature.properties : {};

  return {
    id,
    magnitude: validateField(properties.mag, EARTHQUAKE_RANGES.magnitude),
    place: validateText(properties.place),
    occurredAt: validateEpochMs(properties.time),
    updatedAt: validateEpochMs(properties.updated),
    longitude,
    latitude,
    depthKm: validateField(coordinates[2], EARTHQUAKE_RANGES.depthKm),
    tsunami: normalizeTsunamiFlag(properties.tsunami),
    alert: validateText(properties.alert),
    reviewStatus: validateText(properties.status),
    eventType: validateText(properties.type),
    eventUrl: validateText(properties.url),
    source,
    status: 'live',
    fetchedAt: null,
    error: null,
  };
}

/** Timestamp sort, descending. Events with no time sink to the end. */
function byNewest(a: NormalizedEarthquake, b: NormalizedEarthquake): number {
  if (a.occurredAt === null && b.occurredAt === null) return 0;
  if (a.occurredAt === null) return 1;
  if (b.occurredAt === null) return -1;
  return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
}

/**
 * Normalize a whole FeatureCollection.
 *
 * Returns null when the payload is not a usable FeatureCollection at all,
 * which the caller turns into a `malformed` error.
 */
export function normalizeFeatureCollection(
  payload: UsgsFeatureCollection,
  source: SourceMetadata
): NormalizedFeatureResult | null {
  if (!isRecord(payload)) return null;
  if (payload.type !== 'FeatureCollection') return null;

  const features = Array.isArray(payload.features) ? payload.features : null;
  if (!features) return null;

  const events: NormalizedEarthquake[] = [];
  let rejected = 0;

  for (const feature of features) {
    const event = normalizeFeature(feature, source);
    if (!event) {
      rejected += 1;
      continue;
    }
    events.push(event);
  }

  events.sort(byNewest);
  return { events, rejected };
}

/** Empty reading used as the hook's initial state and on total failure. */
export function emptyEarthquakeReading(url: string): NormalizedEarthquakeFeed {
  return {
    events: [],
    totalInFeed: 0,
    rejectedCount: 0,
    feedGeneratedAt: null,
    source: buildSource(url),
    status: 'unavailable',
    fetchedAt: null,
    error: null,
  };
}

/**
 * Fetch and normalize the USGS feed.
 *
 * Freshness note: `hasData` is whether the feed PARSED, not whether it
 * contained events. A quiet day is a valid live reading; an unreadable source
 * is not.
 */
export async function fetchEarthquakeFeed(
  options: { window?: UsgsFeedWindow; regionOnly?: boolean } = {},
  deps: AdapterDeps = {}
): Promise<NormalizedEarthquakeFeed> {
  // Default must be a filename USGS actually publishes. This previously
  // defaulted to `'day'`, which is not a member of `UsgsFeedWindow` and would
  // have produced `.../day.geojson` — a 404 — for any caller that relied on the
  // default. Existing callers passed `'all_day'` explicitly, which hid it.
  const { window: feedWindow = 'all_day', regionOnly = true } = options;
  const {
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  } = deps;

  const url = buildUsgsFeedUrl(feedWindow);
  const source = buildSource(url);

  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network request failed';
    return {
      ...emptyEarthquakeReading(url),
      status: isOnline() ? 'unavailable' : 'offline',
      error: { kind: 'network', message, sourceId: USGS_SOURCE_ID },
    };
  }

  if (!response.ok) {
    return {
      ...emptyEarthquakeReading(url),
      status: isOnline() ? 'unavailable' : 'offline',
      error: {
        kind: 'http',
        message: `USGS responded with HTTP ${response.status}`,
        httpStatus: response.status,
        sourceId: USGS_SOURCE_ID,
      },
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ...emptyEarthquakeReading(url),
      status: isOnline() ? 'unavailable' : 'offline',
      error: {
        kind: 'malformed',
        message: 'USGS response body is not valid JSON',
        sourceId: USGS_SOURCE_ID,
      },
    };
  }

  const normalized = normalizeFeatureCollection(
    body as UsgsFeatureCollection,
    source
  );

  if (!normalized) {
    return {
      ...emptyEarthquakeReading(url),
      status: isOnline() ? 'unavailable' : 'offline',
      error: {
        kind: 'malformed',
        message: 'USGS response was not a FeatureCollection with a features array',
        sourceId: USGS_SOURCE_ID,
      },
    };
  }

  const events = regionOnly
    ? normalized.events.filter((e) => isInMonitoredRegion(e.latitude, e.longitude))
    : normalized.events;

  const fetchedAt = now().toISOString();
  // The feed itself is the measurement, so it counts as data even when empty.
  const status = resolveFreshness(fetchedAt, true, now(), isOnline());

  const metadata = isRecord(body) && isRecord((body as UsgsFeatureCollection).metadata)
    ? ((body as UsgsFeatureCollection).metadata as Record<string, unknown>)
    : null;

  const feedGeneratedAt = metadata ? validateEpochMs(metadata.generated) : null;

  const stamped = events.map((event) => ({
    ...event,
    fetchedAt,
    source: { ...source, observedAt: event.occurredAt ?? feedGeneratedAt },
  }));

  return {
    events: stamped,
    totalInFeed: normalized.events.length,
    rejectedCount: normalized.rejected,
    feedGeneratedAt,
    source: { ...source, observedAt: feedGeneratedAt },
    status,
    fetchedAt,
    error: null,
  };
}

/**
 * Tri-state tsunami determination for the monitored region.
 *
 * true  -> at least one event carries USGS `tsunami: 1`
 * false -> the feed was readable and every matched event explicitly carried 0
 * null  -> the feed was unreadable, or a matched event had no usable flag, so
 *          the source cannot support a claim either way.
 *
 * Returning null matters: passing `false` for "we could not read the source"
 * would present a data outage as an all-clear.
 */
export function resolveTsunamiFlag(
  feed: NormalizedEarthquakeFeed,
  events: NormalizedEarthquake[] = feed.events
): boolean | null {
  if (feed.status === 'unavailable' || feed.status === 'offline') return null;
  if (events.length === 0) return false;
  if (events.some((e) => e.tsunami === true)) return true;
  if (events.some((e) => e.tsunami === null)) return null;
  return false;
}

export type { SourceError };