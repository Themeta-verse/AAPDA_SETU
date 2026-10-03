import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  deriveMonitoringData,
  emptyMonitoringData,
  getAlerts,
  hasMeasurements,
  riskLevelFromCoastalState,
  type MonitoringData,
  type AlertInfo,
} from '@/lib/monitoringData';
import { resolveFreshness } from '@/integrations/adapters/freshness';
import { useSharedCoastalIntelligence } from './CoastalIntelligenceProvider';

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

/**
 * Legacy monitoring view.
 *
 * This hook no longer decides the risk level. It reads the SINGLE canonical
 * assessment produced by `useCoastalIntelligence` -> `assessCoastalRisk` and
 * maps it onto the presentation tier the older banner/hero/mobile components
 * expect. It previously ran a private copy of the wave/wind/rain thresholds,
 * which let the header and the command center disagree about the same reading.
 *
 * `tsunamiFlag` is the tri-state USGS value. It is passed through unchanged:
 * an unreadable feed yields `null`, which is reported as "not flagged, status
 * unknown" by the UI rather than as an all-clear. It is never derived from
 * magnitude or from wave height.
 */
export function useMonitoring(
  intervalMs = 10000,
  _coordinates?: { latitude: number; longitude: number },
  _isCoastal?: boolean
) {
  // ONE shared pipeline. This hook previously called useWeatherData(),
  // useEarthquakeData() and useCoastalIntelligence() itself while
  // CoastalCommandCenter called useCoastalIntelligence() again, so one page load
  // issued three identical USGS requests and three marine/weather pairs. Every
  // value below now comes from the single provider-owned state object.
  const intelligence = useSharedCoastalIntelligence();
  const marine = intelligence.marine;
  const feed = intelligence.earthquakes;
  const [data, setData] = useState<MonitoringData>(() => emptyMonitoringData());
  const [alerts, setAlerts] = useState<AlertInfo[]>([]);
  const [clock, setClock] = useState(new Date());

  // The tri-state flag comes from the engine's own reduction over the shared
  // feed, so it is identical to the one the command center and alerts use.
  const tsunamiFlag = intelligence.seismic.tsunamiFlag;
  const riskLevel = riskLevelFromCoastalState(intelligence.assessment.state);

  // Shape the shared feed into the view model the older dashboard expects.
  // This is pure adaptation, not a second fetch: the events, timestamps and
  // validation counts are the ones already read by the single pipeline.
  const earthquakes = useMemo(
    () => ({
      events: feed.events,
      tsunamiFlag,
      status: feed.status,
      fetchedAt: feed.fetchedAt,
      feedGeneratedAt: feed.feedGeneratedAt,
      source: feed.source,
      totalInFeed: feed.totalInFeed,
      rejectedCount: feed.rejectedCount,
      error: feed.error,
      // Refetching is the shared pipeline's job; expose it as a no-op so a
      // consumer cannot start a competing request.
      refetch: () => intelligence.refresh(),
    }),
    [feed, tsunamiFlag, intelligence.refresh],
  );

  const refresh = useCallback(() => {
    const status = currentStatus(marine);
    const next = deriveMonitoringData(
      marine.waveHeight,
      marine.windSpeed,
      marine.rainProbability,
      status,
      riskLevel
    );
    setData(next);
    setAlerts(getAlerts(next, tsunamiFlag));
  }, [marine, riskLevel, tsunamiFlag]);

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
    /** Tri-state: true / false / null when the feed could not be read. */
    tsunamiRisk: tsunamiFlag,
    sourceStatus,
    hasData,
    /** The canonical assessment, for any component that needs the full picture. */
    assessment: intelligence.assessment,
    officialWarnings: intelligence.officialWarnings,
  };
}
