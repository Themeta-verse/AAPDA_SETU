import { useState, useEffect, useCallback } from 'react';

interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

// Juhu Beach coordinates
export const JUHU_BEACH = { latitude: 19.0988, longitude: 72.8267 };

// Haversine formula for distance between two points
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getEvacuationDirection(userLat: number, userLon: number): string {
  // Juhu Beach is on the west coast - move east/inland
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

export function useGeolocation() {
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

  const distanceFromBeach = position
    ? calculateDistance(position.latitude, position.longitude, JUHU_BEACH.latitude, JUHU_BEACH.longitude)
    : null;

  const evacuationDirection = position
    ? getEvacuationDirection(position.latitude, position.longitude)
    : null;

  return { position, error, loading, permissionGranted, requestLocation, distanceFromBeach, evacuationDirection };
}
