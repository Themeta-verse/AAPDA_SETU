import { describe, it, expect } from 'vitest';
import {
  MARINE_RULES,
  WEATHER_RULES,
  SEISMIC_RULES,
  COASTAL_WATER_RULES,
  assessCoastalRisk,
  assessDataQuality,
  emptyHazardFeatures,
  emptySeismicFeatures,
  evaluateRiskDimensions,
  type CoastalRiskState,
  type HazardFeatures,
  type SeismicFeatures as SeismicInput,
} from './engine';
import type { OfficialWarningStatus } from '@/integrations/adapters/types';

/**
 * Behavioral tests for the deterministic risk engine.
 *
 * The central assertions are about HONESTY UNDER MISSING DATA: the engine must
 * report `insufficient-data` / `unknown` rather than defaulting a null input to
 * a benign value. A test that only checked "high waves produce high risk"
 * would pass against an implementation that invented calm seas.
 */

const FIXED_NOW = () => new Date('2026-09-30T12:00:00.000Z');

function features(overrides: Partial<HazardFeatures> = {}): HazardFeatures {
  return {
    ...emptyHazardFeatures(),
    waveHeightM: 0.8,
    wavePeriodS: 8,
    windSpeedKmh: 12,
    precipitationMm: 0,
    marineStatus: 'live',
    weatherStatus: 'live',
    marineFetchedAt: '2026-09-30T11:59:00.000Z',
    weatherFetchedAt: '2026-09-30T11:59:00.000Z',
    ...overrides,
  };
}

function seismic(overrides: Partial<SeismicInput> = {}): SeismicInput {
  return { ...emptySeismicFeatures(), ...overrides };
}

function qualityGood() {
  return assessDataQuality({
    marineStatus: 'live',
    weatherStatus: 'live',
    marineFetchedAt: '2026-09-30T11:59:00.000Z',
    weatherFetchedAt: '2026-09-30T11:59:00.000Z',
    marineErrorKind: null,
    weatherErrorKind: null,
    rejectedRecords: 0,
    missingFields: [],
    warningsUnreadable: false,
    now: new Date('2026-09-30T12:00:00.000Z'),
  });
}

const NO_WARNINGS: OfficialWarningStatus[] = [];

// =====================================================================
// DETERMINISM
// =====================================================================

describe('determinism', () => {
  it('produces an identical verdict for identical input', () => {
    const args = {
      features: features({ waveHeightM: 4.2, wavePeriodS: 15 }),
      seismic: seismic(),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    };

    const a = assessCoastalRisk(args, qualityGood(), FIXED_NOW);
    const b = assessCoastalRisk(args, qualityGood(), FIXED_NOW);

    expect(a.state).toBe(b.state);
    expect(a.dimensions.marine.state).toBe(b.dimensions.marine.state);
    expect(a.dimensions.marine.triggered).toEqual(b.dimensions.marine.triggered);
  });

  it('contains no randomness in any rule module', async () => {
    // Structural guard. Comments are stripped first, because this very file
    // documents the ban and would otherwise trip the check on its own prose.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const code = readFileSync(resolve(__dirname, './engine.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    expect(code).not.toMatch(/Math\.random/);
    expect(code).not.toMatch(/Date\.now\(\)/);
    expect(code).not.toMatch(/performance\.now/);
  });
});

// =====================================================================
// MARINE
// =====================================================================

