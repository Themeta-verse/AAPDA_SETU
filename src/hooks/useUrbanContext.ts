import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGeolocation } from './useGeolocation';
import {
  CONFIGURED_CITIES,
  DEFAULT_URBAN_ZONES,
  DEFAULT_SAFE_LOCATIONS,
  type UrbanCity,
  type UrbanZone,
  type SafeLocation,
  type UrbanContext,
  findNearestZone,
  findNearestSafeLocation,
  calculateDistanceKm,
} from '@/lib/urbanContext';
import { saveToCache, loadFromCache } from '@/lib/offlineCache';

const URBAN_CONTEXT_CACHE_KEY = 'urban_context_v1';

export function useUrbanContext() {
  const { position: gpsPosition, isTracking, error: gpsError } = useGeolocation();

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
        const mappedZones: UrbanZone[] = dbZones.map((z: any) => ({
          id: z.id,
          name: z.name,
          city: z.city || 'Mumbai',
          ward: z.ward || null,
          zoneType: z.zone_type || (z.is_coastal ? 'coastal' : 'inland_flood'),
          isCoastal: typeof z.is_coastal === 'boolean' ? z.is_coastal : true,
          centerLat: z.center_lat,
          centerLon: z.center_lon,
          radiusKm: z.radius_km || 4.0,
          alertThresholdKm: z.alert_threshold_km || 2.5,
          severityThreshold: z.severity_threshold || 'high',
          eventTypes: Array.isArray(z.event_types) ? z.event_types : ['flood'],
          isActive: z.is_active,
        }));
        setZones(mappedZones);
      }

      // Safe locations
      const { data: dbLocations } = await supabase
        .from('safe_locations')
        .select('*')
        .eq('is_active', true);

      if (Array.isArray(dbLocations) && dbLocations.length > 0) {
        const mappedLocations: SafeLocation[] = dbLocations.map((l: any) => ({
          id: l.id,
          zoneId: l.zone_id,
          city: l.city || 'Mumbai',
          name: l.name,
          locationType: l.location_type,
          address: l.address,
          latitude: l.latitude,
          longitude: l.longitude,
          capacity: l.capacity,
          contactNumber: l.contact_number,
          isActive: l.is_active,
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
      // Find nearest zone to GPS
      const nearest = findNearestZone(gpsPosition.latitude, gpsPosition.longitude, zones);
      if (nearest) {
        updateSelection(nearest.zone.city, nearest.zone.id, true);
        return;
      }
    }
    setIsGpsActive(!isGpsActive);
  }, [isGpsActive, gpsPosition, zones, updateSelection]);

  // Derived current urban context
  const currentContext: UrbanContext = useMemo(() => {
    // If GPS is active and coordinates exist
    if (isGpsActive && gpsPosition) {
      const nearest = findNearestZone(gpsPosition.latitude, gpsPosition.longitude, zones);
      return {
        city: nearest ? nearest.zone.city : selectedCityName,
        ward: nearest ? nearest.zone.ward : null,
        zoneId: nearest ? nearest.zone.id : null,
        zoneName: nearest ? `${nearest.zone.name} (Nearest to GPS)` : 'Current Location',
        isCoastal: nearest ? nearest.zone.isCoastal : true,
        zoneType: nearest ? nearest.zone.zoneType : 'general',
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
    calculateDistanceToCenter: (lat: number, lon: number) =>
      calculateDistanceKm(lat, lon, currentContext.latitude, currentContext.longitude),
  };
}
