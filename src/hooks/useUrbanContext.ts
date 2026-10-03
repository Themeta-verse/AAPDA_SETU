import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGeolocation } from './useGeolocation';
import {
  CONFIGURED_CITIES,
  DEFAULT_URBAN_ZONES,
  DEFAULT_SAFE_LOCATIONS,
  type UrbanCity,
  type UrbanZone,
  type UrbanZoneType,
  type SafeLocation,
  type LocationType,
  type UrbanContext,
  findNearestZone,
  findZoneContaining,
  findNearestSafeLocation,
  calculateDistanceKm,
} from '@/lib/urbanContext';
import { saveToCache, loadFromCache } from '@/lib/offlineCache';

const URBAN_CONTEXT_CACHE_KEY = 'urban_context_v1';

export function useUrbanContext() {
  const { position: gpsPosition, status: gpsStatus, statusMessage: gpsStatusMessage } = useGeolocation();
  // Only genuine failure modes count as an error. Idle/locating/ready are not
  // errors, so they surface as null rather than as a message.
  const gpsError =
    gpsStatus === 'denied' ||
    gpsStatus === 'unavailable' ||
    gpsStatus === 'timeout' ||
    gpsStatus === 'unsupported' ||
    gpsStatus === 'error'
      ? gpsStatusMessage
      : null;

  // Database loaded zones & safe locations
  const [zones, setZones] = useState<UrbanZone[]>(DEFAULT_URBAN_ZONES);
  const [safeLocations, setSafeLocations] = useState<SafeLocation[]>(DEFAULT_SAFE_LOCATIONS);
  const [loading, setLoading] = useState(true);

  // Selected state
  const [selectedCityName, setSelectedCityName] = useState<string>('Mumbai');
  const [selectedZoneId, setSelectedZoneId] = useState<string>('zone-mumbai-juhu');
  const [isGpsActive, setIsGpsActive] = useState<boolean>(false);

  // Load cached preference on mount
  useEffect(() => {
    const cached = loadFromCache<{ city: string; zoneId: string; isGpsActive: boolean }>(
      URBAN_CONTEXT_CACHE_KEY
    );
    if (cached && cached.data) {
      if (cached.data.city) setSelectedCityName(cached.data.city);
      if (cached.data.zoneId) setSelectedZoneId(cached.data.zoneId);
      if (typeof cached.data.isGpsActive === 'boolean') setIsGpsActive(cached.data.isGpsActive);
    }
  }, []);

  // Fetch zones from Supabase
  const fetchZonesAndLocations = useCallback(async () => {
    setLoading(true);
    try {
      const { data: dbZones } = await supabase
        .from('risk_zones')
        .select('*')
        .eq('is_active', true);

      if (Array.isArray(dbZones) && dbZones.length > 0) {
        const mappedZones: UrbanZone[] = dbZones.map((z: Record<string, unknown>) => ({
          id: z.id as string,
          name: z.name as string,
          city: (z.city as string) || 'Mumbai',
          ward: (z.ward as string) || null,
          zoneType: (z.zone_type as UrbanZoneType) || (z.is_coastal ? 'coastal' : 'inland_flood'),
          isCoastal: typeof z.is_coastal === 'boolean' ? z.is_coastal : true,
          centerLat: z.center_lat as number,
          centerLon: z.center_lon as number,
          radiusKm: (z.radius_km as number) || 4.0,
          alertThresholdKm: (z.alert_threshold_km as number) || 2.5,
          severityThreshold: (z.severity_threshold as 'moderate' | 'high' | 'critical') || 'high',
          eventTypes: Array.isArray(z.event_types) ? (z.event_types as string[]) : ['flood'],
          isActive: z.is_active as boolean,
        }));
        setZones(mappedZones);
      }

      // Safe locations
      const { data: dbLocations } = await supabase
        .from('safe_locations')
        .select('*')
        .eq('is_active', true);

      if (Array.isArray(dbLocations) && dbLocations.length > 0) {
        const mappedLocations: SafeLocation[] = dbLocations.map((l: Record<string, unknown>) => ({
          id: l.id as string,
          zoneId: (l.zone_id as string) || null,
          city: (l.city as string) || 'Mumbai',
          name: l.name as string,
          locationType: l.location_type as LocationType,
          address: (l.address as string) || null,
          latitude: l.latitude as number,
          longitude: l.longitude as number,
          capacity: (l.capacity as number) || null,
          contactNumber: (l.contact_number as string) || null,
          isActive: l.is_active as boolean,
        }));
        setSafeLocations(mappedLocations);
      }
    } catch (e) {
      // Fallback to default urban zones on offline/error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchZonesAndLocations();
  }, [fetchZonesAndLocations]);

  // Save selection changes to cache
  const updateSelection = useCallback(
    (city: string, zoneId: string | null, gps: boolean) => {
      setSelectedCityName(city);
      if (zoneId) setSelectedZoneId(zoneId);
      setIsGpsActive(gps);
      saveToCache(
        URBAN_CONTEXT_CACHE_KEY,
        { city, zoneId: zoneId || selectedZoneId, isGpsActive: gps },
        'ClientPreferences'
      );
    },
    [selectedZoneId]
  );

  // Set city action
  const setCity = useCallback(
    (city: string) => {
      const cityZones = zones.filter((z) => z.city.toLowerCase() === city.toLowerCase());
      const firstZone = cityZones[0];
      updateSelection(city, firstZone ? firstZone.id : null, false);
    },
    [zones, updateSelection]
  );

  // Set zone action
  const setZone = useCallback(
    (zoneId: string) => {
      const targetZone = zones.find((z) => z.id === zoneId);
      if (targetZone) {
        updateSelection(targetZone.city, targetZone.id, false);
      }
    },
    [zones, updateSelection]
  );

  // Enable / disable GPS tracking
  const toggleGps = useCallback(() => {
    if (!isGpsActive && gpsPosition) {
      // Find zone CONTAINING GPS coordinates (within radiusKm)
      const containing = findZoneContaining(gpsPosition.latitude, gpsPosition.longitude, zones);
      if (containing) {
        updateSelection(containing.zone.city, containing.zone.id, true);
        return;
      }
      // GPS coordinates don't fall inside any configured risk zone
      // Keep GPS active but with no zone context
      updateSelection(selectedCityName, null, true);
      return;
    }
    setIsGpsActive(!isGpsActive);
  }, [isGpsActive, gpsPosition, zones, updateSelection, selectedCityName]);

  // Derived current urban context
  const currentContext: UrbanContext = useMemo(() => {
    // If GPS is active and coordinates exist
    if (isGpsActive && gpsPosition) {
      const containing = findZoneContaining(gpsPosition.latitude, gpsPosition.longitude, zones);
      if (containing) {
        return {
          city: containing.zone.city,
          ward: containing.zone.ward,
          zoneId: containing.zone.id,
          zoneName: `${containing.zone.name} (GPS Inside Zone)`,
          isCoastal: containing.zone.isCoastal,
          zoneType: containing.zone.zoneType,
          latitude: gpsPosition.latitude,
          longitude: gpsPosition.longitude,
          source: 'gps',
          confidence: 'exact',
        };
      }
      // GPS active but NOT inside any configured risk zone
      // Use city default coordinates but mark as no zone
      const cityDefault = CONFIGURED_CITIES.find(c => c.name.toLowerCase() === selectedCityName.toLowerCase()) || CONFIGURED_CITIES[0];
      return {
        city: cityDefault.name,
        ward: null,
        zoneId: null,
        zoneName: 'GPS Location (No Configured Risk Zone)',
        isCoastal: cityDefault.isCoastal,
        zoneType: 'general',
        latitude: gpsPosition.latitude,
        longitude: gpsPosition.longitude,
        source: 'gps',
        confidence: 'exact',
      };
    }

    // Selected zone
    const targetZone =
      zones.find((z) => z.id === selectedZoneId) ||
      zones.find((z) => z.city.toLowerCase() === selectedCityName.toLowerCase()) ||
      zones[0] ||
      DEFAULT_URBAN_ZONES[0];

    return {
      city: targetZone.city,
      ward: targetZone.ward,
      zoneId: targetZone.id,
      zoneName: targetZone.name,
      isCoastal: targetZone.isCoastal,
      zoneType: targetZone.zoneType,
      latitude: targetZone.centerLat,
      longitude: targetZone.centerLon,
      source: 'configured_zone',
      confidence: 'configured',
    };
  }, [isGpsActive, gpsPosition, zones, selectedZoneId, selectedCityName]);

  // Filtered zones for current city
  const cityZones = useMemo(() => {
    return zones.filter(
      (z) => z.city.toLowerCase() === currentContext.city.toLowerCase()
    );
  }, [zones, currentContext.city]);

  // Active zone's safe locations
  const zoneSafeLocations = useMemo(() => {
    if (!currentContext.zoneId) {
      return safeLocations.filter(
        (l) => l.city.toLowerCase() === currentContext.city.toLowerCase()
      );
    }
    const forZone = safeLocations.filter((l) => l.zoneId === currentContext.zoneId);
    if (forZone.length > 0) return forZone;
    return safeLocations.filter(
      (l) => l.city.toLowerCase() === currentContext.city.toLowerCase()
    );
  }, [safeLocations, currentContext]);

  return {
    context: currentContext,
    cities: CONFIGURED_CITIES,
    zones,
    cityZones,
    safeLocations: zoneSafeLocations,
    allSafeLocations: safeLocations,
    loading,
    isGpsActive,
    gpsPosition,
    gpsError,
    setCity,
    setZone,
    toggleGps,
    calculateDistanceToCenter: (lat: number, lon: number) => {
      const centerLat = currentContext.latitude;
      const centerLon = currentContext.longitude;
      if (
        typeof centerLat !== 'number' || !Number.isFinite(centerLat) ||
        typeof centerLon !== 'number' || !Number.isFinite(centerLon)
      ) {
        return null;
      }
      return calculateDistanceKm(lat, lon, centerLat, centerLon);
    },
  };
}