describe('marine risk rules', () => {
  it('is nominal below every marine threshold', () => {
    const dims = evaluateRiskDimensions({
      features: features({ waveHeightM: 0.9, wavePeriodS: 6, swellHeightM: 0.7 }),
      seismic: seismic(),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    });

    expect(dims.marine.state).toBe('nominal');
    expect(dims.marine.triggered).toEqual([]);
  });

  it('escalates on significant wave height crossing 3.7 m', () => {
    const dims = evaluateRiskDimensions({
      features: features({ waveHeightM: 3.7, wavePeriodS: 8 }),
      seismic: seismic(),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    });

    expect(dims.marine.triggered.map((t) => t.ruleId)).toContain('MARINE.WAVE.HIGH');
    // Model rules top out at `high`. Only an official authority can produce
    // `severe`, so the model cannot escalate to that on its own.
    expect(dims.marine.state).toBe('high');
  });

  it('escalates on swell height independently of wave height', () => {
    // Long-period swell can be dangerous while inshore seas stay moderate.
    const dims = evaluateRiskDimensions({
      features: features({ waveHeightM: 1.2, wavePeriodS: 9, swellHeightM: 3.4 }),
      seismic: seismic(),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    });

    expect(dims.marine.triggered.map((t) => t.ruleId)).toContain('MARINE.SWELL.HIGH');
  });

  it('escalates on long wave period', () => {
    const dims = evaluateRiskDimensions({
      features: features({ waveHeightM: 1.0, wavePeriodS: 19 }),
      seismic: seismic(),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    });

    expect(dims.marine.triggered.map((t) => t.ruleId)).toContain('MARINE.PERIOD.VERY_LONG');
  });

  it('reports insufficient-data rather than nominal when wave height is missing', () => {
    const dims = evaluateRiskDimensions({
      features: features({ waveHeightM: null, wavePeriodS: 8 }),
      seismic: seismic(),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    });

    // This is the critical assertion: a missing reading must NOT read as safe.
    expect(dims.marine.state).toBe('insufficient-data');
    expect(dims.marine.triggered).toEqual([]);
    expect(dims.marine.missingInputs).toContain('waveHeightM');
  });

  it('reports insufficient-data when wave period is missing', () => {
    const dims = evaluateRiskDimensions({
      features: features({ waveHeightM: 1.0, wavePeriodS: null }),
      seismic: seismic(),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    });

    expect(dims.marine.state).toBe('insufficient-data');
  });

  it('states the documented basis for every rule it fires', () => {
    const dims = evaluateRiskDimensions({
      features: features({ waveHeightM: 5.0, wavePeriodS: 20 }),
      seismic: seismic(),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    });

    for (const triggered of dims.marine.triggered) {
      expect(triggered.basis).toBeTruthy();
      expect(triggered.basis.length).toBeGreaterThan(20);
    }
  });
});

// =====================================================================
// WEATHER
// =====================================================================

describe('weather risk rules', () => {
  it('is nominal in calm conditions', () => {
    const dims = evaluateRiskDimensions({
      features: features({ windSpeedKmh: 8, precipitationMm: 0 }),
      seismic: seismic(),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    });

    expect(dims.weather.state).toBe('nominal');
  });

  it('escalates on high wind', () => {
    const dims = evaluateRiskDimensions({
      features: features({ windSpeedKmh: 45, precipitationMm: 0 }),
      seismic: seismic(),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    });

    expect(dims.weather.triggered.map((t) => t.ruleId)).toContain('WEATHER.WIND.HIGH');
  });

  it('escalates on heavy precipitation', () => {
    const dims = evaluateRiskDimensions({
      features: features({ windSpeedKmh: 5, precipitationMm: 12 }),
      seismic: seismic(),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    });

    expect(dims.weather.triggered.map((t) => t.ruleId)).toContain('WEATHER.RAIN.HEAVY');
  });

  it('does not escalate on missing wind', () => {
    const dims = evaluateRiskDimensions({
      features: features({ windSpeedKmh: null, precipitationMm: 0 }),
      seismic: seismic(),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    });

    expect(dims.weather.state).toBe('insufficient-data');
    expect(dims.weather.triggered).toEqual([]);
  });
});

// =====================================================================
// COASTAL WATER
// =====================================================================

