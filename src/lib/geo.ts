/**
 * Geodesic helpers for the evacuation and location features.
 *
 * These are real calculations, not display approximations. Distances are great
 * circle distances on a sphere of the Earth's mean radius, and bearings are
 * initial great-circle bearings. They are accurate to well under a percent over
 * the few-kilometre distances this app routes over, which is far tighter than
 * any consumer GPS fix.
 *
 * Nothing here fabricates a position. A function returns `null` rather than a
 * guessed value when its inputs are missing or out of range, so a caller cannot
 * accidentally display a distance derived from a coordinate it never had.
 */

export interface LatLon {
  latitude: number;
  longitude: number;
}

/** Mean Earth radius, metres (IUGG). */
const EARTH_RADIUS_M = 6371008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * True only for a coordinate that is actually a coordinate.
 *
 * Guards against the common failure of arithmetic on `undefined`, which yields
 * `NaN` and then renders as a plausible-looking but meaningless number.
 */
export function isValidCoordinate(point: unknown): point is LatLon {
  if (!point || typeof point !== 'object') return false;
  const { latitude, longitude } = point as LatLon;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** Great-circle distance in metres, or null if either point is unusable. */
export function distanceMetres(a: LatLon, b: LatLon): number | null {
  if (!isValidCoordinate(a) || !isValidCoordinate(b)) return null;

  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Initial bearing from `a` to `b` in degrees clockwise from true north, 0–360.
 *
 * Null when the inputs are unusable, or when the points are coincident, where
 * the bearing is genuinely undefined rather than zero.
 */
export function initialBearing(a: LatLon, b: LatLon): number | null {
  if (!isValidCoordinate(a) || !isValidCoordinate(b)) return null;

  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLon = toRadians(b.longitude - a.longitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  if (x === 0 && y === 0) return null;

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** Compass point for a bearing, for a human-readable direction. */
export function compassPoint(bearing: number | null): string | null {
  if (bearing === null || !Number.isFinite(bearing)) return null;
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round(bearing / 45) % 8];
}

/** Human-readable distance. Returns null rather than guessing a unit. */
export function formatDistance(metres: number | null): string | null {
  if (metres === null || !Number.isFinite(metres) || metres < 0) return null;
  if (metres < 950) return `${Math.round(metres)} m`;
  if (metres < 10000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres / 1000)} km`;
}

/**
 * Human-readable duration from a duration in seconds.
 *
 * OSRM's duration is a free-flow estimate, not a promise, so callers should
 * present it as an estimate rather than an arrival time.
 */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Format a coordinate for display at a stated precision, never a fake one. */
export function formatCoordinate(point: LatLon | null | undefined, decimals = 5): string | null {
  if (!isValidCoordinate(point)) return null;
  return `${point!.latitude.toFixed(decimals)}, ${point!.longitude.toFixed(decimals)}`;
}

/**
 * Precision-aware accuracy description.
 *
 * A 5 m fix and a 2000 m fix are not the same claim. Words are used rather than
 * a bare number so the user is not left to interpret the magnitude.
 */
export function describeAccuracy(metres: number | null): string | null {
  if (metres === null || !Number.isFinite(metres) || metres < 0) return null;
  if (metres <= 10) return 'Precise (within 10 m)';
  if (metres <= 50) return 'Good (within 50 m)';
  if (metres <= 200) return 'Fair (within 200 m)';
  return `Poor (within ${Math.round(metres / 100) / 10} km)`;
}
