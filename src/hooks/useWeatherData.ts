import { useState, useEffect, useCallback } from 'react';
import {
  emptyMarineReading,
  fetchMarineReading,
} from '@/integrations/adapters/openMeteoMarine';
import { LIVE_MAX_AGE_MS } from '@/integrations/adapters/freshness';
import type { MarineHourlyPoint, NormalizedMarine } from '@/integrations/adapters/types';

// Juhu Beach coordinates — the single observation point for marine data.
const JUHU_COORDS = { latitude: 19.1075, longitude: 72.8263 };

export type { MarineHourlyPoint, NormalizedMarine } from '@/integrations/adapters/types';

export interface MarineState {
  marine: NormalizedMarine;
  error: string | null;
  refetch: () => void;
}

/**
 * Marine observation state.
 *
 * The adapter owns fetching, validation and normalisation; this hook only
 * owns the React lifecycle. When a fetch fails we keep the last real reading
 * and re-derive freshness from its `fetchedAt`, so the source ages into
 * `stale` and then `unavailable` instead of being silently frozen as live.
 */
export function useWeatherData(intervalMs = LIVE_MAX_AGE_MS): MarineState {
  const [marine, setMarine] = useState<NormalizedMarine>(() =>
    emptyMarineReading(JUHU_COORDS)
  );
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = useCallback(async () => {
    const reading = await fetchMarineReading(JUHU_COORDS);
    setMarine(reading);
    setError(reading.error ? reading.error.message : null);
  }, []);

  useEffect(() => {
    fetchWeather();
    const id = setInterval(fetchWeather, intervalMs);
    return () => clearInterval(id);
  }, [fetchWeather, intervalMs]);

  return { marine, error, refetch: fetchWeather };
}