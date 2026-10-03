import { describe, it, expect } from 'vitest';
import { buildVoiceScript } from './alertCenter';
import {
  assessCoastalRisk,
  assessDataQuality,
  emptyHazardFeatures,
  emptySeismicFeatures,
  type HazardFeatures,
} from '../risk/engine';
import type { Language } from '@/lib/translations';

/**
 * The canonical voice script must carry the SAME observed values in every
 * supported language. A translation may change the framing sentences but must
 * never change, drop or invent a measurement — and must never declare safety
 * the English script does not declare.
 */

const NOW = () => new Date('2026-09-30T12:00:00.000Z');
const LANGS: Language[] = ['en', 'hi', 'mr', 'gu'];

function features(overrides: Partial<HazardFeatures> = {}): HazardFeatures {
  return {
    ...emptyHazardFeatures(),
    waveHeightM: 0.8,
    swellHeightM: 0.7,
    wavePeriodS: 8,
    windSpeedKmh: 12,
    windGustKmh: 18,
    precipitationMm: 0,
    marineStatus: 'live',
    weatherStatus: 'live',
    marineFetchedAt: '2026-09-30T11:59:00.000Z',
    weatherFetchedAt: '2026-09-30T11:59:00.000Z',
    ...overrides,
  };
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

function build(f: HazardFeatures, language: Language) {
  return buildVoiceScript({
    features: f,
    assessment: assessCoastalRisk(
      { features: f, seismic: emptySeismicFeatures(), officialWarnings: [], officialWarningActive: null },
      qualityGood(),
      NOW
    ),
    officialWarnings: [],
    retrievedAt: '2026-09-30T11:59:00.000Z',
    language,
  });
}

describe('multilingual voice scripts carry the same facts', () => {
  it.each(LANGS)('(%s) speaks the real observed wave height', (language) => {
    const script = build(features({ waveHeightM: 3.9 }), language);
    expect(script.text).toContain('3.9');
  });

  it.each(LANGS)('(%s) speaks the real observed wind speed', (language) => {
    const script = build(features({ windSpeedKmh: 42 }), language);
    expect(script.text).toContain('42');
  });

  it.each(LANGS)('(%s) states unavailability instead of inventing values', (language) => {
    const script = build(
      features({ waveHeightM: null, swellHeightM: null, windSpeedKmh: null }),
      language
    );
    expect(script.unavailableFields.length).toBeGreaterThan(0);
    expect(script.assertsAllClear).toBe(false);
  });

  it.each(LANGS)('(%s) never declares calm or safety when data is missing', (language) => {
    const script = build(features({ waveHeightM: null }), language);
    expect(script.text.toLowerCase()).not.toContain('calm');
    expect(script.assertsAllClear).toBe(false);
  });

  it('non-English scripts are actually translated, not English copies', () => {
    const en = build(features(), 'en').text;
    for (const language of ['hi', 'mr', 'gu'] as Language[]) {
      const other = build(features(), language).text;
      expect(other).not.toBe(en);
      // The observed number survives translation.
      expect(other).toContain('0.8');
    }
  });

  it('defaults to English when no language is given', () => {
    const script = buildVoiceScript({
      features: features(),
      assessment: assessCoastalRisk(
        { features: features(), seismic: emptySeismicFeatures(), officialWarnings: [], officialWarningActive: null },
        qualityGood(),
        NOW
      ),
      officialWarnings: [],
      retrievedAt: '2026-09-30T11:59:00.000Z',
    });
    expect(script.text).toContain('AAPDA SETU coastal alert.');
  });
});
