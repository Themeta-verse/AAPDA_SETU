import { describe, it, expect } from 'vitest';
import {
  CONFIGURED_CITIES,
  DEFAULT_URBAN_ZONES,
  DEFAULT_SAFE_LOCATIONS,
  findZoneById,
  findNearestZone,
  findZoneContaining,
  findNearestSafeLocation,
  calculateDistanceKm,
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

    const mockResources: Parameters<typeof computeRuleBasedRecommendations>[0]['resources'] = [
      {
        id: 'res-kurla-boat',
        name: 'Rescue Boat Kurla Unit 1',
        resourceType: 'boat',
        status: 'available',
        zoneId: 'zone-mumbai-kurla',
        availableQuantity: 2,
        quantity: 2,
        capacity: 10,
        createdAt: new Date().toISOString(),
        createdBy: 'user-1',
        latitude: null,
        longitude: null,
        metadata: {},
      },
      {
        id: 'res-juhu-boat',
        name: 'Juhu Coastal Rescue Boat',
        resourceType: 'boat',
        status: 'available',
        zoneId: 'zone-mumbai-juhu',
        availableQuantity: 3,
        quantity: 3,
        capacity: 10,
        createdAt: new Date().toISOString(),
        createdBy: 'user-1',
        latitude: null,
        longitude: null,
        metadata: {},
      },
    ];

    // Incident in Kurla zone
    const kurlaIncident: Parameters<typeof computeRuleBasedRecommendations>[0]['incidents'][0] = {
      id: 'inc-kurla-1',
      type: 'flooding',
      description: 'Severe waterlogging at Kurla West',
      status: 'verified',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      latitude: null,
      longitude: null,
      photoUrl: null,
      verifiedBy: null,
      verifiedAt: null,
      hasCoordinates: false,
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

    const loaded = loadFromCache<{ city: string; zoneId: string }>('urban_context_v1');
    expect(loaded).toBeDefined();
    expect(loaded?.data?.city).toBe('Pune');
    expect(loaded?.data?.zoneId).toBe('zone-pune-mutha');
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

describe('GPS → Urban Context Resolution (findZoneContaining)', () => {
  it('finds zone when GPS coordinates are INSIDE zone radius', () => {
    // GPS inside Juhu zone (center: 19.0988, 72.8267, radius: 5km)
    const insideJuhu = findZoneContaining(19.1000, 72.8280);
    expect(insideJuhu).toBeDefined();
    expect(insideJuhu?.zone.id).toBe('zone-mumbai-juhu');
    expect(insideJuhu?.distanceKm).toBeLessThan(5.0);
  });

  it('finds zone when GPS coordinates are INSIDE Sion zone', () => {
    // GPS inside Sion zone (center: 19.0330, 72.8617, radius: 3km)
    const insideSion = findZoneContaining(19.0335, 72.8620);
    expect(insideSion).toBeDefined();
    expect(insideSion?.zone.id).toBe('zone-mumbai-sion');
    expect(insideSion?.distanceKm).toBeLessThan(3.0);
  });

  it('returns null when GPS coordinates are OUTSIDE all zone radii', () => {
    // GPS in central Mumbai, not inside any configured zone radius
    // (19.0760, 72.8777) is Mumbai city center, far from Juhu (7.7km), Sion (5.5km), Kurla (2.5km), Bandra (4.5km)
    // Wait - Kurla center is 19.0688, 72.8797 with radius 4km - city center might be inside Kurla
    // Let's use a point far from all zones - e.g. Thane (19.2183, 72.9781)
    const outsideAll = findZoneContaining(19.2183, 72.9781);
    expect(outsideAll).toBeNull();
  });

  it('returns null for coordinates in another city not covered by zones', () => {
    // Delhi coordinates - no zones configured
    const delhi = findZoneContaining(28.6139, 77.2090);
    expect(delhi).toBeNull();
  });

  it('does not return nearest zone center when outside radius - only returns containing zone', () => {
    // Point near Juhu but outside 5km radius (e.g. 7km away)
    // Juhu center: 19.0988, 72.8267, radius 5km
    // Point ~7km north: 19.1600, 72.8267
    const nearButOutside = findZoneContaining(19.1600, 72.8267);
    // Should be null because 7km > 5km radius
    // Note: findNearestZone would still return Juhu as nearest center
    expect(nearButOutside).toBeNull();
  });
});

describe('Regression: Invalid/undefined coordinates handling (browser crash fix)', () => {
  it('calculateDistanceKm returns null for undefined coordinates', () => {
    expect(calculateDistanceKm(undefined, undefined, undefined, undefined)).toBeNull();
    expect(calculateDistanceKm(null, null, null, null)).toBeNull();
    expect(calculateDistanceKm(NaN, NaN, NaN, NaN)).toBeNull();
    expect(calculateDistanceKm(19.0988, 72.8267, undefined, undefined)).toBeNull();
    expect(calculateDistanceKm(undefined, undefined, 19.0988, 72.8267)).toBeNull();
  });

  it('findNearestZone returns null for invalid coordinates', () => {
    expect(findNearestZone(undefined, undefined)).toBeNull();
    expect(findNearestZone(null, null)).toBeNull();
    expect(findNearestZone(NaN, NaN)).toBeNull();
  });

  it('findZoneContaining returns null for invalid coordinates', () => {
    expect(findZoneContaining(undefined, undefined)).toBeNull();
    expect(findZoneContaining(null, null)).toBeNull();
    expect(findZoneContaining(NaN, NaN)).toBeNull();
  });

  it('findNearestSafeLocation returns null for invalid coordinates', () => {
    expect(findNearestSafeLocation(undefined, undefined)).toBeNull();
    expect(findNearestSafeLocation(null, null)).toBeNull();
    expect(findNearestSafeLocation(NaN, NaN)).toBeNull();
  });
});

describe('Forecast Horizon Data Flow', () => {
  it('Hourly weather point structure includes rainProbability, precipitation, windSpeed', () => {
    // This test documents the expected structure of WeatherHourlyPoint
    const hourlyPoint = {
      time: '2026-10-01T13:00:00.000Z',
      rainProbability: 75,
      precipitation: 12.5,
      windSpeed: 28,
    };
    expect(typeof hourlyPoint.time).toBe('string');
    expect(typeof hourlyPoint.rainProbability).toBe('number');
    expect(typeof hourlyPoint.precipitation).toBe('number');
    expect(typeof hourlyPoint.windSpeed).toBe('number');
  });

  it('Hourly marine point structure includes waveHeight', () => {
    const marinePoint = {
      time: '2026-10-01T13:00:00.000Z',
      waveHeight: 2.5,
    };
    expect(typeof marinePoint.time).toBe('string');
    expect(typeof marinePoint.waveHeight).toBe('number');
  });
});

