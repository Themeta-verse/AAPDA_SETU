/**
 * Candidate evacuation destinations, discovered from OpenStreetMap via Overpass.
 *
 * ===================================================================
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ===================================================================
 *
 * It IS: a live query for real, named, geographically-located facilities near a
 * given point, with real coordinates and real names, plus real great-circle
 * distances computed from them.
 *
 * It IS NOT: an official evacuation-shelter list. No such authoritative feed is
 * available to this application, and OpenStreetMap carries no `amenity=shelter`
 * tags for the Mumbai area. Every result here is therefore reported as a
 * CANDIDATE FACILITY and the UI states that it is not a designated shelter.
 *
 * This distinction is the whole point of the module. The previous implementation
 * placed two invented markers labelled "Safe Zone A" and "Safe Zone B" at
 * hardcoded percentage positions on a decorative gradient, with straight lines
 * drawn to them. Those labels asserted a safety designation that no source
 * supported, at positions that were never real coordinates. A user following
 * such a route would be trusting a fabrication.
 *
 * HONESTY RULES ENFORCED HERE
 * ---------------------------
 * - A facility is only returned if Overpass returned real coordinates.
 * - A facility with no name is dropped rather than shown as an unnamed blob.
 * - An empty result is an empty result. It is never padded with a fallback
 *   marker, and the caller is told the search genuinely found nothing.
 * - The facility kind is reported from the OSM tag that produced it, so the UI
 *   cannot relabel a school as a shelter.
 */

import { distanceMetres, type LatLon } from '@/lib/geo';

/**
 * Overpass requires a descriptive User-Agent.
 *
 * This is not cosmetic: without one the public instance answers HTTP 406 and
 * refuses the request entirely. That was measured directly.
 */
const USER_AGENT =
  'BayWatch-Coastal-Alerts/1.0 (educational disaster-awareness project; +https://github.com/baywatch)';

/**
 * Overpass instances, tried in order.
 *
 * The public instances are volunteer-run and routinely answer 429 or 504 under
 * load — both were observed directly against the main instance. Rather than
 * showing a user an empty list because one server was busy, the query is retried
 * against the next mirror. This is a failover, not a fallback: every endpoint
 * returns the same OpenStreetMap data, so no result is ever substituted.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;

export type FacilityKind = 'shelter' | 'school' | 'community-centre' | 'hospital' | 'stadium';

export interface CandidateFacility {
  /** Stable identity: OSM type and id. */
  id: string;
  name: string;
  kind: FacilityKind;
  latitude: number;
  longitude: number;
  /** Real great-circle distance from the query point, metres. */
  distanceM: number;
  /** True only when OSM explicitly tagged this as a shelter. */
  officiallyDesignatedShelter: boolean;
  source: 'openstreetmap';
  sourceUrl: string;
}

export interface NearbyFacilitiesResult {
  facilities: CandidateFacility[];
  /** True when the query succeeded, even if it matched nothing. */
  ok: boolean;
  error: string | null;
  centre: LatLon | null;
  radiusM: number;
  retrievedAt: string;
  /**
   * Always false today. It becomes true only if an authority publishes a
   * designated-shelter feed, which no available source currently does.
   */
  officialShelterFeedAvailable: boolean;
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

function classify(tags: Record<string, string>): FacilityKind | null {
  if (tags.shelter === 'yes' || tags.amenity === 'shelter') return 'shelter';
  if (tags.amenity === 'school') return 'school';
  if (tags.amenity === 'community_centre') return 'community-centre';
  if (tags.amenity === 'hospital') return 'hospital';
  if (tags.leisure === 'stadium' || tags.leisure === 'sports_centre') return 'stadium';
  return null;
}

/**
 * Build the Overpass QL query.
 *
 * Only tags that describe a real, sizeable place a person could gather are
 * requested. `out center` gives a usable coordinate for ways as well as nodes.
 */
function buildQuery(centre: LatLon, radiusM: number, limit: number): string {
  const around = `around:${Math.round(radiusM)},${centre.latitude},${centre.longitude}`;
  return `[out:json][timeout:25];
(
  node["amenity"="shelter"](${around});
  way["amenity"="shelter"](${around});
  node["amenity"="school"](${around});
  way["amenity"="school"](${around});
  node["amenity"="community_centre"](${around});
  node["amenity"="hospital"](${around});
  way["amenity"="hospital"](${around});
  node["leisure"="stadium"](${around});
  way["leisure"="stadium"](${around});
);
out center ${limit};`;
}

export interface FetchFacilitiesOptions {
  radiusM?: number;
  limit?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Find candidate facilities near a point.
 *
 * Returns real results with real coordinates, sorted by real distance. An
 * unreachable Overpass is reported as `ok: false` with a reason, never as an
 * empty list of "no facilities found", because those are different facts.
 */
export async function fetchCandidateFacilities(
  centre: LatLon,
  options: FetchFacilitiesOptions = {},
): Promise<NearbyFacilitiesResult> {
  const {
    radiusM = 6000,
    limit = 40,
    fetchImpl = fetch,
    timeoutMs = 30000,
  } = options;

  const base = {
    centre,
    radiusM,
    retrievedAt: new Date().toISOString(),
    officialShelterFeedAvailable: false,
  };

  if (
    !centre ||
    typeof centre.latitude !== 'number' ||
    typeof centre.longitude !== 'number' ||
    !Number.isFinite(centre.latitude) ||
    !Number.isFinite(centre.longitude)
  ) {
    return {
      ...base,
      facilities: [],
      ok: false,
      error:
        'No position was supplied, so nearby facilities were not searched for. ' +
        'This is not a statement that no facilities exist.',
    };
  }

  const controller = new AbortController();
  const overallTimer = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const body = `data=${encodeURIComponent(buildQuery(centre, radiusM, limit))}`;
  const attempts: { endpoint: string; status: number | null; error: string | null }[] = [];

  try {
    let payload: { elements?: OverpassElement[] } | null = null;

    // Try each mirror in turn. A transport error or a server-side status
    // (429/504) moves on to the next; a 200 is accepted even if it carries no
    // elements, because an empty result is a real answer.
    for (const endpoint of ENDPOINTS) {
      if (controller.signal.aborted) break;
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
          },
          body,
          signal: controller.signal,
        });

