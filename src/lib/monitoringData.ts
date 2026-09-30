import type { SourceStatus } from '@/integrations/adapters/types';

export type RiskLevel = 'safe' | 'moderate' | 'high' | 'critical';
export type SeaCondition = 'calm' | 'rough' | 'veryRough';

/**
 * Operational snapshot derived from normalized source readings.
 *
 * Every measurement is `number | null`. `null` means the source did not
 * publish a usable value — it must be rendered as "no data", never as 0.
 *
 * `riskLevel` is only meaningful while `status` is `live` or `stale`. When
 * `status` is `unavailable` or `offline` the risk field is a placeholder and
 * the UI must present an explicit no-data state instead of "safe".
 */
export interface MonitoringData {
  /**
   * Significant wave height in metres, from the Open-Meteo Marine endpoint.
   * This is wave height, not tide height: no tide gauge is integrated.
   */
  waveHeight: number | null;
  windSpeed: number | null;
  rainProbability: number | null;
  seaCondition: SeaCondition | null;
  riskLevel: RiskLevel;
  status: SourceStatus;
}

/**
 * Alert identifiers.
 *
 * `highWave` is driven by significant wave height from the Open-Meteo Marine
 * endpoint. It is deliberately NOT named `highTide`: no tide gauge is
 * integrated and no tide observation is available anywhere in this codebase.
 * A real tide alert will require its own authoritative tide source and its own
 * identifier added here.
 */
export type AlertType = 'highWave' | 'tsunami' | 'flood' | 'rain';

export interface AlertInfo {
  id: string;
  type: AlertType;
  titleKey: string;
  descKey: string;
  severity: RiskLevel;
  active: boolean;
}

/** Snapshot with no measurements. Used as the initial and empty state. */
export function emptyMonitoringData(): MonitoringData {
  return {
    waveHeight: null,
    windSpeed: null,
    rainProbability: null,
    seaCondition: null,
    riskLevel: 'safe',
    status: 'unavailable',
  };
}

/**
 * Derive the operational snapshot from normalized source values.
 *
 * Thresholds are unchanged from the existing risk engine; the change here is
 * null-safety. Previously any missing input was coerced to `0` and then
 * rendered as a green "safe" reading. Now a missing input propagates as
 * `null` and the snapshot is marked `unavailable` so the UI can say so.
 */
export function deriveMonitoringData(
  waveHeight: number | null,
  windSpeed: number | null,
  rainProbability: number | null,
  status: SourceStatus,
  tsunamiRisk = false
): MonitoringData {
  if (waveHeight === null || windSpeed === null || rainProbability === null) {
    return { ...emptyMonitoringData(), status };
  }

  let seaCondition: SeaCondition = 'calm';
  if (windSpeed > 25) seaCondition = 'veryRough';
  else if (windSpeed > 15) seaCondition = 'rough';

  let riskLevel: RiskLevel = 'safe';
  if (tsunamiRisk || waveHeight > 4.0 || windSpeed > 40 || rainProbability > 85) riskLevel = 'critical';
  else if (waveHeight > 3.5 || windSpeed > 30 || rainProbability > 70) riskLevel = 'high';
  else if (waveHeight > 2.8 || windSpeed > 15 || rainProbability > 50) riskLevel = 'moderate';

  return { waveHeight, windSpeed, rainProbability, seaCondition, riskLevel, status };
}

/**
 * True when a freshness state means the source may be presented as holding
 * real readings. Shared by monitoring and the marine chart so both agree on
 * what "we have data" means.
 */
export function statusHasMeasurements(status: SourceStatus): boolean {
  return status === 'live' || status === 'stale';
}

/** True when the snapshot carries measurements the UI may present as readings. */
export function hasMeasurements(data: MonitoringData): boolean {
  return statusHasMeasurements(data.status);
}

export function getAlerts(data: MonitoringData, tsunamiRisk = false): AlertInfo[] {
  // No usable measurements: every alert stays inactive. An inactive alert
  // here means "no alert", which the UI pairs with an explicit no-data state.
  if (!hasMeasurements(data) || data.waveHeight === null || data.windSpeed === null || data.rainProbability === null) {
    return [
      {
        id: 'highWave',
        type: 'highWave',
        titleKey: 'highWaveWarning',
        descKey: 'highWaveDesc',
        severity: 'safe',
        active: false,
      },
      {
        id: 'tsunami',
        type: 'tsunami',
        titleKey: 'tsunamiRisk',
        descKey: 'tsunamiDesc',
        severity: 'safe',
        active: false,
      },
      {
        id: 'flood',
        type: 'flood',
        titleKey: 'coastalFlood',
        descKey: 'coastalFloodDesc',
        severity: 'safe',
        active: false,
      },
      {
        id: 'rain',
        type: 'rain',
        titleKey: 'heavyRain',
        descKey: 'heavyRainDesc',
        severity: 'safe',
        active: false,
      },
      {
        id: 'storm',
        type: 'rain',
        titleKey: 'stormWarning',
        descKey: 'stormWarningDesc',
        severity: 'safe',
        active: false,
      },
    ];
  }

  return [
    {
      id: 'highWave',
      type: 'highWave',
      titleKey: 'highWaveWarning',
      descKey: 'highWaveDesc',
      severity: data.waveHeight > 4.0 ? 'critical' : data.waveHeight > 3.5 ? 'high' : 'moderate',
      active: data.waveHeight > 3.0,
    },
    {
      id: 'tsunami',
      type: 'tsunami',
      titleKey: 'tsunamiRisk',
      descKey: 'tsunamiDesc',
      severity: 'critical',
      active: tsunamiRisk || (data.waveHeight > 4.5 && data.windSpeed > 25),
    },
    {
      id: 'flood',
      type: 'flood',
      titleKey: 'coastalFlood',
      descKey: 'coastalFloodDesc',
      severity: data.rainProbability > 85 ? 'critical' : 'high',
      active: data.rainProbability > 70,
    },
    {
      id: 'rain',
      type: 'rain',
      titleKey: 'heavyRain',
      descKey: 'heavyRainDesc',
      severity: data.rainProbability > 80 ? 'high' : 'moderate',
      active: data.rainProbability > 50,
    },
    {
      id: 'storm',
      type: 'rain',
      titleKey: 'stormWarning',
      descKey: 'stormWarningDesc',
      severity: data.windSpeed > 40 ? 'critical' : 'high',
      active: data.windSpeed > 30,
    },
  ];
}

export const riskColors: Record<RiskLevel, string> = {
  safe: 'status-safe',
  moderate: 'status-warning',
  high: 'status-danger',
  critical: 'status-danger',
};

export const riskGlows: Record<RiskLevel, string> = {
  safe: 'glow-primary',
  moderate: 'glow-warning',
  high: 'glow-danger',
  critical: 'glow-danger',
};