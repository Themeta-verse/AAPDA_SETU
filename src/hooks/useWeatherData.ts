import { useState, useEffect, useCallback } from 'react';
import {
  emptyMarineReading,
  fetchMarineReading,
} from '@/integrations/adapters/openMeteoMarine';
import { LIVE_MAX_AGE_MS } from '@/integrations/adapters/freshness';
import type { MarineHourlyPoint, NormalizedMarine } from '@/integrations/adapters/types';

/** Default coastal observation coordinates (Mumbai Coast) */
export const DEFAULT_COASTAL_COORDS = { latitude: 19.1075, longitude: 72.8263 };

export type { MarineHourlyPoint, NormalizedMarine } from '@/integrations/adapters/types';

export interface MarineState {
  marine: NormalizedMarine;
  error: string | null;
  refetch: () => void;
}

/**
 * Marine observation state.
 *
 * Supports dynamic urban location coordinates. If the selected zone is inland,
 * marine reading is safely held as 'unavailable' without issuing invalid marine API queries.
 */
export function useWeatherData(
  intervalMs = LIVE_MAX_AGE_MS,
  coords = DEFAULT_COASTAL_COORDS,
  isCoastal = true
): MarineState {
  const [marine, setMarine] = useState<NormalizedMarine>(() =>
    emptyMarineReading(coords)
  );
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = useCallback(async () => {
    if (!isCoastal) {
      try {
        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,surface_pressure,precipitation_probability`;
        const res = await fetch(forecastUrl);
        if (res.ok) {
          const body = await res.json();
          const current = body?.current ?? {};
          const nowStr = new Date().toISOString();
          setMarine({
            status: 'live',
            fetchedAt: nowStr,
            source: {
              id: 'open-meteo-weather',
              label: 'Open-Meteo Forecast',
              authority: 'official',
              url: forecastUrl,
              observedAt: current.time ?? null,
            },
            waveHeight: null,
            waveDirection: null,
            wavePeriod: null,
            hourly: [],
            windSpeed: typeof current.wind_speed_10m === 'number' ? current.wind_speed_10m : null,
            windDirection: typeof current.wind_direction_10m === 'number' ? current.wind_direction_10m : null,
            rainProbability: typeof current.precipitation_probability === 'number' ? current.precipitation_probability : null,
            temperature: typeof current.temperature_2m === 'number' ? current.temperature_2m : null,
            pressure: typeof current.surface_pressure === 'number' ? current.surface_pressure : null,
            error: null,
          });
          setError(null);
          return;
        }
      } catch (e) {
        // Fallback to offline / unavailable empty reading
      }
      setMarine(emptyMarineReading(coords));
      setError(null);
      return;
    }

    const reading = await fetchMarineReading(coords);
    setMarine(reading);
    setError(reading.error ? reading.error.message : null);
  }, [coords.latitude, coords.longitude, isCoastal]);

  useEffect(() => {
    fetchWeather();
    const id = setInterval(fetchWeather, intervalMs);
    return () => clearInterval(id);
  }, [fetchWeather, intervalMs]);

  return { marine, error, refetch: fetchWeather };
}