export type RiskLevel = 'safe' | 'moderate' | 'high' | 'critical';
export type SeaCondition = 'calm' | 'rough' | 'veryRough';

export interface MonitoringData {
  tideLevel: number;
  windSpeed: number;
  rainProbability: number;
  seaCondition: SeaCondition;
  riskLevel: RiskLevel;
  isLive?: boolean;
}

export interface AlertInfo {
  id: string;
  type: 'highTide' | 'tsunami' | 'flood' | 'rain';
  titleKey: string;
  descKey: string;
  severity: RiskLevel;
  active: boolean;
}

export function generateMonitoringData(): MonitoringData {
  // No longer generates random operational values.
  // Returns a "no data" state so UI can show UNAVAILABLE instead of fake numbers.
  return { tideLevel: null, windSpeed: null, rainProbability: null, seaCondition: 'calm', riskLevel: 'safe', isLive: false };
}

export function deriveMonitoringData(
  tideLevel: number | null,
  windSpeed: number | null,
  rainProbability: number | null,
  isLive: boolean,
  tsunamiRisk = false
): MonitoringData {
  // If any required data is null, return safe "no data" state
  if (tideLevel === null || windSpeed === null || rainProbability === null) {
    return { tideLevel: 0, windSpeed: 0, rainProbability: 0, seaCondition: 'calm', riskLevel: 'safe', isLive: false };
  }

  let seaCondition: SeaCondition = 'calm';
  if (windSpeed > 25) seaCondition = 'veryRough';
  else if (windSpeed > 15) seaCondition = 'rough';

  let riskLevel: RiskLevel = 'safe';
  if (tsunamiRisk || tideLevel > 4.0 || windSpeed > 40 || rainProbability > 85) riskLevel = 'critical';
  else if (tideLevel > 3.5 || windSpeed > 30 || rainProbability > 70) riskLevel = 'high';
  else if (tideLevel > 2.8 || windSpeed > 15 || rainProbability > 50) riskLevel = 'moderate';

  return { tideLevel, windSpeed, rainProbability, seaCondition, riskLevel, isLive };
}

export function getAlerts(data: MonitoringData, tsunamiRisk = false): AlertInfo[] {
  // If data is unavailable (all null/default), return inactive alerts
  if (data.tideLevel == null || data.windSpeed == null || data.rainProbability == null) {
    return [
      {
        id: 'highTide',
        type: 'highTide',
        titleKey: 'highTide',
        descKey: 'highTideDesc',
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
      id: 'highTide',
      type: 'highTide',
      titleKey: 'highTide',
      descKey: 'highTideDesc',
      severity: data.tideLevel > 4.0 ? 'critical' : data.tideLevel > 3.5 ? 'high' : 'moderate',
      active: data.tideLevel > 3.0,
    },
    {
      id: 'tsunami',
      type: 'tsunami',
      titleKey: 'tsunamiRisk',
      descKey: 'tsunamiDesc',
      severity: 'critical',
      active: tsunamiRisk || (data.tideLevel > 4.5 && data.windSpeed > 25),
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
