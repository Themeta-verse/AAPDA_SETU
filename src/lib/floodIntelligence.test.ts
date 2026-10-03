import { describe, it, expect } from 'vitest';
import {
  assessUrbanFloodRisk,
  evaluateRiskSlice,
  MODEL_VERSION,
  type FloodRiskInputs,
  type HourlyWeatherPoint,
  type HourlyMarinePoint,
} from './floodIntelligence';

const BASE_LOCATION = {
  city: 'Mumbai',
  ward: 'K-West (Andheri W / Juhu)',
  zoneId: 'zone-mumbai-juhu',
  zoneName: 'Juhu Beach Flood Risk Zone',
  latitude: 19.0988,
  longitude: 72.8267,
  isCoastal: true,
};

const INLAND_LOCATION = {
  city: 'Mumbai',
  ward: 'F-North (Sion / Matunga)',
  zoneId: 'zone-mumbai-sion',
  zoneName: 'Sion King\'s Circle Flood Zone',
  latitude: 19.0330,
  longitude: 72.8617,
  isCoastal: false,
};

const FIXED_NOW = new Date('2026-10-01T12:00:00.000Z');

function buildHourlyWeather(now: Date): HourlyWeatherPoint[] {
  const points: HourlyWeatherPoint[] = [];
  for (let i = 0; i <= 24; i++) {
    const d = new Date(now.getTime() + i * 3600 * 1000);
    points.push({
      time: d.toISOString(),
      rainProbability: i === 3 ? 75 : i === 6 ? 90 : 20,
      precipitation: i === 3 ? 25 : i === 6 ? 60 : 2,
      windSpeed: i === 6 ? 45 : 12,
    });
  }
  return points;
}

function buildHourlyMarine(now: Date): HourlyMarinePoint[] {
  const points: HourlyMarinePoint[] = [];
  for (let i = 0; i <= 24; i++) {
    const d = new Date(now.getTime() + i * 3600 * 1000);
    points.push({
      time: d.toISOString(),
      waveHeight: i === 3 ? 3.6 : i === 6 ? 4.2 : 1.2,
    });
  }
  return points;
}

