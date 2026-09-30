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

/**
 * Re-derive freshness from the reading's own `fetchedAt` against the current
 * clock. The adapter stamps freshness at fetch time; this keeps a retained
 * reading from staying "live" while the tab sits open without refetching.
 */
function currentStatus(marine: { fetchedAt: string | null; waveHeight: number | null }): MonitoringData['status'] {
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  return resolveFreshness(
    marine.fetchedAt,
    marine.waveHeight !== null,
    new Date(),
    isOnline
  );
}

export function useMonitoring(intervalMs = 10000) {
  const { marine } = useWeatherData();
  const earthquakes = useEarthquakeData(300000);

  const [data, setData] = useState<MonitoringData>(() => emptyMonitoringData());
  const [alerts, setAlerts] = useState<AlertInfo[]>([]);
  const [clock, setClock] = useState(new Date());

  /**
   * The risk engine keeps its existing `tsunamiRisk: boolean` parameter, so a
   * USGS-flagged tsunami (`tsunami === true`) raises it exactly as before.
   *
   * A tri-state `null` — source unreadable, or a matched event with no usable
   * flag — deliberately does NOT become `true`. It also does not become
   * `false` here: the hook exposes the null unchanged so the UI can state that
   * the tsunami signal is unknown rather than showing an all-clear.
   */
  const tsunamiRisk = earthquakes.tsunamiFlag === true;

  const refresh = useCallback(() => {
    const status = currentStatus(marine);
    const next = deriveMonitoringData(
      marine.waveHeight,
      marine.windSpeed,
      marine.rainProbability,
      status,
      tsunamiRisk
    );
    setData(next);
    setAlerts(getAlerts(next, tsunamiRisk));
  }, [marine, tsunamiRisk]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const sourceStatus = data.status;
  const hasData = hasMeasurements(data);

  return {
    data,
    alerts,
    clock,
    refresh,
    marine,
    earthquakes,
    tsunamiRisk,
    sourceStatus,
    hasData,
  };
}