import { useState, useEffect, useCallback } from 'react';
import { deriveMonitoringData, getAlerts, type MonitoringData, type AlertInfo } from '@/lib/monitoringData';
import { useWeatherData } from './useWeatherData';
import { useEarthquakeData } from './useEarthquakeData';

export function useMonitoring(intervalMs = 10000) {
  const { weather, marineHourly } = useWeatherData(300000); // 5 min
  const { earthquakes, tsunamiRisk } = useEarthquakeData(300000);
  const [data, setData] = useState<MonitoringData>(() => ({
    tideLevel: null,
    windSpeed: null,
    rainProbability: null,
    seaCondition: 'calm',
    riskLevel: 'safe',
    isLive: false,
  }));
  const [alerts, setAlerts] = useState<AlertInfo[]>([]);
  const [clock, setClock] = useState(new Date());
  const [sourceStatus, setSourceStatus] = useState<'live' | 'stale' | 'unavailable' | 'offline'>('unavailable');

  const refresh = useCallback(() => {
    let newData: MonitoringData;
    let newAlerts: AlertInfo[];

    if (weather.isLive) {
      newData = deriveMonitoringData(
        weather.waveHeight,
        weather.windSpeed,
        weather.rainProbability,
        true,
        tsunamiRisk
      );
      newAlerts = getAlerts(newData, tsunamiRisk);
      setSourceStatus('live');
    } else {
      // No live data available - show unavailable state
      newData = {
        tideLevel: null,
        windSpeed: null,
        rainProbability: null,
        seaCondition: 'calm',
        riskLevel: 'safe',
        isLive: false,
      };
      newAlerts = getAlerts(newData, tsunamiRisk);
      setSourceStatus('unavailable');
    }

    setData(newData);
    setAlerts(newAlerts);
  }, [weather, tsunamiRisk]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return { data, alerts, clock, refresh, weather, marineHourly, earthquakes, tsunamiRisk, sourceStatus };
}
