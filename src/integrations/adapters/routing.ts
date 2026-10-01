/**
 * Real road routing via OSRM.
 *
 * ===================================================================
 * WHY THIS EXISTS
 * ===================================================================
 *
 * The previous evacuation map drew a straight SVG line between two invented
 * percentage positions and presented it as an "evacuation route". A straight
 * line is not a route: it crosses walls, compounds, water and rail lines, and it
 * ignores every one-way street in Mumbai. Presenting it as navigable guidance
 * was the single most misleading thing in the previous UI.
 *
 * This module requests an actual drivable route and returns the actual geometry,
 * distance and duration. If OSRM cannot route, the caller is told so and shows a
 * failure state. There is no straight-line fallback anywhere in this file,
 * because a fallback is exactly the fabrication this replaces.
 *
 * OSRM's `duration` is a free-flow estimate that knows nothing about live
 * traffic, so it is exposed as an estimate and labelled as one in the UI.
 */

import { distanceMetres, isValidCoordinate, type LatLon } from '@/lib/geo';

const ENDPOINT = 'https://router.project-osrm.org';

export type RouteStatus = 'ok' | 'no-route' | 'unreachable' | 'invalid-input';

export interface RouteLeg {
  /** Ordered `[longitude, latitude]` pairs, as GeoJSON specifies. */
  coordinates: [number, number][];
  distanceM: number;
  /** Free-flow estimate in seconds. Not a live-traffic arrival time. */
  durationS: number;
}

export interface RouteResult {
  status: RouteStatus;
  leg: RouteLeg | null;
  /** Great-circle distance, for comparing candidates before routing. */
  straightLineM: number | null;
  error: string | null;
  /** True when OSRM found no drivable path between the two points. */
  noRouteFound: boolean;
  service: 'osrm';
  sourceUrl: string | null;
}

interface OsrmResponse {
  code?: string;
  routes?: {
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][]; type?: string };
  }[];
  message?: string;
}

function failure(status: RouteStatus, error: string, extra: Partial<RouteResult> = {}): RouteResult {
  return {
    status,
    leg: null,
    straightLineM: null,
    error,
    noRouteFound: false,
    service: 'osrm',
    sourceUrl: null,
    ...extra,
  };
}

/**
 * Calculate a driving route between two real coordinates.
 *
 * The `overview=full` parameter is required: `simplified` would return a coarse
 * polyline that visibly cuts corners, which for evacuation guidance is worse
 * than no line at all.
 */
export async function calculateRoute(
  from: LatLon,
  to: LatLon,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RouteResult> {
  const { fetchImpl = fetch, timeoutMs = 25000 } = options;

  if (!isValidCoordinate(from) || !isValidCoordinate(to)) {
    return failure(
      'invalid-input',
      'A route needs two real coordinates. One of them was missing or out of range, ' +
        'so no route was calculated.',
    );
  }

  const straightLineM = distanceMetres(from, to);
  const waypointPair = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
  const path = `/route/v1/driving/${waypointPair}?overview=full&geometries=geojson&steps=false`;
  const url = `${ENDPOINT}${path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'BayWatch-Coastal-Alerts/1.0 (educational disaster-awareness)' },
      signal: controller.signal,
    });

    if (!response.ok) {
      return failure(
        'unreachable',
        `The routing service answered HTTP ${response.status}, so no route could be calculated. ` +
          'This is not a statement that the destination is unreachable on the ground.',
      );
    }

    const payload = (await response.json()) as OsrmResponse;

    if (payload.code === 'NoRoute') {
      return failure(
        'no-route',
        'The routing service found no drivable road between your position and this destination. ' +
          'It may be reachable on foot but not by car, or the road may be closed.',
        { straightLineM, noRouteFound: true, sourceUrl: url },
      );
    }

    if (payload.code && payload.code !== 'Ok') {
      return failure(
        'unreachable',
        `The routing service reported "${payload.code}"${
          payload.message ? `: ${payload.message}` : ''
        }, so no route could be calculated.`,
        { straightLineM, sourceUrl: url },
      );
    }

    const route = payload.routes?.[0];
    const geometry = route?.geometry?.coordinates;
    const distance = route?.distance;
    const duration = route?.duration;

    if (
      !route ||
      !Array.isArray(geometry) ||
      geometry.length < 2 ||
      typeof distance !== 'number' ||
      typeof duration !== 'number'
    ) {
      return failure(
        'unreachable',
        'The routing service replied without a usable route geometry, so no route is shown ' +
          'rather than approximating one with a straight line.',
        { straightLineM, sourceUrl: url },
      );
    }

    return {
      status: 'ok',
      leg: {
        // GeoJSON order is [lon, lat]; Leaflet expects the same, so no swap here.
        coordinates: geometry,
        distanceM: distance,
        durationS: duration,
      },
      straightLineM,
      error: null,
      noRouteFound: false,
      service: 'osrm',
      sourceUrl: url,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return failure(
      'unreachable',
      aborted
        ? 'The routing service did not respond within 25 seconds, so no route is shown.'
        : `The routing service could not be reached: ${
            error instanceof Error ? error.message : String(error)
          }. No route is shown rather than approximating one with a straight line.`,
      { straightLineM },
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A link the user can open in a real navigation application.
 *
 * Offered as a convenience only. It is never presented as the route this app
 * calculated, and the on-screen route remains the OSRM geometry.
 */
export function externalDirectionsUrl(from: LatLon, to: LatLon): string | null {
  if (!isValidCoordinate(from) || !isValidCoordinate(to)) return null;
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${from.latitude}%2C${from.longitude}%3B${to.latitude}%2C${to.longitude}`;
}