describe('coastal water risk', () => {
  it('is insufficient-data because no readable sea-level source exists', () => {
    const dims = evaluateRiskDimensions({
      features: features(),
      seismic: seismic(),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    });

    expect(dims['coastal-water'].state).toBe('insufficient-data');
    expect(dims['coastal-water'].missingInputs.length).toBeGreaterThan(0);
  });

  it('declares no rules at all rather than inventing a sea-level threshold', () => {
    // An empty rule set is the honest encoding of "no readable source".
    expect(COASTAL_WATER_RULES).toHaveLength(0);
  });

  it('escalates only on a genuinely active INCOIS advisory', () => {
    const advisory: OfficialWarningStatus = {
      authority: 'INCOIS',
      productId: 'INCOIS_TSUNAMI',
      label: 'INCOIS Tsunami',
      url: 'https://tsunami.incois.gov.in/TEWS/',
      active: true,
      issuedAt: '2026-09-30T10:00:00Z',
      validFrom: null,
      validUntil: null,
      headline: 'Tsunami advisory',
      affectedArea: 'Indian Ocean',
      retrievedAt: '2026-09-30T10:05:00Z',
      status: 'live',
      blocker: null,
      blockerDetail: null,
      httpStatus: 200,
      contentType: 'application/json',
    };

    const dims = evaluateRiskDimensions({
      features: features(),
      seismic: seismic(),
      officialWarnings: [advisory],
      officialWarningActive: true,
    });

    expect(dims['coastal-water'].state).toBe('high');
  });
});

// =====================================================================
// SEISMIC / TSUNAMI TRI-STATE
// =====================================================================

describe('seismic and tsunami status', () => {
  it('reports a significant earthquake as seismic activity', () => {
    const dims = evaluateRiskDimensions({
      features: features(),
      seismic: seismic({ seismicMagnitude: 6.4, seismicDepthKm: 10, eventCount: 1 }),
      officialWarnings: NO_WARNINGS,
      officialWarningActive: null,
    });

    expect(dims.seismic.triggered.map((t) => t.ruleId)).toContain('SEISMIC.EVENT.MAJOR');
  });

  it('does NOT derive a tsunami from magnitude', () => {
    // A magnitude 7 earthquake with NO USGS flag must leave tsunami unknown.
    const assessment = assessCoastalRisk(
      {
        features: features(),
        seismic: seismic({
          seismicMagnitude: 7.4,
          seismicDepthKm: 20,
          tsunamiFlag: null,
          tsunamiFlagAuthoritative: false,
          eventCount: 1,
        }),
        officialWarnings: NO_WARNINGS,
        officialWarningActive: null,
      },
      qualityGood(),
      FIXED_NOW
    );

    expect(assessment.tsunamiStatus).toBeNull();
    expect(assessment.tsunamiAuthoritative).toBe(false);
  });

  it('preserves an explicit USGS false flag as false, not null', () => {
    const assessment = assessCoastalRisk(
      {
        features: features(),
        seismic: seismic({
          seismicMagnitude: 5.2,
          seismicDepthKm: 30,
          tsunamiFlag: false,
          tsunamiFlagAuthoritative: true,
          eventCount: 1,
        }),
        officialWarnings: NO_WARNINGS,
        officialWarningActive: null,
      },
      qualityGood(),
      FIXED_NOW
    );

    expect(assessment.tsunamiStatus).toBe(false);
  });

  it('preserves an authoritative true flag as true', () => {
    const assessment = assessCoastalRisk(
      {
        features: features(),
        seismic: seismic({
          seismicMagnitude: 7.8,
          seismicDepthKm: 20,
          tsunamiFlag: true,
          tsunamiFlagAuthoritative: true,
          eventCount: 1,
        }),
        officialWarnings: NO_WARNINGS,
        officialWarningActive: null,
      },
      qualityGood(),
      FIXED_NOW
    );

    expect(assessment.tsunamiStatus).toBe(true);
    expect(assessment.tsunamiAuthoritative).toBe(true);
  });

  it('treats an unreadable feed as unknown tsunami, never false', () => {
    const assessment = assessCoastalRisk(
      {
        features: features(),
        seismic: emptySeismicFeatures(),
        officialWarnings: NO_WARNINGS,
        officialWarningActive: null,
      },
      qualityGood(),
      FIXED_NOW
    );

    expect(assessment.tsunamiStatus).toBeNull();
  });
});

// =====================================================================
// OFFICIAL WARNINGS
// =====================================================================

