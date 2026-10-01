/**
 * Evacuation routing and destination discovery.
 *
 * The behaviour these tests protect is honesty under failure. The previous
 * implementation invented two "safe zones" at hardcoded percentage positions and
 * drew straight lines to them, so the specific things guarded here are:
 *
 *   - a routing failure never becomes a straight line
 *   - an unreachable data service never becomes "no facilities found"
 *   - a facility is never labelled a shelter unless a source said so
 *   - an unnamed facility is never rendered as a nameless dot
 */

import { describe, it, expect, vi } from 'vitest';
import { calculateRoute, externalDirectionsUrl } from './routing';
import { fetchCandidateFacilities, facilityKindLabel } from './safeShelters';

const JUHU = { latitude: 19.0988, longitude: 72.8267 };
const COOPER = { latitude: 19.076, longitude: 72.841 };

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe('calculateRoute', () => {
  it('returns the real geometry, distance and duration from OSRM', async () => {
    const coordinates: [number, number][] = [
      [72.8272, 19.0989],
      [72.83, 19.09],
      [72.8386, 19.0833],
    ];
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 'Ok',
        routes: [{ distance: 3724.6, duration: 298.5, geometry: { coordinates } }],
      }),
    );

    const result = await calculateRoute(JUHU, COOPER, { fetchImpl });

    expect(result.status).toBe('ok');
    expect(result.leg?.distanceM).toBe(3724.6);
    expect(result.leg?.durationS).toBe(298.5);
    // The real polyline, not a two-point straight line.
    expect(result.leg?.coordinates).toHaveLength(3);
    expect(result.noRouteFound).toBe(false);
  });

  it('requests full geometry so the line does not visibly cut corners', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 'Ok',
        routes: { distance: 1, duration: 1, geometry: { coordinates: [[0, 0], [1, 1]] } },
      }),
    );
    await calculateRoute(JUHU, COOPER, { fetchImpl });
    expect(String(fetchImpl.mock.calls[0][0])).toContain('overview=full');
  });

  it('never substitutes a straight line when routing fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await calculateRoute(JUHU, COOPER, { fetchImpl });

    expect(result.status).toBe('unreachable');
    // The critical assertion: no geometry at all.
    expect(result.leg).toBeNull();
    expect(result.error).toMatch(/straight line/);
  });

  it('reports an HTTP failure without a route', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    const result = await calculateRoute(JUHU, COOPER, { fetchImpl });

    expect(result.status).toBe('unreachable');
    expect(result.leg).toBeNull();
    // It must not imply the destination is unreachable on the ground.
    expect(result.error).toMatch(/not a statement that the destination is unreachable/i);
  });

  it('distinguishes "no drivable road" from "service failed"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 'NoRoute' }));
    const result = await calculateRoute(JUHU, COOPER, { fetchImpl });

    expect(result.status).toBe('no-route');
    expect(result.noRouteFound).toBe(true);
    // The straight line is still reported, but as a comparison, not as a route.
    expect(result.leg).toBeNull();
    expect(result.straightLineM).toBeGreaterThan(0);
  });

  it('refuses to route without two real coordinates', async () => {
    const fetchImpl = vi.fn();

    const missing = await calculateRoute(JUHU, { latitude: NaN, longitude: 0 }, { fetchImpl });
    expect(missing.status).toBe('invalid-input');
    expect(missing.leg).toBeNull();

    // Critically, it does not even attempt the request.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a malformed geometry rather than rendering a broken line', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: 'Ok', routes: { distance: 1, duration: 1, geometry: {} } }));

    const result = await calculateRoute(JUHU, COOPER, { fetchImpl });
    expect(result.leg).toBeNull();
    expect(result.error).toMatch(/without a usable route geometry/);
  });

  it('builds a real directions URL only from valid coordinates', () => {
    expect(externalDirectionsUrl(JUHU, COOPER)).toContain('directions');
    expect(externalDirectionsUrl(JUHU, { latitude: NaN, longitude: 0 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Candidate facilities
// ---------------------------------------------------------------------------

describe('fetchCandidateFacilities', () => {
  const element = (over: Record<string, unknown> = {}) => ({
    type: 'node',
    id: 1,
    lat: 19.0835,
    lon: 72.8384,
    tags: { amenity: 'school', name: 'A Real School' },
    ...over,
  });

  it('returns real named facilities with real distances, nearest first', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        elements: [
          element({ id: 2, lat: 19.11, lon: 72.8483, tags: { amenity: 'hospital', name: 'Far Hospital' } }),
          element({ id: 1, tags: { amenity: 'school', name: 'Near School' } }),
        ],
      }),
    );

    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.facilities).toHaveLength(2);
    expect(result.facilities[0].name).toBe('Near School');
    // Sorted by a computed distance, not by response order.
    expect(result.facilities[0].distanceM).toBeLessThan(result.facilities[1].distanceM);
    expect(result.facilities[0].distanceM).toBeGreaterThan(0);
  });

  it('never labels a school as a designated shelter', async () => {
    // This is the fabrication being prevented: the old UI marked invented
    // points "Safe Zone".
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elements: [element()] }));
    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });

    expect(result.facilities[0].officiallyDesignatedShelter).toBe(false);
    expect(result.facilities[0].kind).toBe('school');
    expect(facilityKindLabel(result.facilities[0].kind)).toBe('School grounds');
  });

  it('only marks a facility as a shelter when the source actually did', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        elements: [element({ tags: { amenity: 'shelter', name: 'Real Shelter' } })],
      }),
    );
    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });
    expect(result.facilities[0].officiallyDesignatedShelter).toBe(true);
  });

  it('always reports that no official shelter feed is available', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elements: [element()] }));
    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });
    expect(result.officialShelterFeedAvailable).toBe(false);
  });

  it('drops a facility with no name rather than showing a bare dot', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ elements: [element({ tags: { amenity: 'school' } })] }));

    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });
    expect(result.facilities).toHaveLength(0);
  });

  it('drops an element with no usable coordinate', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ elements: [element({ lat: undefined, lon: undefined })] }));

    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });
    expect(result.facilities).toHaveLength(0);
  });

  it('reads a way position from `center`', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        elements: [
          {
            type: 'way',
            id: 5,
            center: { lat: 19.09, lon: 72.83 },
            tags: { amenity: 'school', name: 'A School Way' },
          },
        ],
      }),
    );

    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });
    expect(result.facilities[0].latitude).toBeCloseTo(19.09, 5);
  });

  it('reports a genuine empty result distinctly from a failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elements: [] }));

    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.facilities).toHaveLength(0);
    // A real answer, not an outage disguised as "nothing nearby".
    expect(result.error).toMatch(/genuine empty result/);
  });

  it('never pads an empty result with a fallback marker', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elements: [] }));
    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });
    expect(result.facilities).toHaveLength(0);
  });

  it('reports a service outage as a failure, not as "nothing found"', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.facilities).toHaveLength(0);
    expect(result.error).toMatch(/could not be reached/);
  });

  it('fails over to a second mirror when the first is overloaded', async () => {
    // The public Overpass instances are volunteer-run and were observed
    // answering 504 and 429 under load. One busy server must not show the user
    // an empty list.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 504))
      .mockResolvedValueOnce(jsonResponse({ elements: [element()] }));

    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.facilities).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('tries every mirror before giving up, and names them all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 429));

    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.facilities).toHaveLength(0);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    // The message must not pretend the absence of facilities was the finding.
    expect(result.error).toMatch(/not an absence of facilities/i);
    expect(result.error).toMatch(/429/);
  });

  it('accepts a 200 with no elements as a real answer, not a reason to retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elements: [] }));

    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });

    expect(result.ok).toBe(true);
    // No point failing over: the first server answered properly.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports a rejection reason rather than a bare failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 406));

    const result = await fetchCandidateFacilities(JUHU, { fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/406/);
  });

  it('sends the User-Agent the service requires', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elements: [] }));
    await fetchCandidateFacilities(JUHU, { fetchImpl });

    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/BayWatch/);
  });

  it('does not search at all without a real position', async () => {
    const fetchImpl = vi.fn();

    const result = await fetchCandidateFacilities(
      { latitude: NaN, longitude: 0 },
      { fetchImpl },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a statement that no facilities exist/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
