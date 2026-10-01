import { useState, useEffect, useCallback } from 'react';

interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

// Default reference location (Juhu Beach coastal baseline for seed demo)
export const DEFAULT_REFERENCE_LOCATION = { latitude: 19.0988, longitude: 72.8267, name: 'Reference Hazard Point' };
export const JUHU_BEACH = DEFAULT_REFERENCE_LOCATION;

// Haversine formula for distance between two points in km
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Calculate compass heading from user position to a safe target point */
export function getEvacuationDirectionTo(userLat: number, userLon: number, targetLat: number, targetLon: number): string {
  const dLon = (targetLon - userLon) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(targetLat * Math.PI / 180);
  const x = Math.cos(userLat * Math.PI / 180) * Math.sin(targetLat * Math.PI / 180) -
    Math.sin(userLat * Math.PI / 180) * Math.cos(targetLat * Math.PI / 180) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

  if (bearing >= 337.5 || bearing < 22.5) return 'North';
  if (bearing >= 22.5 && bearing < 67.5) return 'North-East';
  if (bearing >= 67.5 && bearing < 112.5) return 'East';
  if (bearing >= 112.5 && bearing < 157.5) return 'South-East';
  if (bearing >= 157.5 && bearing < 202.5) return 'South';
  if (bearing >= 202.5 && bearing < 247.5) return 'South-West';
  if (bearing >= 247.5 && bearing < 292.5) return 'West';
  return 'North-West';
}

export function getEvacuationDirection(userLat: number, userLon: number): string {
  // Move inland (East) from coast
  const bearing = Math.atan2(
    Math.sin((72.84 - userLon) * Math.PI / 180) * Math.cos(19.1 * Math.PI / 180),
    Math.cos(userLat * Math.PI / 180) * Math.sin(19.1 * Math.PI / 180) -
    Math.sin(userLat * Math.PI / 180) * Math.cos(19.1 * Math.PI / 180) * Math.cos((72.84 - userLon) * Math.PI / 180)
  ) * 180 / Math.PI;

  if (bearing >= -45 && bearing < 45) return 'East (Inland)';
  if (bearing >= 45 && bearing < 135) return 'South';
  if (bearing >= -135 && bearing < -45) return 'North';
  return 'West';
}

export interface GeolocationTarget {
  latitude: number;
  longitude: number;
  name?: string;
}

export function useGeolocation(
  referenceTarget: GeolocationTarget = DEFAULT_REFERENCE_LOCATION,
  safeTarget?: GeolocationTarget | null
) {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by your browser');
      return;
    }

    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setPermissionGranted(true);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }, []);

  // Watch position for live updates
  useEffect(() => {
    if (!permissionGranted || !('geolocation' in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [permissionGranted]);

  const target = referenceTarget || DEFAULT_REFERENCE_LOCATION;
  const distanceToHazard = position
    ? calculateDistance(position.latitude, position.longitude, target.latitude, target.longitude)
    : null;

  const evacuationDirection = position
    ? safeTarget
      ? getEvacuationDirectionTo(position.latitude, position.longitude, safeTarget.latitude, safeTarget.longitude)
      : getEvacuationDirection(position.latitude, position.longitude)
    : null;

  return {
    position,
    error,
    loading,
    permissionGranted,
    requestLocation,
    distanceToHazard,
    distanceFromBeach: distanceToHazard,
    evacuationDirection,
  };
}
