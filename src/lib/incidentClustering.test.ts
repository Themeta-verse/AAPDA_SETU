import { describe, it, expect } from 'vitest';
import { clusterIncidents, DEFAULT_SPATIAL_THRESHOLD_KM } from './incidentClustering';
import type { Incident } from '@/integrations/supabase/incidents';

function makeIncident(overrides: Partial<Incident>): Incident {
  return {
    id: 'inc-1',
    reporterId: 'user-1',
    type: 'flooding',
    rawType: 'flooding',
    description: 'Water accumulation',
    photoPath: 'user-1/photo1.jpg',
    latitude: 19.1000,
    longitude: 72.8300,
    hasCoordinates: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    malformed: false,
    ...overrides,
  };
}

describe('Incident Duplicate Clustering Module', () => {
  it('groups nearby incidents of the same type within time threshold into a single cluster', () => {
    const incA = makeIncident({
      id: 'inc-a',
      description: 'Severe waterlogging at crossroad',
      latitude: 19.1000,
      longitude: 72.8300,
      createdAt: '2026-10-01T10:00:00.000Z',
    });

    // 200m away, 15 minutes later, same type
    const incB = makeIncident({
      id: 'inc-b',
      description: 'Drains overflowing near crossroad',
      latitude: 19.1015,
      longitude: 72.8310,
      createdAt: '2026-10-01T10:15:00.000Z',
      photoPath: 'user-2/photo2.jpg',
    });

    const clusters = clusterIncidents([incA, incB]);

    expect(clusters.length).toBe(1);
    expect(clusters[0].reportCount).toBe(2);
    expect(clusters[0].reports.map(r => r.id)).toEqual(['inc-a', 'inc-b']);
    // Preserves individual descriptions and photos
    expect(clusters[0].allPhotos).toContain('user-1/photo1.jpg');
    expect(clusters[0].allPhotos).toContain('user-2/photo2.jpg');
    expect(clusters[0].allDescriptions).toContain('Severe waterlogging at crossroad');
    expect(clusters[0].allDescriptions).toContain('Drains overflowing near crossroad');
  });

  it('separates incidents that exceed spatial threshold (> 500m)', () => {
    const incA = makeIncident({
      id: 'inc-a',
      latitude: 19.1000,
      longitude: 72.8300,
      createdAt: '2026-10-01T10:00:00.000Z',
    });

    // ~2.5km away
    const incFar = makeIncident({
      id: 'inc-far',
      latitude: 19.1200,
      longitude: 72.8450,
      createdAt: '2026-10-01T10:05:00.000Z',
    });

    const clusters = clusterIncidents([incA, incFar]);
    expect(clusters.length).toBe(2);
  });

  it('separates incidents of different types even if at the exact same location and time', () => {
    const incFlood = makeIncident({
      id: 'inc-1',
      type: 'flooding',
      latitude: 19.1000,
      longitude: 72.8300,
      createdAt: '2026-10-01T10:00:00.000Z',
    });

    const incRoad = makeIncident({
      id: 'inc-2',
      type: 'blocked_roads',
      latitude: 19.1000,
      longitude: 72.8300,
      createdAt: '2026-10-01T10:00:00.000Z',
    });

    const clusters = clusterIncidents([incFlood, incRoad]);
    expect(clusters.length).toBe(2);
    expect(clusters[0].incidentType).toBe('flooding');
    expect(clusters[1].incidentType).toBe('blocked_roads');
  });

  it('separates incidents that occur outside the temporal threshold (> 2 hours)', () => {
    const incEarly = makeIncident({
      id: 'inc-early',
      latitude: 19.1000,
      longitude: 72.8300,
      createdAt: '2026-10-01T08:00:00.000Z',
    });

    // 5 hours later
    const incLate = makeIncident({
      id: 'inc-late',
      latitude: 19.1005,
      longitude: 72.8302,
      createdAt: '2026-10-01T13:00:00.000Z',
    });

    const clusters = clusterIncidents([incEarly, incLate]);
    expect(clusters.length).toBe(2);
  });

  it('handles empty input gracefully', () => {
    expect(clusterIncidents([])).toEqual([]);
  });
});
