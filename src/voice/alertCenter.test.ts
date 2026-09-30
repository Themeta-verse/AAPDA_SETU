import { describe, it, expect, vi } from 'vitest';
import { buildVoiceScript, generateVoiceAlert } from './alertCenter';
import {
  assessCoastalRisk,
  assessDataQuality,
  emptyHazardFeatures,
  emptySeismicFeatures,
  type HazardFeatures,
  type SeismicFeatures,
} from '../risk/engine';
import type { OfficialWarningStatus } from '@/integrations/adapters/types';

/**
 * Behavioral tests for voice generation.
 *
 * The single most important property: the spoken script must NEVER assert
 * safety or a measurement the sources did not publish. A voice alert that says
 * "conditions are calm" while the data is missing is worse than no alert at
 * all, because it is harder to disbelieve.
 */

const NOW = () => new Date('2026-09-30T12:00:00.000Z');

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

function seismic(overrides: Partial<SeismicFeatures> = {}): SeismicFeatures {
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

function build(f: HazardFeatures, s: SeismicFeatures, warnings = NO_WARNINGS, warningActive: boolean | null = null) {
  return buildVoiceScript({
    features: f,
    assessment: assessCoastalRisk(
      { features: f, seismic: s, officialWarnings: warnings, officialWarningActive: warningActive },
      qualityGood(),
      NOW
    ),
    officialWarnings: warnings,
    retrievedAt: '2026-09-30T11:59:00.000Z',
  });
}

// =====================================================================
// NEVER FABRICATE
// =====================================================================

describe('voice never fabricates measurements', () => {
  it('says wave height is unavailable instead of inventing one', () => {
    const script = build(features({ waveHeightM: null }), seismic());

    expect(script.text).toContain('wave height is currently unavailable');
    expect(script.unavailableFields).toContain('wave height');
  });

  it('never says "calm" or "safe" when data is missing', () => {
    const script = build(
      features({ waveHeightM: null, wavePeriodS: null, windSpeedKmh: null, precipitationMm: null }),
      emptySeismicFeatures()
    );

    expect(script.text.toLowerCase()).not.toContain('calm');
    expect(script.assertsAllClear).toBe(false);
    expect(script.text).toContain('does not confirm safety');
  });

  it('speaks the real wave height when present', () => {
    const script = build(features({ waveHeightM: 3.9 }), seismic());
    expect(script.text).toContain('Significant wave height is 3.9 metres');
  });

  it('speaks the real wind speed when present', () => {
    const script = build(features({ windSpeedKmh: 42 }), seismic());
    expect(script.text).toContain('Sustained wind is 42 kilometres per hour');
  });

  it('lists unavailable fields rather than omitting them silently', () => {
    const script = build(features({ swellHeightM: null }), seismic());
    expect(script.unavailableFields).toContain('swell height');
  });
});

// =====================================================================
// OFFICIAL WARNINGS AND TSUNAMI
// =====================================================================

describe('voice never misrepresents official warnings', () => {
  it('says UNKNOWN when the bulletins could not be read', () => {
    const unreadable: OfficialWarningStatus = {
      authority: 'IMD',
      productId: 'IMD_MARINE_FORECAST',
      label: 'IMD Marine Forecast',
      url: 'https://mausam.imd.gov.in/responsive/marine_forecast.php',
      active: null,
      issuedAt: null,
      validFrom: null,
      validUntil: null,
      headline: null,
      affectedArea: null,
      retrievedAt: '2026-09-30T12:00:00Z',
      status: 'unavailable',
      blocker: 'cors-denied',
      blockerDetail: 'No CORS header',
      httpStatus: 200,
      contentType: 'text/html',
    };

    const script = build(features(), seismic(), [unreadable], null);

    expect(script.text).toContain('could not be read');
    expect(script.text).toContain('warning status is unknown');
    // The critical negative: it must NOT claim there is no warning.
    expect(script.text).not.toContain('report no active warning');
  });

  it('reports an active official warning', () => {
    const active: OfficialWarningStatus = {
      authority: 'IMD',
      productId: 'IMD_MARINE_FORECAST',
      label: 'IMD Marine Forecast',
      url: 'https://mausam.imd.gov.in/responsive/marine_forecast.php',
      active: true,
      issuedAt: '2026-09-30T10:00:00Z',
      validFrom: null,
      validUntil: null,
      headline: 'x',
      affectedArea: 'Mumbai',
      retrievedAt: '2026-09-30T12:00:00Z',
      status: 'live',
      blocker: null,
      blockerDetail: null,
      httpStatus: 200,
      contentType: 'application/json',
    };

    const script = build(features(), seismic(), [active], true);
    expect(script.text).toContain('official IMD or INCOIS warning is currently active');
  });

  it('says tsunami status is UNKNOWN when no flag was published', () => {
    const script = build(features(), seismic());
    expect(script.text).toContain('Tsunami status is currently unknown');
    expect(script.unavailableFields).toContain('tsunami status');
  });

  it('never turns an unknown tsunami flag into "no tsunami"', () => {
    const script = build(features(), seismic({ eventCount: 0 }));
    expect(script.text.toLowerCase()).not.toContain('no tsunami');
  });

  it('reports an authoritative true tsunami flag as a reported flag, not a prediction', () => {
    const script = build(
      features(),
      seismic({ seismicMagnitude: 7.5, seismicDepthKm: 20, tsunamiFlag: true, tsunamiFlagAuthoritative: true, eventCount: 1 })
    );
    expect(script.text).toContain('tsunami flag is present');
  });

  it('reports an authoritative false flag distinctly', () => {
    const script = build(
      features(),
      seismic({ seismicMagnitude: 5.0, seismicDepthKm: 20, tsunamiFlag: false, tsunamiFlagAuthoritative: true, eventCount: 1 })
    );
    expect(script.text).toContain('non-tsunami flag');
    expect(script.text).toContain('not a tsunami prediction');
  });

  it('never derives tsunami language from magnitude alone', () => {
    // Magnitude 8 with no flag: must stay unknown.
    const script = build(
      features(),
      seismic({ seismicMagnitude: 8.0, seismicDepthKm: 10, tsunamiFlag: null, tsunamiFlagAuthoritative: false, eventCount: 1 })
    );
    expect(script.text).toContain('Tsunami status is currently unknown');
  });
});

// =====================================================================
// ALL-CLEAR GATE
// =====================================================================

describe('all-clear requires every precondition', () => {
  it('refuses an all-clear while any dimension lacks data', () => {
    // Coastal water is always insufficient-data, so a full all-clear is not
    // currently reachable. This guards the gate itself.
    const script = build(features(), seismic());
    expect(script.assertsAllClear).toBe(false);
  });

  it('never claims an all-clear when a value is unavailable', () => {
    const script = build(features({ waveHeightM: null }), seismic());
    expect(script.assertsAllClear).toBe(false);
    expect(script.text).toContain('does not confirm safety');
  });
});

// =====================================================================
// GENERATION STATES
// =====================================================================

describe('audio generation', () => {
  it('uses the ElevenLabs edge function when configured and audio is returned', async () => {
    const fakeAudio = new Blob(['audio'], { type: 'audio/mpeg' });
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:fake') });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'audio/mpeg' },
      blob: async () => fakeAudio,
    });

    const result = await generateVoiceAlert('test script', {
      supabaseUrl: 'https://project.supabase.co',
      supabaseKey: 'anon-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      speechSynthesis: null,
    });

    expect(result.kind).toBe('ready');
    if (result.kind === 'ready') {
      expect(result.source).toBe('elevenlabs');
      expect(result.url).toBe('blob:fake');
    }
  });

  it('never sends a provider credential from the client', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      headers: { get: () => 'text/plain' },
      blob: async () => new Blob([]),
    });

    await generateVoiceAlert('script', {
      supabaseUrl: 'https://project.supabase.co',
      supabaseKey: 'anon-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      speechSynthesis: null,
    });

    const [, init] = fetchImpl.mock.calls[0];
    const serialized = JSON.stringify(init);
    // Only the anon key is present; a service-role secret never is.
    expect(serialized).toContain('anon-key');
    expect(serialized).not.toContain('service_role');
  });

  it('falls back to browser speech when the edge function fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const speak = vi.fn();

    vi.stubGlobal('SpeechSynthesisUtterance', class { rate = 1; constructor(public text: string) {} });

    const result = await generateVoiceAlert('script', {
      supabaseUrl: 'https://project.supabase.co',
      supabaseKey: 'anon-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      speechSynthesis: { speak } as unknown as typeof speechSynthesis,
    });

    expect(result.kind).toBe('ready');
    if (result.kind === 'ready') expect(result.source).toBe('browser');
    expect(speak).toHaveBeenCalled();
  });

  it('reports unavailable when no speech backend exists', async () => {
    const result = await generateVoiceAlert('script', {
      supabaseUrl: null,
      supabaseKey: null,
      speechSynthesis: null,
    });

    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.reason).toContain('speech');
    }
  });

  it('reports a retryable error when browser speech throws', async () => {
    const result = await generateVoiceAlert('script', {
      supabaseUrl: null,
      supabaseKey: null,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      speechSynthesis: {
        speak: () => {
          throw new Error('speech failed');
        },
      } as unknown as typeof speechSynthesis,
    });

    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.retryable).toBe(true);
  });

  it('falls back when the edge function returns a non-audio body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      blob: async () => new Blob(['{}']),
    });

    const result = await generateVoiceAlert('script', {
      supabaseUrl: 'https://project.supabase.co',
      supabaseKey: 'anon-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      speechSynthesis: { speak: vi.fn() } as unknown as typeof speechSynthesis,
    });

    expect(result.kind).toBe('ready');
    if (result.kind === 'ready') expect(result.source).toBe('browser');
  });
});
