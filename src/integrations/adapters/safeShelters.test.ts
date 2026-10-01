import { describe, it, expect, vi } from 'vitest';
import { fetchCandidateFacilities } from './safeShelters';

/**
 * Candidate facilities must be real OpenStreetMap results with real
 * coordinates — never invented, never padded. An unreachable mirror is a
 * failure (ok: false), an empty match is a genuine empty result (ok: true).
 */

const CENTRE = { latitude: 19.0988, longitude: 72.8267 };

function overpassOk(elements: unknown[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ elements }),
  });
}

describe('safe shelter discovery honesty', () => {
  it('returns real named facilities sorted by real distance', async () => {
    const fetchImpl = overpassOk([
      {
        type: 'node',
        id: 2,
        lat: 19.12,
        lon: 72.84,
        tags: { amenity: 'school', name: 'Far School' },
      },
      {
        type: 'node',
        id: 1,
        lat: 19.1,
        lon: 72.827,
        tags: { amenity: 'hospital', name: 'Near Hospital' },
      },
    ]);
    const result = await fetchCandidateFacilities(CENTRE, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    expect(result.facilities).toHaveLength(2);
    expect(result.facilities[0].name).toBe('Near Hospital');
    expect(result.facilities[0].distanceM).toBeGreaterThan(0);
    expect(result.facilities[0].officiallyDesignatedShelter).toBe(false);
  });

  it('drops unnamed facilities instead of showing bare dots', async () => {
    const fetchImpl = overpassOk([
      { type: 'node', id: 1, lat: 19.1, lon: 72.827, tags: { amenity: 'school' } },
    ]);
    const result = await fetchCandidateFacilities(CENTRE, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    expect(result.facilities).toHaveLength(0);
    expect(result.error).toContain('genuine empty result');
  });

  it('drops elements without coordinates and tags that are not facilities', async () => {
    const fetchImpl = overpassOk([
      { type: 'way', id: 9, tags: { amenity: 'school', name: 'No Centre Way' } },
      { type: 'node', id: 8, lat: 19.1, lon: 72.827, tags: { amenity: 'cafe', name: 'A Cafe' } },
    ]);
    const result = await fetchCandidateFacilities(CENTRE, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.facilities).toHaveLength(0);
  });

  it('reports unreachable mirrors as failure, never as an empty list', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const result = await fetchCandidateFacilities(CENTRE, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.ok).toBe(false);
    expect(result.facilities).toHaveLength(0);
    expect(result.error).toContain('could not be reached');
  });

  it('refuses to search without a real position', async () => {
    const fetchImpl = vi.fn();
    const result = await fetchCandidateFacilities(
      { latitude: NaN, longitude: 72.8 },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