describe('official warning handling', () => {
  function warning(active: boolean | null): OfficialWarningStatus {
    return {
      authority: 'IMD',
      productId: 'IMD_MARINE_FORECAST',
      label: 'IMD Marine Forecast',
      url: 'https://mausam.imd.gov.in/responsive/marine_forecast.php',
      active,
      issuedAt: null,
      validFrom: null,
      validUntil: null,
      headline: null,
      affectedArea: null,
      retrievedAt: '2026-09-30T12:00:00Z',
      status: 'unavailable',
      blocker: null,
      blockerDetail: null,
      httpStatus: 200,
      contentType: 'text/html',
    };
  }

  it('escalates to severe when a warning is positively active', () => {
    const assessment = assessCoastalRisk(
      {
        features: features(),
        seismic: seismic(),
        officialWarnings: [warning(true)],
        officialWarningActive: true,
      },
      qualityGood(),
      FIXED_NOW
    );

    expect(assessment.state).toBe('severe');
  });

  it('keeps the warning verdict unknown when the source could not be read', () => {
    const assessment = assessCoastalRisk(
      {
        features: features(),
        seismic: seismic(),
        officialWarnings: [warning(null)],
        officialWarningActive: null,
      },
      qualityGood(),
      FIXED_NOW
    );

    expect(assessment.officialWarningActive).toBeNull();
  });
});

// =====================================================================
// OVERALL STATE
// =====================================================================

describe('overall coastal state', () => {
  it('reports nominal for genuinely calm, complete data', () => {
    const assessment = assessCoastalRisk(
      {
        features: features({ waveHeightM: 0.7, wavePeriodS: 6, swellHeightM: 0.6, windSpeedKmh: 9, precipitationMm: 0 }),
        seismic: seismic({ seismicMagnitude: 3.1, seismicDepthKm: 15, eventCount: 1 }),
        officialWarnings: NO_WARNINGS,
        officialWarningActive: false,
      },
      qualityGood(),
      FIXED_NOW
    );

    // marine + weather nominal -> watch (a floor, because seismic/water are unknown)
    expect(['nominal', 'watch']).toContain(assessment.state);
    expect(assessment.state).not.toBe('unknown');
  });

  it('reports unknown when the primary sources have never responded', () => {
    const assessment = assessCoastalRisk(
      {
        features: features({ waveHeightM: null, wavePeriodS: null, windSpeedKmh: null, precipitationMm: null, marineStatus: 'unavailable', weatherStatus: 'unavailable' }),
        seismic: emptySeismicFeatures(),
        officialWarnings: NO_WARNINGS,
        officialWarningActive: null,
      },
      qualityGood(),
      FIXED_NOW
    );

    expect(assessment.state).toBe('unknown');
  });

  it('never reports a lower state than the worst dimension', () => {
    const assessment = assessCoastalRisk(
      {
        features: features({ waveHeightM: 4.5, wavePeriodS: 16, windSpeedKmh: 10, precipitationMm: 0 }),
        seismic: seismic(),
        officialWarnings: NO_WARNINGS,
        officialWarningActive: null,
      },
      qualityGood(),
      FIXED_NOW
    );

    // Model-only hazard tops out at `high`; `severe` requires an authority.
    expect(assessment.state).toBe('high');
  });

  it('never lets the model produce severe without an official warning', () => {
    const assessment = assessCoastalRisk(
      {
        features: features({ waveHeightM: 12, wavePeriodS: 25, windSpeedKmh: 200, precipitationMm: 100 }),
        seismic: seismic({ seismicMagnitude: 9, seismicDepthKm: 5, eventCount: 3 }),
        officialWarnings: NO_WARNINGS,
        officialWarningActive: false,
      },
      qualityGood(),
      FIXED_NOW
    );

    expect(assessment.state).not.toBe('severe');
  });
});

// =====================================================================
// DATA QUALITY
// =====================================================================

