import { useState, useEffect, useCallback } from 'react';
import {
  deriveMonitoringData,
  emptyMonitoringData,
  getAlerts,
  hasMeasurements,
  type MonitoringData,
  type AlertInfo,
} from '@/lib/monitoringData';
import { resolveFreshness } from '@/integrations/adapters/freshness';
import { useWeatherData } from './useWeatherData';
import { useEarthquakeData } from './useEarthquakeData';
import { useNetworkStatus } from './useNetworkStatus';
import { loadFromCache, saveToCache, CACHE_KEYS } from '@/lib/offlineCache';

/**
 * Re-derive freshness from the reading's own `fetchedAt` against the current
 * clock. The adapter stamps freshness at fetch time; this keeps a retained
 * reading from staying "live" while the tab sits open without refetching.
 */
function currentStatus(marine: { fetchedAt: string | null; waveHeight: number | null }, isOnline: boolean): MonitoringData['status'] {
  return resolveFreshness(
    marine.fetchedAt,
    marine.waveHeight !== null,
    new Date(),
    isOnline
  );
}

export function useMonitoring(intervalMs = 10000) {
  const { marine, weather, marineHourly } = useWeatherData(300000);
  const { earthquakes, tsunamiFlag } = useEarthquakeData(300000);
  const { isOnline } = useNetworkStatus();

  const [data, setData] = useState<MonitoringData>(() => {
    const cached = loadFromCache<MonitoringData>(CACHE_KEYS.MONITORING_DATA);
    if (cached) {
      return { ...cached.data, isLive: false };
    }
    return emptyMonitoringData();
  });
  const [alerts, setAlerts] = useState<AlertInfo[]>(() => {
    const cached = loadFromCache<AlertInfo[]>(CACHE_KEYS.ALERTS);
    return cached?.data ?? [];
  });
  const [clock, setClock] = useState(new Date());
  const [sourceStatus, setSourceStatus] = useState<MonitoringData['status']>('unavailable');

  /**
   * The risk engine keeps its existing `tsunamiRisk: boolean` parameter, so a
   * USGS-flagged tsunami (`tsunami === true`) raises it exactly as before.
   *
   * A tri-state `null` — source unreadable, or a matched event with no usable
   * flag — deliberately does NOT become `true`. It also does not become
   * `false` here: the hook exposes the null unchanged so the UI can state that
   * the tsunami signal is unknown rather than showing an all-clear.
   */
  const tsunamiRisk = tsunamiFlag === true;

  const refresh = useCallback(() => {
    let newData: MonitoringData;
    let newAlerts: AlertInfo[];

    // Use marine.status from the normalized marine adapter instead of the
    // deprecated weather.isLive. The adapter provides a normalized status:
    // 'live' | 'stale' | 'unavailable' | 'offline'
    const marineStatus = marine.status;

    if (marineStatus === 'live' || marineStatus === 'stale') {
      const status = currentStatus(marine, isOnline);
      newData = deriveMonitoringData(
        marine.waveHeight,
        marine.windSpeed,
        marine.rainProbability,
        status,
        tsunamiRisk
      );
      newAlerts = getAlerts(newData, tsunamiRisk);
      setSourceStatus(status);

      saveToCache(CACHE_KEYS.MONITORING_DATA, newData, 'Open-Meteo');
      saveToCache(CACHE_KEYS.ALERTS, newAlerts, 'Open-Meteo');
    } else {
      if (isOnline) {
        newData = emptyMonitoringData();
        newAlerts = getAlerts(newData, tsunamiRisk);
        setSourceStatus('unavailable');
      } else {
        const cachedData = loadFromCache<MonitoringData>(CACHE_KEYS.MONITORING_DATA);
        const cachedAlerts = loadFromCache<AlertInfo[]>(CACHE_KEYS.ALERTS);

        if (cachedData) {
          newData = { ...cachedData.data, isLive: false };
          newAlerts = cachedAlerts?.data ?? getAlerts(newData, tsunamiRisk);
          setSourceStatus('stale');
        } else {
          newData = emptyMonitoringData();
          newAlerts = getAlerts(newData, tsunamiRisk);
          setSourceStatus('offline');
        }
      }
    }

    setData(newData);
    setAlerts(newAlerts);
  }, [weather, marine, isOnline, tsunamiRisk]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hasData = hasMeasurements(data);

  return {
    data,
    alerts,
    clock,
    refresh,
    weather,
    marine,
    marineHourly,
    earthquakes,
    tsunamiRisk,
    sourceStatus,
    hasData,
  };
}