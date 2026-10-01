import type { SourceStatus } from '@/integrations/adapters/types';
import type { CoastalRiskState } from '@/risk/engine';

export type RiskLevel = 'safe' | 'moderate' | 'high' | 'critical';
export type SeaCondition = 'calm' | 'rough' | 'veryRough';

/**
 * Presentation tier for the four legacy colour states.
 *
 * `null` means NO VERDICT COULD BE REACHED. It is deliberately distinct from
 * `'safe'`: the UI must show "cannot determine", never a green reading, when
 * required inputs are missing.
 */
export type RiskLevelOrUnknown = RiskLevel | null;

/**
 * Map the single canonical risk engine verdict onto the presentation tier used
 * by the legacy banner/hero/mobile-alert components.
 *
 * There is exactly ONE risk calculation in this application: `assessCoastalRisk`
 * in `src/risk/engine.ts`. This function is a pure presentation mapping of that
 * verdict and never applies a threshold of its own. `unknown` maps to `null`.
 */
export function riskLevelFromCoastalState(state: CoastalRiskState): RiskLevelOrUnknown {
  switch (state) {
    case 'nominal':
      return 'safe';
    case 'watch':
    case 'elevated':
      return 'moderate';
    case 'high':
    case 'severe':
      return 'critical';
    case 'unknown':
    default:
      return null;
  }
}

/**
 * Operational snapshot derived from normalized source readings.
 *
 * Every measurement is `number | null`. `null` means the source did not
 * publish a usable value — it must be rendered as "no data", never as 0.
 *
 * `riskLevel` is NOT computed here. It is the presentation tier of the single
 * canonical verdict produced by `assessCoastalRisk`, passed in by the caller.
 * It is `null` when the engine could not reach a verdict, which is NOT the
 * same as `'safe'`.
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
  /** Presentation tier of the canonical risk verdict; `null` = no verdict. */
  riskLevel: RiskLevelOrUnknown;
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
export type AlertType = 'highWave' | 'tsunami' | 'flood' | 'rain' | 'storm';

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
    riskLevel: null,
    status: 'unavailable',
  };
}

/**
 * Assemble the operational snapshot from normalized source values plus the
 * canonical risk verdict.
 *
 * This function performs NO threshold comparison of its own. It used to carry a
 * private copy of the wave/wind/rain thresholds, which meant the dashboard could
 * report a different risk level from the command center reading the same data
 * through `assessCoastalRisk`. The threshold table now lives in exactly one
 * place: `src/risk/engine.ts`.
 *
 * `seaCondition` remains a wind-only label. With no wind reading we cannot
 * support any condition label, including "calm", so it stays `null`.
 *
 * PARTIAL READINGS ARE KEPT. A missing input must not discard a perfectly good
 * published wave height, and it must never coerce the verdict to "safe" — a
 * missing gust could be the one that mattered. The verdict arrives from the
 * engine, which reports `unknown` when it cannot support a claim.
 */
export function deriveMonitoringData(
  waveHeight: number | null,
  windSpeed: number | null,
  rainProbability: number | null,
  status: SourceStatus,
  riskLevel: RiskLevelOrUnknown
): MonitoringData {
  // No usable measurement at all: this is genuinely a no-data state.
  if (waveHeight === null && windSpeed === null && rainProbability === null) {
    return { ...emptyMonitoringData(), status };
  }

  // A claim about the sea surface is a claim about wind only.
  const seaCondition: SeaCondition | null =
    windSpeed === null ? null : windSpeed > 25 ? 'veryRough' : windSpeed > 15 ? 'rough' : 'calm';

  return {
    waveHeight,
    windSpeed,
    rainProbability,
    seaCondition,
    riskLevel,
    status,
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

/**
 * Per-condition alert cards.
 *
 * `active` means "this condition's own threshold is currently exceeded by a real
 * published measurement", or — for tsunami — "an authoritative source flagged it".
 *
 * Two rules are load-bearing here:
 *
 *  1. A tsunami alert is raised ONLY from the USGS tsunami flag. It is never
 *     inferred from wave height and wind. This function used to activate a
 *     tsunami alert on `waveHeight > 4.5 && windSpeed > 25`, which invented a
 *     tsunami out of ordinary rough-sea conditions and would have instructed a
 *     user to evacuate on nothing but a model forecast.
 *  2. A condition with no measurement is `active: false` AND carries the reason
 *     it could not be evaluated, so the UI says "no data" rather than "all
 *     clear".
 */
export function getAlerts(
  data: MonitoringData,
  tsunamiFlagged: boolean | null = null
): AlertInfo[] {
  const hasAll = (k: 'waveHeight' | 'windSpeed' | 'rainProbability') => data[k] !== null;

  return [
    {
      id: 'highWave',
      type: 'highWave',
      titleKey: 'highWaveWarning',
      descKey: 'highWaveDesc',
      severity: hasAll('waveHeight') && data.waveHeight! > 4.0 ? 'critical'
        : hasAll('waveHeight') && data.waveHeight! > 3.0 ? 'high'
        : 'safe',
      active: hasAll('waveHeight') && data.waveHeight! > 3.0,
    },
    {
      id: 'tsunami',
      type: 'tsunami',
      titleKey: 'tsunamiRisk',
      descKey: 'tsunamiDesc',
      // An unknown flag is NOT an all-clear. It is not active, and the severity
      // stays `safe` only because nothing has been positively reported.
      severity: tsunamiFlagged === true ? 'critical' : 'safe',
      active: tsunamiFlagged === true,
    },
    {
      id: 'flood',
      type: 'flood',
      titleKey: 'coastalFlood',
      descKey: 'coastalFloodDesc',
      severity: hasAll('rainProbability') && data.rainProbability! > 85 ? 'critical'
        : hasAll('rainProbability') && data.rainProbability! > 70 ? 'high'
        : 'safe',
      active: hasAll('rainProbability') && data.rainProbability! > 70,
    },
    {
      id: 'rain',
      type: 'rain',
      titleKey: 'heavyRain',
      descKey: 'heavyRainDesc',
      severity: hasAll('rainProbability') && data.rainProbability! > 80 ? 'high' : 'safe',
      active: hasAll('rainProbability') && data.rainProbability! > 50,
    },
    {
      id: 'storm',
      type: 'storm',
      titleKey: 'stormWarning',
      descKey: 'stormWarningDesc',
      severity: hasAll('windSpeed') && data.windSpeed! > 40 ? 'critical'
        : hasAll('windSpeed') && data.windSpeed! > 30 ? 'high'
        : 'safe',
      active: hasAll('windSpeed') && data.windSpeed! > 30,
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