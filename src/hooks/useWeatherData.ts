import { useState, useEffect, useCallback } from 'react';

// Juhu Beach coordinates
const JUHU_LAT = 19.1075;
const JUHU_LON = 72.8263;

export interface WeatherData {
  waveHeight: number;
  waveDirection: number;
  wavePeriod: number;
  windSpeed: number;
  rainProbability: number;
  temperature: number;
  windDirection: number;
  weatherCode: number;
  pressure: number;
  lastFetched: Date | null;
  isLive: boolean;
}

export interface MarineHourlyData {
  time: string;
  waveHeight: number;
}

const FALLBACK: WeatherData = {
  waveHeight: 1.2,
  waveDirection: 0,
  wavePeriod: 6,
  windSpeed: 12,
  rainProbability: 20,
  temperature: 30,
  windDirection: 270,
  weatherCode: 0,
  pressure: 1013,
  lastFetched: null,
  isLive: false,
};

export function useWeatherData(intervalMs = 300000) {
  const [weather, setWeather] = useState<WeatherData>(FALLBACK);
  const [marineHourly, setMarineHourly] = useState<MarineHourlyData[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = useCallback(async () => {
    try {
      const [weatherRes, marineRes] = await Promise.all([
        fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${JUHU_LAT}&longitude=${JUHU_LON}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,surface_pressure&hourly=precipitation_probability&forecast_days=1&timezone=Asia/Kolkata`
        ),
        fetch(
          `https://marine-api.open-meteo.com/v1/marine?latitude=${JUHU_LAT}&longitude=${JUHU_LON}&current=wave_height,wave_direction,wave_period&hourly=wave_height&forecast_days=1&timezone=Asia/Kolkata`
        ),
      ]);

      const [weatherData, marineData] = await Promise.all([
        weatherRes.json(),
        marineRes.json(),
      ]);

      const currentHour = new Date().getHours();
      const rainProb = weatherData?.hourly?.precipitation_probability?.[currentHour] ?? FALLBACK.rainProbability;

      // Parse marine hourly data for tide chart
      const hourlyTimes: string[] = marineData?.hourly?.time ?? [];
      const hourlyWaves: number[] = marineData?.hourly?.wave_height ?? [];
      const hourlyData: MarineHourlyData[] = hourlyTimes.map((t: string, i: number) => ({
        time: t,
        waveHeight: hourlyWaves[i] ?? 0,
      }));
      setMarineHourly(hourlyData);

      setWeather({
        waveHeight: marineData?.current?.wave_height ?? FALLBACK.waveHeight,
        waveDirection: marineData?.current?.wave_direction ?? FALLBACK.waveDirection,
        wavePeriod: marineData?.current?.wave_period ?? FALLBACK.wavePeriod,
        windSpeed: Math.round(weatherData?.current?.wind_speed_10m ?? FALLBACK.windSpeed),
        rainProbability: rainProb,
        temperature: Math.round(weatherData?.current?.temperature_2m ?? FALLBACK.temperature),
        windDirection: weatherData?.current?.wind_direction_10m ?? FALLBACK.windDirection,
        weatherCode: weatherData?.current?.weather_code ?? 0,
        pressure: Math.round(weatherData?.current?.surface_pressure ?? FALLBACK.pressure),
        lastFetched: new Date(),
        isLive: true,
      });
      setError(null);
    } catch (err) {
      console.warn('Weather fetch failed, using fallback:', err);
      setError('Unable to fetch live weather data');
      setWeather(prev => ({ ...prev, isLive: false }));
    }
  }, []);

  useEffect(() => {
    fetchWeather();
    const id = setInterval(fetchWeather, intervalMs);
    return () => clearInterval(id);
  }, [fetchWeather, intervalMs]);

  return { weather, marineHourly, error, refetch: fetchWeather };
}