        if (response.ok) {
          payload = (await response.json()) as { elements?: OverpassElement[] };
          attempts.push({ endpoint, status: response.status, error: null });
          break;
        }

        attempts.push({ endpoint, status: response.status, error: `HTTP ${response.status}` });
      } catch (error) {
        attempts.push({
          endpoint,
          status: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (payload === null) {
      const detail = attempts
        .map((a) => `${new URL(a.endpoint).host} ${a.error ?? `HTTP ${a.status}`}`)
        .join('; ');

      return {
        ...base,
        facilities: [],
        ok: false,
        error:
          'The map data service could not be reached on any of its public instances ' +
          `(${detail}). Nearby facilities cannot be listed. This is a service problem, ` +
          'not an absence of facilities.',
      };
    }

    const elements = Array.isArray(payload.elements) ? payload.elements : [];

    const facilities: CandidateFacility[] = [];

    for (const element of elements) {
      // A way carries its position in `center`; a node carries it directly.
      const lat = element.lat ?? element.center?.lat;
      const lon = element.lon ?? element.center?.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;

      const tags = element.tags ?? {};
      const kind = classify(tags);
      if (!kind) continue;

      // An unnamed facility cannot be navigated to by name, so showing a bare
      // dot on a map would be less useful than omitting it.
      const name = tags['name:en'] ?? tags.name;
      if (!name || !name.trim()) continue;

      const point = { latitude: lat, longitude: lon };
      const distanceM = distanceMetres(centre, point);
      if (distanceM === null) continue;

      facilities.push({
        id: `${element.type ?? 'node'}/${element.id ?? name}`,
        name: name.trim(),
        kind,
        latitude: lat,
        longitude: lon,
        distanceM,
        officiallyDesignatedShelter: kind === 'shelter',
        source: 'openstreetmap',
        sourceUrl: `https://www.openstreetmap.org/${element.type ?? 'node'}/${element.id ?? ''}`,
      });
    }

    facilities.sort((a, b) => a.distanceM - b.distanceM);

    return {
      ...base,
      facilities,
      ok: true,
      // A successful query that matched nothing is a real, reportable result.
      error:
        facilities.length === 0
          ? `OpenStreetMap returned no named facilities within ${Math.round(radiusM / 1000)} km of this position. ` +
            'This is a genuine empty result, not a failure.'
          : null,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ...base,
      facilities: [],
      ok: false,
      error: aborted
        ? 'The map data service did not respond in time, so nearby facilities could not be listed.'
        : `The map data service could not be reached: ${
            error instanceof Error ? error.message : String(error)
          }`,
    };
  } finally {
    clearTimeout(overallTimer);
  }
}

/** Human label for a facility kind, from the tag it actually carries. */
export function facilityKindLabel(kind: FacilityKind): string {
  switch (kind) {
    case 'shelter':
      return 'Designated shelter';
    case 'school':
      return 'School grounds';
    case 'community-centre':
      return 'Community centre';
    case 'hospital':
      return 'Hospital';
    case 'stadium':
      return 'Stadium';
  }
}
