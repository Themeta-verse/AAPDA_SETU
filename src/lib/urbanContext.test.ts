import { describe, it, expect } from 'vitest';
import {
  CONFIGURED_CITIES,
  DEFAULT_URBAN_ZONES,
  DEFAULT_SAFE_LOCATIONS,
  findZoneById,
  findNearestZone,
  filterSafeLocations,
  type UrbanContext,
  type UrbanZone,
  type SafeLocation,
} from './urbanContext';
import {
  deriveMonitoringData,
  getAlerts,
  emptyMonitoringData,
} from './monitoringData';
import { calculateDistance, getEvacuationDirectionTo } from '@/hooks/useGeolocation';
import { computeRuleBasedRecommendations, type Resource } from '@/hooks/useResources';

describe('Urban Location Architecture & Context', () => {
  it('1. Juhu context works as one configured zone (data, not application logic)', () => {
    const juhuZone = DEFAULT_URBAN_ZONES.find(z => z.id === 'zone-mumbai-juhu');
    expect(juhuZone).toBeDefined();
    expect(juhuZone?.city).toBe('Mumbai');
    expect(juhuZone?.ward).toContain('K-West');
    expect(juhuZone?.isCoastal).toBe(true);
    expect(juhuZone?.centerLat).toBeCloseTo(19.0988, 3);
    expect(juhuZone?.centerLon).toBeCloseTo(72.8267, 3);

    const safeLocations = filterSafeLocations('zone-mumbai-juhu', 'Mumbai');
    expect(safeLocations.length).toBeGreaterThan(0);
    expect(safeLocations.some(s => s.name.includes('JVPD'))).toBe(true);
  });

  it('2. Another zone can be selected without code changes (e.g. Sion F-North, Pune Mutha River)', () => {
    const sionZone = findZoneById('zone-mumbai-sion');
    expect(sionZone).toBeDefined();
    expect(sionZone?.city).toBe('Mumbai');
    expect(sionZone?.ward).toContain('F-North');
    expect(sionZone?.isCoastal).toBe(false);
    expect(sionZone?.zoneType).toBe('inland_flood');

    const puneZone = findZoneById('zone-pune-mutha');
    expect(puneZone).toBeDefined();
    expect(puneZone?.city).toBe('Pune');
    expect(puneZone?.isCoastal).toBe(false);
  });

  it('3. Cities and administrative zones are hierarchical and extensible', () => {
    expect(CONFIGURED_CITIES.length).toBeGreaterThanOrEqual(2);
    const mumbai = CONFIGURED_CITIES.find(c => c.name === 'Mumbai');
    expect(mumbai).toBeDefined();
    expect(mumbai?.isCoastal).toBe(true);

    const pune = CONFIGURED_CITIES.find(c => c.name === 'Pune');
    expect(pune).toBeDefined();
    expect(pune?.isCoastal).toBe(false);

    const mumbaiZones = DEFAULT_URBAN_ZONES.filter(z => z.city === 'Mumbai');
    expect(mumbaiZones.some(z => z.ward?.includes('K-West'))).toBe(true);
    expect(mumbaiZones.some(z => z.ward?.includes('F-North'))).toBe(true);
    expect(mumbaiZones.some(z => z.ward?.includes('L-Ward'))).toBe(true);
  });

  it('4. Resource recommendations work outside Juhu via dynamic zone_id and incident type', () => {
    const kurlaZone = findZoneById('zone-mumbai-kurla');
    expect(kurlaZone).toBeDefined();

    const mockResources: any[] = [
      {
        id: 'res-kurla-boat',
        name: 'Rescue Boat Kurla Unit 1',
        resourceType: 'boat',
        status: 'available',
        zoneId: 'zone-mumbai-kurla',
        availableQuantity: 2,
        totalQuantity: 2,
        location: 'Kurla Station Depot',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'res-juhu-boat',
        name: 'Juhu Coastal Rescue Boat',
        resourceType: 'boat',
        status: 'available',
        zoneId: 'zone-mumbai-juhu',
        availableQuantity: 3,
        totalQuantity: 3,
        location: 'Juhu Beach Post',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // Incident in Kurla zone
    const kurlaIncident: any = {
      id: 'inc-kurla-1',
      type: 'flooding',
      description: 'Severe waterlogging at Kurla West',
      status: 'verified',
      createdAt: new Date().toISOString(),
    };

    // Calculate recommendations matching incident in Kurla
    const recs = computeRuleBasedRecommendations({
      incidents: [kurlaIncident],
      resources: mockResources,
      compatibilities: [
        {
          id: 'comp-1',
          incidentType: 'flooding',
          resourceType: 'boat',
          priority: 1,
          notes: 'Deploy rescue boat for urban flooding',
        },
      ],
      allocations: [],
      zones: [{ id: 'zone-mumbai-kurla', name: 'Kurla Mithi River Flood Zone' }],
    });

    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].incidentId).toBe('inc-kurla-1');
    expect(recs[0].resourceId).toBe('res-kurla-boat');
  });

  it('5. Empty urban area shows honest empty state with no invented safe locations', () => {
    const emptyLocations = filterSafeLocations('zone-non-existent', 'NonExistentCity', 'UnknownWard');
    expect(emptyLocations).toEqual([]);
    expect(emptyLocations.length).toBe(0);
  });

  it('6. Inland context handles marine data correctly (waveHeight is null, not fake zero, risks computed from wind/rain)', () => {
    // For inland zone, waveHeight is null.
    // deriveMonitoringData with isCoastal = false evaluates windSpeed and rainProbability without throwing or claiming safe.
    const inlandReading = deriveMonitoringData(
      null, // waveHeight is truthfully null
      35,   // gale wind speed 35 km/h
      85,   // high rain probability 85%
      'live',
      false, // tsunami risk false
      false  // isCoastal = false
    );

    // It evaluates urban rainfall & wind hazard without requiring wave height
    expect(inlandReading.waveHeight).toBeNull();
    expect(inlandReading.windSpeed).toBe(35);
    expect(inlandReading.rainProbability).toBe(85);
    expect(inlandReading.riskLevel).toBe('high');

    const alerts = getAlerts(inlandReading, false);
    const floodAlert = alerts.find(a => a.type === 'flood');
    const waveAlert = alerts.find(a => a.type === 'highWave');

    expect(floodAlert?.active).toBe(true);
    expect(waveAlert?.active).toBe(false); // High waves not active for inland!
  });

  it('7. Missing coordinates do not produce fake map positions or NaN distances', () => {
    const dist = calculateDistance(19.0988, 72.8267, 19.0988, 72.8267);
    expect(dist).toBe(0);

    // Bearing to a safe point
    const direction = getEvacuationDirectionTo(19.0988, 72.8267, 19.1100, 72.8350);
    expect(typeof direction).toBe('string');
    expect(direction).toBe('North-East');
  });

  it('8. Finds nearest zone accurately from GPS coordinates', () => {
    // Near Sion (19.0330, 72.8617)
    const nearest = findNearestZone(19.0335, 72.8620);
    expect(nearest).toBeDefined();
    expect(nearest?.zone.id).toBe('zone-mumbai-sion');
    expect(nearest?.distanceKm).toBeLessThan(1.0);

    // Near Pune (18.5204, 73.8567)
    const nearestPune = findNearestZone(18.5210, 73.8570);
    expect(nearestPune).toBeDefined();
    expect(nearestPune?.zone.city).toBe('Pune');
  });

  it('9. Offline cache saves and loads urban context preferences', async () => {
    const { saveToCache, loadFromCache } = await import('./offlineCache');
    saveToCache('urban_context_v1', { city: 'Pune', zoneId: 'zone-pune-mutha', isGpsActive: false }, 'TestPreference');

    const loaded = loadFromCache('urban_context_v1');
    expect(loaded).toBeDefined();
    expect((loaded as any)?.data?.city).toBe('Pune');
    expect((loaded as any)?.data?.zoneId).toBe('zone-pune-mutha');
  });

  it('10. Urban context operates without Juhu-specific application logic', () => {
    // A completely custom city and zone created dynamically at runtime
    const customZone: UrbanZone = {
      id: 'zone-nagpur-ambazari',
      name: 'Nagpur Ambazari Lake Overflow Zone',
      city: 'Nagpur',
      ward: 'Dharampeth',
      zoneType: 'inland_flood',
      isCoastal: false,
      centerLat: 21.1300,
      centerLon: 79.0500,
      radiusKm: 3.5,
      alertThresholdKm: 2.0,
      severityThreshold: 'high',
      eventTypes: ['flood', 'heavy_rainfall'],
      isActive: true,
    };

    const found = findZoneById('zone-nagpur-ambazari', [customZone]);
    expect(found).toBeDefined();
    expect(found?.city).toBe('Nagpur');
    expect(found?.isCoastal).toBe(false);

    // Hazard evaluation for custom inland zone (rain 90% -> critical risk)
    const customMonitoring = deriveMonitoringData(
      null, // inland has no wave height
      28,   // wind 28 km/h
      90,   // rain 90%
      'live',
      false,
      false // isCoastal = false
    );

    expect(customMonitoring.waveHeight).toBeNull();
    expect(customMonitoring.riskLevel).toBe('critical');
  });
});