describe('data quality', () => {
  const baseArgs = {
    marineErrorKind: null,
    weatherErrorKind: null,
    rejectedRecords: 0,
    missingFields: [] as string[],
    warningsUnreadable: false,
  };

  it('reports CURRENT for a fresh complete read', () => {
    const q = assessDataQuality({
      ...baseArgs,
      marineStatus: 'live',
      weatherStatus: 'live',
      marineFetchedAt: '2026-09-30T11:59:00.000Z',
      weatherFetchedAt: '2026-09-30T11:59:00.000Z',
      now: new Date('2026-09-30T12:00:00.000Z'),
    });

    expect(q.state).toBe('CURRENT');
    expect(q.assessment).toBe('GOOD');
    expect(q.reasons.length).toBeGreaterThan(0);
  });

  it('reports UNKNOWN when offline', () => {
    const q = assessDataQuality({
      ...baseArgs,
      marineStatus: 'offline',
      weatherStatus: 'offline',
      marineFetchedAt: '2026-09-30T11:00:00.000Z',
      weatherFetchedAt: '2026-09-30T11:00:00.000Z',
      now: new Date('2026-09-30T12:00:00.000Z'),
    });

    expect(q.state).toBe('UNKNOWN');
    expect(q.assessment).toBe('INSUFFICIENT');
  });

  it('reports STALE with a measured age', () => {
    const q = assessDataQuality({
      ...baseArgs,
      marineStatus: 'stale',
      weatherStatus: 'stale',
      marineFetchedAt: '2026-09-30T10:00:00.000Z',
      weatherFetchedAt: '2026-09-30T10:00:00.000Z',
      now: new Date('2026-09-30T12:00:00.000Z'),
    });

    expect(q.state).toBe('STALE');
    expect(q.ageMs).toBe(2 * 60 * 60 * 1000);
    expect(q.reasons.some((r) => r.includes('120'))).toBe(true);
  });

  it('degrades to DEGRADED when official warnings are unreadable', () => {
    const q = assessDataQuality({
      ...baseArgs,
      marineStatus: 'live',
      weatherStatus: 'live',
      marineFetchedAt: '2026-09-30T11:59:00.000Z',
      weatherFetchedAt: '2026-09-30T11:59:00.000Z',
      warningsUnreadable: true,
      now: new Date('2026-09-30T12:00:00.000Z'),
    });

    expect(q.state).toBe('DEGRADED');
    expect(q.assessment).toBe('LIMITED');
  });

  it('records rejected records as a reason', () => {
    const q = assessDataQuality({
      ...baseArgs,
      marineStatus: 'live',
      weatherStatus: 'live',
      marineFetchedAt: '2026-09-30T11:59:00.000Z',
      weatherFetchedAt: '2026-09-30T11:59:00.000Z',
      rejectedRecords: 4,
      now: new Date('2026-09-30T12:00:00.000Z'),
    });

    expect(q.state).toBe('DEGRADED');
    expect(q.rejectedRecords).toBe(4);
    expect(q.reasons.some((r) => r.includes('4'))).toBe(true);
  });

  it('never emits a numeric confidence score', () => {
    const q = assessDataQuality({
      ...baseArgs,
      marineStatus: 'live',
      weatherStatus: 'live',
      marineFetchedAt: '2026-09-30T11:59:00.000Z',
      weatherFetchedAt: '2026-09-30T11:59:00.000Z',
      now: new Date('2026-09-30T12:00:00.000Z'),
    });

    // Evidence-based only: no "87% confidence" style field exists.
    expect(q).not.toHaveProperty('confidence');
    expect(q).not.toHaveProperty('score');
    expect(q).not.toHaveProperty('probability');
  });
});

// =====================================================================
// RULE IDENTIFIERS
// =====================================================================

describe('rule identifiers', () => {
  it('gives every rule a unique, non-empty, namespaced id', () => {
    const all = [...MARINE_RULES, ...WEATHER_RULES, ...SEISMIC_RULES];
    const ids = all.map((r) => r.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Z]+\.[A-Z]+\.[A-Z_]+$/);
    }
  });

  it('gives every rule a documented basis', () => {
    for (const rule of [...MARINE_RULES, ...WEATHER_RULES, ...SEISMIC_RULES]) {
      expect(rule.basis.length).toBeGreaterThan(20);
      expect(rule.basis).toMatch(/\d/); // states a real threshold
    }
  });
});
