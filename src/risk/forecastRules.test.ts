/**
 * Shared forecast rule evaluation.
 *
 * The point of `evaluateForecastHour` is that the timeline and the headline
 * cannot disagree, because there is one rule table. These tests pin that
 * contract, plus the null-honesty rules.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateForecastHour,
  MARINE_RULES,
  WEATHER_RULES,
  evaluateRiskDimensions,
  emptyHazardFeatures,
  type ForecastHourValues,
} from './engine';

const NONE: ForecastHourValues = {
  waveHeightM: null,
  swellHeightM: null,
  wavePeriodS: null,
  windSpeedKmh: null,
  windGustKmh: null,
  precipitationMm: null,
  precipitationProbabilityPct: null,
  visibilityM: null,
};

const hour = (over: Partial<ForecastHourValues> = {}): ForecastHourValues => ({
  ...NONE,
  waveHeightM: 0.6,
  wavePeriodS: 9,
  windSpeedKmh: 10,
  ...over,
});

describe('an hour with nothing published', () => {
  it('is never nominal', () => {
    // A calm-sea claim requires data. Empty input must abstain.
    expect(evaluateForecastHour(NONE).state).toBe('insufficient-data');
  });

  it('fires no rules', () => {
    expect(evaluateForecastHour(NONE).ruleIds).toEqual([]);
  });

  it('does not become safe via any other spelling', () => {
    const state = evaluateForecastHour(NONE).state;
    expect(state).not.toBe('nominal');
    expect(state).not.toBe('low');
  });
});

describe('a partially published hour', () => {
  it('is not insufficient-data when any input exists', () => {
    expect(evaluateForecastHour(hour()).state).not.toBe('insufficient-data');
  });

  it('evaluates only the rules whose inputs are present', () => {
    // Calm wave, but a high wind. Only the wind rules may fire.
    const result = evaluateForecastHour(
      hour({ waveHeightM: 0.6, wavePeriodS: 9, windSpeedKmh: 45 })
    );
    expect(result.ruleIds).toContain('WEATHER.WIND.HIGH');
    expect(result.ruleIds.some((id) => id.startsWith('MARINE.'))).toBe(false);
  });

  it('does not fire a rule whose input is null', () => {
    const result = evaluateForecastHour(hour({ waveHeightM: null, wavePeriodS: 9 }));
    expect(result.ruleIds).not.toContain('MARINE.WAVE.HIGH');
  });

  it('treats a real zero as data, not as absence', () => {
    // 0 mm rain is a real published value and must be usable.
    const result = evaluateForecastHour(hour({ precipitationMm: 0 }));
    expect(result.state).not.toBe('insufficient-data');
    expect(result.ruleIds).not.toContain('WEATHER.RAIN.HEAVY');
  });
});

describe('severity agreement with the engine', () => {
  const highWaveCases: [number, string][] = [
    [3.7, 'high'],
    [4.5, 'high'],
    [12, 'high'],
  ];

  it.each(highWaveCases)('maps a %s m wave to %s, matching MARINE.WAVE.HIGH', (wave, expected) => {
    expect(evaluateForecastHour(hour({ waveHeightM: wave })).state).toBe(expected);
  });

  it('never returns severe from a model hour', () => {
    // Even an absurd reading. `severe` requires a human authority.
    for (const wave of [3.7, 6, 15, 30]) {
      expect(evaluateForecastHour(hour({ waveHeightM: wave })).state).not.toBe('severe');
    }
  });

  it('agrees with the current-conditions engine for the same reading', () => {
    const features = emptyHazardFeatures();
    features.waveHeightM = 3.8;
    features.wavePeriodS = 9;

    const dimensions = evaluateRiskDimensions({
      features,
      seismic: {
        seismicMagnitude: null,
        seismicDepthKm: null,
        tsunamiFlag: null,
        tsunamiFlagAuthoritative: false,
        eventCount: 0,
      },
      officialWarnings: [],
      officialWarningActive: null,
    });

    expect(evaluateForecastHour(hour({ waveHeightM: 3.8 })).state).toBe(
      dimensions.marine.state === 'insufficient-data' ? 'insufficient-data' : dimensions.marine.state
    );
  });

  it('uses exactly the engine rule ids, with no invented ones', () => {
    const known = new Set([...MARINE_RULES, ...WEATHER_RULES].map((r) => r.id));
    const result = evaluateForecastHour(
      hour({
        waveHeightM: 5,
        swellHeightM: 4,
        wavePeriodS: 20,
        windSpeedKmh: 60,
        windGustKmh: 70,
        precipitationMm: 20,
        precipitationProbabilityPct: 90,
        visibilityM: 200,
      })
    );
    expect(result.ruleIds.length).toBeGreaterThan(0);
    for (const id of result.ruleIds) expect(known.has(id)).toBe(true);
  });

  it('reports every rule that fired, not just the worst', () => {
    // 4 m waves trip both MODERATE and HIGH.
    const result = evaluateForecastHour(hour({ waveHeightM: 4, wavePeriodS: 9, windSpeedKmh: 10 }));
    expect(result.ruleIds).toContain('MARINE.WAVE.HIGH');
    expect(result.ruleIds).toContain('MARINE.WAVE.MODERATE');
  });
});

describe('each rule is reachable', () => {
  const cases: [string, ForecastHourValues][] = [
    ['MARINE.WAVE.HIGH', hour({ waveHeightM: 3.8 })],
    ['MARINE.SWELL.HIGH', hour({ swellHeightM: 3.2 })],
    ['MARINE.WAVE.MODERATE', hour({ waveHeightM: 2.2 })],
    ['MARINE.PERIOD.LONG', hour({ wavePeriodS: 15 })],
    ['MARINE.PERIOD.VERY_LONG', hour({ wavePeriodS: 19 })],
    ['WEATHER.WIND.HIGH', hour({ windSpeedKmh: 45 })],
    ['WEATHER.GUST.HIGH', hour({ windGustKmh: 60 })],
    ['WEATHER.WIND.MODERATE', hour({ windSpeedKmh: 26 })],
    ['WEATHER.RAIN.HEAVY', hour({ precipitationMm: 9 })],
    ['WEATHER.RAIN.MODERATE', hour({ precipitationProbabilityPct: 70 })],
    ['WEATHER.VISIBILITY.LOW', hour({ visibilityM: 500 })],
  ];

  it.each(cases)('fires %s from the forecast path', (ruleId, values) => {
    expect(evaluateForecastHour(values).ruleIds).toContain(ruleId);
  });
});