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
   * Null in inland urban zones where marine monitoring is not applicable.
   */
  waveHeight: number | null;
  windSpeed: number | null;
  rainProbability: number | null;
  seaCondition: SeaCondition | null;
  riskLevel: RiskLevel;
  status: SourceStatus;
  /** Whether coastal monitoring is geographically applicable to this zone. */
  isCoastal?: boolean;
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
export function emptyMonitoringData(isCoastal = true): MonitoringData {
  return {
    waveHeight: null,
    windSpeed: null,
    rainProbability: null,
    seaCondition: null,
    riskLevel: 'safe',
    status: 'unavailable',
    isCoastal,
  };
}

/**
 * Derive the operational snapshot from normalized source values.
 *
 * Thresholds support both coastal hazards and inland urban flooding/wind hazards.
 * For inland zones, marine metrics are marked non-applicable without falsifying zero readings.
 */
export function deriveMonitoringData(
  waveHeight: number | null,
  windSpeed: number | null,
  rainProbability: number | null,
  status: SourceStatus,
  tsunamiRisk = false,
  isCoastal = true
): MonitoringData {
  if (isCoastal) {
    if (waveHeight === null || windSpeed === null || rainProbability === null) {
      return { ...emptyMonitoringData(true), status };
    }
  } else {
    // Inland urban zone: waveHeight is not applicable
    if (windSpeed === null || rainProbability === null) {
      return { ...emptyMonitoringData(false), status };
    }
  }

  let seaCondition: SeaCondition | null = null;
  if (isCoastal) {
    seaCondition = 'calm';
    if (windSpeed > 25) seaCondition = 'veryRough';
    else if (windSpeed > 15) seaCondition = 'rough';
  }

  let riskLevel: RiskLevel = 'safe';
  if (isCoastal) {
    if (tsunamiRisk || (waveHeight !== null && waveHeight > 4.0) || windSpeed > 40 || rainProbability > 85) riskLevel = 'critical';
    else if ((waveHeight !== null && waveHeight > 3.5) || windSpeed > 30 || rainProbability > 70) riskLevel = 'high';
    else if ((waveHeight !== null && waveHeight > 2.8) || windSpeed > 15 || rainProbability > 50) riskLevel = 'moderate';
  } else {
    // Inland urban hazard thresholds: precipitation runoff, urban waterlogging, and gale winds
    if (windSpeed > 40 || rainProbability > 85) riskLevel = 'critical';
    else if (windSpeed > 30 || rainProbability > 70) riskLevel = 'high';
    else if (windSpeed > 15 || rainProbability > 50) riskLevel = 'moderate';
  }

  return {
    waveHeight: isCoastal ? waveHeight : null,
    windSpeed,
    rainProbability,
    seaCondition,
    riskLevel,
    status,
    isCoastal,
  };
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
  const isCoastal = data.isCoastal ?? true;
  const hasBaseMeasurements = isCoastal
    ? hasMeasurements(data) && data.waveHeight !== null && data.windSpeed !== null && data.rainProbability !== null
    : hasMeasurements(data) && data.windSpeed !== null && data.rainProbability !== null;

  if (!hasBaseMeasurements) {
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
      severity: isCoastal && data.waveHeight !== null ? (data.waveHeight > 4.0 ? 'critical' : data.waveHeight > 3.5 ? 'high' : 'moderate') : 'safe',
      active: isCoastal && data.waveHeight !== null && data.waveHeight > 3.0,
    },
    {
      id: 'tsunami',
      type: 'tsunami',
      titleKey: 'tsunamiRisk',
      descKey: 'tsunamiDesc',
      severity: 'critical',
      active: isCoastal && (tsunamiRisk || (data.waveHeight !== null && data.waveHeight > 4.5 && data.windSpeed! > 25)),
    },
    {
      id: 'flood',
      type: 'flood',
      titleKey: 'coastalFlood',
      descKey: 'coastalFloodDesc',
      severity: data.rainProbability! > 85 ? 'critical' : 'high',
      active: data.rainProbability! > 70,
    },
    {
      id: 'rain',
      type: 'rain',
      titleKey: 'heavyRain',
      descKey: 'heavyRainDesc',
      severity: data.rainProbability! > 80 ? 'high' : 'moderate',
      active: data.rainProbability! > 50,
    },
    {
      id: 'storm',
      type: 'rain',
      titleKey: 'stormWarning',
      descKey: 'stormWarningDesc',
      severity: data.windSpeed! > 40 ? 'critical' : 'high',
      active: data.windSpeed! > 30,
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