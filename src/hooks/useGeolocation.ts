import { useState, useEffect, useCallback, useRef } from 'react';
import {
  distanceMetres,
  initialBearing,
  compassPoint,
  describeAccuracy,
  formatCoordinate,
  type LatLon,
} from '@/lib/geo';

/**
 * Real device geolocation.
 *
 * ===================================================================
 * WHAT CHANGED AND WHY
 * ===================================================================
 *
 * The previous version of this hook hardcoded `72.84` and `19.1` as the
 * "evacuation destination" and derived a compass direction toward them. Those are
 * not the coordinates of any destination; they are two literals that happened to
 * look like Mumbai. Every direction it produced was therefore wrong for every
 * user except by coincidence, and it presented the result as guidance.
 *
 * There is no fixed destination here any more. A direction exists only when a
 * real destination has been supplied, and it is computed by real geodesy from
 * the user's real fix to that destination's real coordinates.
 *
 * HONESTY RULES
 * -------------
 * - `position` stays null until the browser actually returns a fix.
 * - Every failure mode has its own state. "Denied", "unavailable" and "timeout"
 *   are different problems with different remedies, so they are not collapsed
 *   into one generic error string.
 * - A stale fix is aged out rather than displayed indefinitely as if current.
 * - No fallback position is ever substituted. If GPS fails, the app has no user
 *   location, and the UI must say so.
 */

/** The monitored coastal point. This is NOT the user's location. */
export const MONITORED_POINT: LatLon = { latitude: 19.0988, longitude: 72.8267 };
export const MONITORED_POINT_LABEL = 'Juhu Beach, Mumbai';

export type GeolocationStatus =
  | 'idle'
  | 'locating'
  | 'ready'
  | 'denied'
  | 'unavailable'
  | 'timeout'
  | 'unsupported'
  | 'error';

/** A fix older than this is not presented as current. */
const STALE_AFTER_MS = 120000;

export interface GeoFix {
  latitude: number;
  longitude: number;
  /** Horizontal accuracy radius in metres, as reported by the device. */
  accuracyM: number;
  /** Epoch milliseconds when the fix was taken. */
  at: number;
}

const STATUS_MESSAGE: Record<GeolocationStatus, string> = {
  idle: 'Your location has not been requested yet.',
  locating: 'Asking your device for a location fix…',
  ready: 'Location acquired.',
  denied:
    'Location permission was denied. BayWatch cannot show your position or route you ' +
    'without it. You can still use the monitored beach point and read every source.',
  unavailable:
    'Your device could not determine a position. This is common indoors or with ' +
    'location services switched off.',
  timeout: 'Your device did not return a position in time. Moving somewhere with a clearer view of the sky, or enabling location services, usually helps.',
  unsupported: 'This browser does not support the Geolocation API.',
  error: 'An unexpected error occurred while locating you.',
};

export interface UseGeolocationOptions {
  /** Stop watching once this many milliseconds have passed. */
  timeoutMs?: number;
  enableHighAccuracy?: boolean;
  /** Age at which a fix is treated as stale. */
  staleAfterMs?: number;
}

export function useGeolocation(options: UseGeolocationOptions = {}) {
  const {
    timeoutMs = 15000,
    enableHighAccuracy = true,
    staleAfterMs = STALE_AFTER_MS,
  } = options;

  const [fix, setFix] = useState<GeoFix | null>(null);
  const [status, setStatus] = useState<GeolocationStatus>('idle');
  const [watching, setWatching] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  // Drives re-render as a fix ages so it can be reported stale without the user
  // having to interact.
  const [clock, setClock] = useState(() => Date.now());

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setWatching(false);
  }, []);

  const onError = useCallback((error: GeolocationPositionError) => {
    // The numeric code is the only reliable way to distinguish these; the
    // browser's `message` is localised and inconsistent.
    switch (error.code) {
      case error.PERMISSION_DENIED:
        setStatus('denied');
        break;
      case error.POSITION_UNAVAILABLE:
        setStatus('unavailable');
        break;
      case error.TIMEOUT:
        setStatus('timeout');
        break;
      default:
        setStatus('error');
    }
  }, []);

  const requestLocation = useCallback(() => {
    // Truthiness, not `'geolocation' in navigator`: the property can exist
    // while holding no implementation, and calling a method on that would
    // throw instead of reaching the honest `unsupported` state.
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unsupported');
      return;
    }

    stopWatching();
    setStatus('locating');

    const accept = (position: GeolocationPosition) => {
      const { latitude, longitude, accuracy } = position.coords;

      // A device can in principle report a non-finite value. Rejecting it here
      // prevents NaN from propagating into a distance or a map centre.
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        setStatus('error');
        return;
      }

      setFix({ latitude, longitude, accuracyM: accuracy, at: position.timestamp || Date.now() });
      setStatus('ready');
      setClock(Date.now());
    };

    navigator.geolocation.getCurrentPosition(accept, onError, {
      enableHighAccuracy,
      timeout: timeoutMs,
      // A fix up to 30 s old is acceptable and avoids a needless GPS cold start.
      maximumAge: 30000,
    });

    // Continue tracking so a moving user is not stranded on a first fix. This
    // only starts after an explicit request, so it never prompts unasked.
    if (typeof navigator.geolocation.watchPosition === 'function') {
      setWatching(true);
      watchIdRef.current = navigator.geolocation.watchPosition(accept, onError, {
        enableHighAccuracy,
        maximumAge: 10000,
        timeout: 60000,
      });
    }
  }, [enableHighAccuracy, onError, stopWatching, timeoutMs]);

  // Age the fix so it can be reported as stale rather than shown as live.
  useEffect(() => {
    if (!fix) return;
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [fix]);

  useEffect(() => stopWatching, [stopWatching]);

  const isStale = fix !== null && clock - fix.at > staleAfterMs;
  const hasFix = fix !== null && !isStale;

  const position: LatLon | null = hasFix ? { latitude: fix!.latitude, longitude: fix!.longitude } : null;

  /**
   * Real distance and direction to a supplied destination.
   *
   * Null whenever either endpoint is unknown. There is no default destination,
   * so this cannot return a direction toward a hardcoded point.
   */
  const destination = useCallback(
    (to: LatLon | null | undefined) => {
      if (!position || !to) {
        return { distanceM: null, bearing: null, compass: null };
      }
      const bearing = initialBearing(position, to);
      return {
        distanceM: distanceMetres(position, to),
        bearing,
        compass: compassPoint(bearing),
      };
    },
    [position],
  );

  return {
    position,
    fix,
    status,
    statusMessage: STATUS_MESSAGE[status],
    /** True when a fix exists and is still within the freshness window. */
    hasFix,
    isStale,
    watching,
    requestLocation,
    stopWatching,
    /** "19.09880, 72.82670" or null. Never a fabricated coordinate. */
    formatted: formatCoordinate(position),
    accuracyLabel: fix ? describeAccuracy(fix.accuracyM) : null,
    accuracyM: fix?.accuracyM ?? null,
    /** Age of the current fix in seconds, or null when there is none. */
    ageSeconds: fix ? Math.max(0, Math.round((clock - fix.at) / 1000)) : null,
    /** Distance to the monitored beach point, metres, or null. */
    distanceToMonitoredM: position ? distanceMetres(position, MONITORED_POINT) : null,
    destination,
  };
}

export type UseGeolocationReturn = ReturnType<typeof useGeolocation>;