describe('Deterministic Flood Intelligence - Pure Risk Engine', () => {
  it('evaluates valid safe current inputs deterministically', () => {
    const inputs: FloodRiskInputs = {
      location: BASE_LOCATION,
      weather: {
        fetchedAt: '2026-10-01T12:00:00.000Z',
        status: 'live',
        current: {
          rainProbability: 20,
          rainRate: 1,
          windSpeed: 10,
        },
      },
      marine: {
        fetchedAt: '2026-10-01T12:00:00.000Z',
        status: 'live',
        current: {
          waveHeight: 1.2,
        },
      },
      now: FIXED_NOW,
    };

    const result = assessUrbanFloodRisk(inputs);
    expect(result.currentRisk.riskLevel).toBe('SAFE');
    expect(result.currentRisk.trend).toBe('persistence');
    expect(result.assessedAt).toBe(FIXED_NOW.toISOString());
    expect(result.modelVersion).toBe(MODEL_VERSION);
    expect(result.answers.howSevere).toContain('SAFE');
  });

  it('evaluates high coastal wave height as HIGH/CRITICAL in coastal zones', () => {
    const sliceHigh = evaluateRiskSlice({
      isCoastal: true,
      rainProbability: 20,
      rainRate: 0,
      windSpeed: 10,
      waveHeight: 3.7, // > 3.5m -> HIGH
      weatherFreshness: 'live',
      marineFreshness: 'live',
      marineApplicable: true,
      weatherTimestamp: FIXED_NOW.toISOString(),
      marineTimestamp: FIXED_NOW.toISOString(),
      tsunamiRisk: false,
      verifiedIncidentCount: 0,
    });

    expect(sliceHigh.riskLevel).toBe('HIGH');
    expect(sliceHigh.contributions.some(c => c.source === 'Open-Meteo Marine' && c.contributionLevel === 'HIGH')).toBe(true);

    const sliceCritical = evaluateRiskSlice({
      isCoastal: true,
      rainProbability: 20,
      rainRate: 0,
      windSpeed: 10,
      waveHeight: 4.5, // > 4.0m -> CRITICAL
      weatherFreshness: 'live',
      marineFreshness: 'live',
      marineApplicable: true,
      weatherTimestamp: FIXED_NOW.toISOString(),
      marineTimestamp: FIXED_NOW.toISOString(),
      tsunamiRisk: false,
      verifiedIncidentCount: 0,
    });

    expect(sliceCritical.riskLevel).toBe('CRITICAL');
  });

  it('marks coastal zone as INSUFFICIENT_DATA when marine source is unavailable', () => {
    const inputs: FloodRiskInputs = {
      location: BASE_LOCATION, // Coastal
      weather: {
        fetchedAt: FIXED_NOW.toISOString(),
        status: 'live',
        current: {
          rainProbability: 30,
          windSpeed: 10,
        },
      },
      marine: {
        fetchedAt: null,
        status: 'unavailable',
        current: {
          waveHeight: null,
        },
      },
      now: FIXED_NOW,
    };

    const result = assessUrbanFloodRisk(inputs);
    expect(result.currentRisk.riskLevel).toBe('INSUFFICIENT_DATA');
    expect(result.currentRisk.provenance.missingSources).toContain('Open-Meteo Marine');
    expect(result.answers.why.some(w => w.includes('unavailable'))).toBe(true);
  });

  it('treats marine as NOT_APPLICABLE for inland zones without marking insufficient', () => {
    const inputs: FloodRiskInputs = {
      location: INLAND_LOCATION, // Sion Inland
      weather: {
        fetchedAt: FIXED_NOW.toISOString(),
        status: 'live',
        current: {
          rainProbability: 72, // >= 70% -> HIGH
          rainRate: 22,
          windSpeed: 12,
        },
      },
      marine: null, // Inland zones do not require marine data
      now: FIXED_NOW,
    };

    const result = assessUrbanFloodRisk(inputs);
    expect(result.currentRisk.riskLevel).toBe('HIGH');
    expect(result.currentRisk.provenance.missingSources).not.toContain('Open-Meteo Marine');
  });

  it('evaluates multi-horizon forecast progression: NOW, +1H, +3H, +6H, +24H', () => {
    const hourlyWeather = buildHourlyWeather(FIXED_NOW);
    const hourlyMarine = buildHourlyMarine(FIXED_NOW);

    const inputs: FloodRiskInputs = {
      location: BASE_LOCATION,
      weather: {
        fetchedAt: FIXED_NOW.toISOString(),
        status: 'live',
        current: {
          rainProbability: 20,
          rainRate: 2,
          windSpeed: 12,
        },
        hourly: hourlyWeather,
      },
      marine: {
        fetchedAt: FIXED_NOW.toISOString(),
        status: 'live',
        current: {
          waveHeight: 1.2,
        },
        hourly: hourlyMarine,
      },
      now: FIXED_NOW,
    };

    const result = assessUrbanFloodRisk(inputs);

    // NOW: Safe (rain 20%, wave 1.2m)
    expect(result.currentRisk.riskLevel).toBe('SAFE');

    // +3H: Rain 75%, Wave 3.6m -> HIGH escalation
    expect(result.forecastHorizons['+3H'].riskLevel).toBe('HIGH');
    expect(result.forecastHorizons['+3H'].trend).toBe('escalation');
    expect(result.forecastHorizons['+3H'].changeDescription).toContain('75%');

    // +6H: Rain 90%, Wave 4.2m -> CRITICAL peak
    expect(result.forecastHorizons['+6H'].riskLevel).toBe('CRITICAL');
    expect(result.forecastHorizons['+6H'].trend).toBe('escalation');

    // +24H: Rain 20%, Wave 1.2m -> Reduction back to SAFE
    expect(result.forecastHorizons['+24H'].riskLevel).toBe('SAFE');
    expect(result.forecastHorizons['+24H'].trend).toBe('persistence');
  });

  it('marks a forecast horizon as INSUFFICIENT_DATA if hourly data does not reach it', () => {
    const inputs: FloodRiskInputs = {
      location: BASE_LOCATION,
      weather: {
        fetchedAt: FIXED_NOW.toISOString(),
        status: 'live',
        current: {
          rainProbability: 20,
          windSpeed: 10,
        },
        hourly: [], // Empty hourly forecast
      },
      marine: {
        fetchedAt: FIXED_NOW.toISOString(),
        status: 'live',
        current: {
          waveHeight: 1.0,
        },
        hourly: [],
      },
      now: FIXED_NOW,
    };

    const result = assessUrbanFloodRisk(inputs);
    expect(result.currentRisk.riskLevel).toBe('SAFE');
    expect(result.forecastHorizons['+3H'].riskLevel).toBe('INSUFFICIENT_DATA');
    expect(result.forecastHorizons['+6H'].riskLevel).toBe('INSUFFICIENT_DATA');
    expect(result.forecastHorizons['+24H'].riskLevel).toBe('INSUFFICIENT_DATA');
  });

  it('escalates risk when verified ground-truth incidents exist in zone', () => {
    const inputs: FloodRiskInputs = {
      location: INLAND_LOCATION,
      weather: {
        fetchedAt: FIXED_NOW.toISOString(),
        status: 'live',
        current: {
          rainProbability: 30, // Weather alone would be SAFE
          windSpeed: 10,
        },
      },
      marine: null,
      verifiedIncidentsInZone: [
        { id: 'inc-1', type: 'flooding', createdAt: FIXED_NOW.toISOString() },
      ],
      now: FIXED_NOW,
    };

    const result = assessUrbanFloodRisk(inputs);
    expect(result.currentRisk.riskLevel).toBe('HIGH');
    expect(result.currentRisk.contributingInputs.some(c => c.source === 'Incident Intelligence')).toBe(true);
  });

  it('escalates risk to CRITICAL when USGS reports an active tsunami flag', () => {
    const inputs: FloodRiskInputs = {
      location: BASE_LOCATION,
      weather: {
        fetchedAt: FIXED_NOW.toISOString(),
        status: 'live',
        current: { rainProbability: 20, windSpeed: 10 },
      },
      marine: {
        fetchedAt: FIXED_NOW.toISOString(),
        status: 'live',
        current: { waveHeight: 1.0 },
      },
      tsunamiRisk: true,
      now: FIXED_NOW,
    };

    const result = assessUrbanFloodRisk(inputs);
    expect(result.currentRisk.riskLevel).toBe('CRITICAL');
    expect(result.currentRisk.contributingInputs.some(c => c.source.includes('USGS'))).toBe(true);
  });

  it('is completely repeatable and deterministic across multiple runs with identical inputs', () => {
    const inputs: FloodRiskInputs = {
      location: BASE_LOCATION,
      weather: {
        fetchedAt: FIXED_NOW.toISOString(),
        status: 'live',
        current: { rainProbability: 55, windSpeed: 16 },
      },
      marine: {
        fetchedAt: FIXED_NOW.toISOString(),
        status: 'live',
        current: { waveHeight: 2.9 },
      },
      now: FIXED_NOW,
    };

    const run1 = assessUrbanFloodRisk(inputs);
    const run2 = assessUrbanFloodRisk(inputs);

    expect(run1.currentRisk.riskLevel).toBe('MODERATE');
    expect(run1.currentRisk.riskLevel).toBe(run2.currentRisk.riskLevel);
    expect(run1.answers.why).toEqual(run2.answers.why);
    expect(run1.currentRisk.contributingInputs).toEqual(run2.currentRisk.contributingInputs);
  });
});
