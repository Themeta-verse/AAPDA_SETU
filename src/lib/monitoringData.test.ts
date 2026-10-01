/**
 * Monitoring derivation.
 *
 * Two contracts are guarded here.
 *
 * 1. NULL HONESTY. A missing reading must never become a number, and a real
 *    measurement must never be discarded because a different input is missing.
 *
 * 2. NO SECOND RISK CALCULATION. `deriveMonitoringData` no longer owns a
 *    threshold table. The verdict is computed once, by the risk engine, and
 *    arrives here as a presentation tier. These tests assert that this function
 *    passes that verdict through untouched — including passing `null` through as
 *    `null` rather than collapsing it to `'safe'`.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveMonitoringData,
  emptyMonitoringData,
  getAlerts,
  riskLevelFromCoastalState,
  statusHasMeasurements,
} from './monitoringData';

describe('risk verdict is supplied, not recomputed', () => {
  it('derives sea condition from wind alone', () => {
    expect(deriveMonitoringData(1, 10, 0, 'live', 'safe').seaCondition).toBe('calm');
    expect(deriveMonitoringData(1, 20, 0, 'live', 'safe').seaCondition).toBe('rough');
    expect(deriveMonitoringData(1, 30, 0, 'live', 'safe').seaCondition).toBe('veryRough');
  });

  it('passes the supplied verdict through unchanged, with no threshold of its own', () => {
    // A 4.5 m wave would have escalated under the old private table. The value
    // is now whatever the engine decided, so the same input maps to each tier
    // depending only on the verdict it is handed.
    for (const level of ['safe', 'moderate', 'high', 'critical'] as const) {
      expect(deriveMonitoringData(4.5, 45, 90, 'live', level).riskLevel).toBe(level);
    }
  });

  it('maps the canonical engine verdict onto the presentation tier', () => {
    expect(riskLevelFromCoastalState('nominal')).toBe('safe');
    expect(riskLevelFromCoastalState('watch')).toBe('moderate');
    expect(riskLevelFromCoastalState('elevated')).toBe('moderate');
    expect(riskLevelFromCoastalState('high')).toBe('critical');
    expect(riskLevelFromCoastalState('severe')).toBe('critical');
  });

  it('maps an unknown verdict to null, never to safe', () => {
    // 'safe' would render a green "no risk" reading for a state the engine could
    // not determine at all.
    expect(riskLevelFromCoastalState('unknown')).toBeNull();
  });
});

describe('partial readings are preserved', () => {
  it('keeps a real wave height when wind is missing', () => {
    // Previously the whole snapshot was discarded, so a wind-endpoint outage
    // also blanked the sea state.
    const data = deriveMonitoringData(1.85, null, null, 'live', null);
    expect(data.waveHeight).toBe(1.85);
  });

  it('keeps a real wind reading when the wave height is missing', () => {
    const data = deriveMonitoringData(null, 22, null, 'live', null);
    expect(data.windSpeed).toBe(22);
  });

  it('keeps a real rain probability when the others are missing', () => {
    const data = deriveMonitoringData(null, null, 40, 'live', null);
    expect(data.rainProbability).toBe(40);
  });

  it('never turns a missing sea condition into "calm"', () => {
    // "calm" is a claim about conditions, so it requires a wind reading.
    expect(deriveMonitoringData(1, null, null, 'live', null).seaCondition).toBeNull();
  });

  it('keeps an undetermined verdict as null rather than defaulting to safe', () => {
    const data = deriveMonitoringData(1, null, null, 'live', null);
    expect(data.riskLevel).toBeNull();
  });

  it('does not discard the snapshot just because an input is missing', () => {
    // The old implementation forced `status` to 'unavailable' whenever any
    // input was null, which hid a perfectly good published wave height.
    const data = deriveMonitoringData(1.85, null, null, 'live', null);
    expect(data.status).toBe('live');
    expect(statusHasMeasurements(data.status)).toBe(true);
  });
});

describe('absent data never becomes zero', () => {
  it('returns nulls, not zeros, when nothing was published', () => {
    const data = emptyMonitoringData();
    expect(data.waveHeight).toBeNull();
    expect(data.windSpeed).toBeNull();
    expect(data.rainProbability).toBeNull();
    expect(data.seaCondition).toBeNull();
    expect(data.riskLevel).toBeNull();
  });

  it('preserves a genuine zero as data', () => {
    // 0 mm of rain is a real published reading, not an absence.
    const data = deriveMonitoringData(0, 0, 0, 'live', 'safe');
    expect(data.waveHeight).toBe(0);
    expect(data.rainProbability).toBe(0);
    expect(data.seaCondition).toBe('calm');
    expect(data.status).toBe('live');
  });

  it('never fabricates a value for any input', () => {
    const data = deriveMonitoringData(null, null, null, 'live', null);
    for (const value of [data.waveHeight, data.windSpeed, data.rainProbability]) {
      expect(value).toBeNull();
    }
  });
});

describe('freshness semantics', () => {
  it('treats live and stale as usable, but not unavailable or offline', () => {
    expect(statusHasMeasurements('live')).toBe(true);
    expect(statusHasMeasurements('stale')).toBe(true);
    expect(statusHasMeasurements('unavailable')).toBe(false);
    expect(statusHasMeasurements('offline')).toBe(false);
  });

  it('preserves the offline state', () => {
    expect(deriveMonitoringData(null, null, null, 'offline', null).status).toBe('offline');
  });

  it('does not upgrade a stale reading to live', () => {
    expect(deriveMonitoringData(1, 5, 0, 'stale', 'safe').status).toBe('stale');
  });
});

describe('alert cards follow real measurements', () => {
  const byId = (data: Parameters<typeof getAlerts>[0], flag: boolean | null = null) =>
    Object.fromEntries(getAlerts(data, flag).map((a) => [a.id, a]));

  it('raises a tsunami alert only from an authoritative flag', () => {
    expect(byId(deriveMonitoringData(5, 40, 0, 'live', 'critical'), true).tsunami.active).toBe(true);
  });

  it('never infers a tsunami from wave height and wind', () => {
    // This previously activated on `waveHeight > 4.5 && windSpeed > 25`, which
    // invented a tsunami out of ordinary rough-sea conditions and would have
    // told a user to evacuate on a model forecast alone.
    const rough = deriveMonitoringData(4.8, 30, 0, 'live', 'critical');
    expect(byId(rough, null).tsunami.active).toBe(false);
    expect(byId(rough, false).tsunami.active).toBe(false);
  });

  it('treats an unknown tsunami flag as not-confirmed, not as an all-clear', () => {
    const alert = byId(deriveMonitoringData(1, 5, 0, 'live', 'safe'), null).tsunami;
    expect(alert.active).toBe(false);
  });

  it('activates the wave alert only above the documented threshold', () => {
    expect(byId(deriveMonitoringData(2.9, 5, 0, 'live', null)).highWave.active).toBe(false);
    expect(byId(deriveMonitoringData(3.1, 5, 0, 'live', null)).highWave.active).toBe(true);
  });

  it('does not activate an alert from a missing measurement', () => {
    const noWind = deriveMonitoringData(1, null, null, 'live', null);
    expect(byId(noWind).storm.active).toBe(false);
  });
});
