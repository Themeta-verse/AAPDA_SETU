/**
 * Voice alert generation from real application state.
 *
 * CRITICAL RULE: the spoken text is assembled ONLY from values that were
 * actually observed. There is no template that can assert safety, and no path
 * that speaks a measurement the sources did not publish.
 *
 * Specifically:
 *  - If wave height is null, the script says it is unavailable. It never says
 *    "waves are calm".
 *  - If tsunami status is unknown, it says unknown. It never says "no tsunami".
 *  - If official warning state is unknown, it says unknown.
 *  - An "all clear" is only ever spoken when every dimension reached a verdict
 *    AND no official warning is active AND every source is current.
 *
 * Audio is produced by the EXISTING ElevenLabs Supabase Edge Function
 * (`elevenlabs-tts`), which holds the API key server-side. This module never
 * sees, stores or transmits a provider credential. When the function is
 * unavailable, the browser's built-in speech synthesis is used — a real,
 * functional fallback rather than a silent failure.
 */

import type { CoastalRiskAssessment, HazardFeatures } from '../risk/engine';
import type { OfficialWarningStatus } from '@/integrations/adapters/types';
import { formatState } from '../risk/explain';

export type VoiceState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; url: string; source: 'elevenlabs' | 'browser'; script: string }
  | { kind: 'error'; message: string; retryable: boolean }
  | { kind: 'unavailable'; reason: string };

export interface VoiceScript {
  /** The exact text that will be spoken. Shown in the UI before playing. */
  text: string;
  /** Fields that were unavailable and therefore could not be spoken. */
  unavailableFields: string[];
  /** True when the script states conditions are benign. */
  assertsAllClear: boolean;
}

function fmt(value: number | null | undefined, unit: string, digits = 1): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${value.toFixed(digits)}${unit}`;
}

/**
 * Build the spoken script from observed state.
 *
 * The wording is deliberately literal and numeric. It never rounds away a
 * threshold crossing, never substitutes a qualitative adjective for a missing
 * measurement, and never claims an authority has issued or not issued a warning
 * unless we actually read the bulletin.
 */
export function buildVoiceScript(args: {
  features: HazardFeatures;
  assessment: CoastalRiskAssessment;
  officialWarnings: readonly OfficialWarningStatus[];
  retrievedAt: string | null;
}): VoiceScript {
  const { features, assessment, officialWarnings, retrievedAt } = args;
  const unavailableFields: string[] = [];
  const parts: string[] = ['BayWatch coastal alert.'];

  // --- headline state --------------------------------------------------
  const state = assessment.state;
  if (state === 'unknown') {
    parts.push('Coastal risk state is unknown because required data is unavailable.');
  } else {
    parts.push(`Coastal risk state is ${formatState(state).toLowerCase()}.`);
  }

  // --- wave height -----------------------------------------------------
  const wave = fmt(features.waveHeightM, ' metres');
  if (wave) {
    parts.push(`Significant wave height is ${wave}.`);
  } else {
    parts.push('Significant wave height is currently unavailable.');
    unavailableFields.push('wave height');
  }

  // --- swell -----------------------------------------------------------
  const swell = fmt(features.swellHeightM, ' metres');
  if (swell) {
    parts.push(`Swell wave height is ${swell}.`);
  } else {
    parts.push('Swell wave height is currently unavailable.');
    unavailableFields.push('swell height');
  }

  // --- wind ------------------------------------------------------------
  const wind = fmt(features.windSpeedKmh, ' kilometres per hour', 0);
  if (wind) {
    parts.push(`Sustained wind is ${wind}.`);
  } else {
    parts.push('Wind speed is currently unavailable.');
    unavailableFields.push('wind speed');
  }

  const gust = fmt(features.windGustKmh, ' kilometres per hour', 0);
  if (gust) {
    parts.push(`Wind gusts are ${gust}.`);
  } else {
    unavailableFields.push('wind gusts');
  }

  // --- official warning ------------------------------------------------
  if (assessment.officialWarningActive === true) {
    parts.push('An official IMD or INCOIS warning is currently active.');
  } else if (assessment.officialWarningActive === false) {
    parts.push('The official bulletins this application can read report no active warning.');
  } else {
    // The honest and important case: we could not check.
    parts.push(
      'Official IMD and INCOIS bulletins could not be read from this browser, so warning status is unknown.'
    );
    unavailableFields.push('official warning state');
  }

  // --- tsunami ---------------------------------------------------------
  if (assessment.tsunamiStatus === true && assessment.tsunamiAuthoritative) {
    parts.push('An official tsunami flag is present for a recent regional event.');
  } else if (assessment.tsunamiStatus === false && assessment.tsunamiAuthoritative) {
    parts.push(
      'The USGS published a non-tsunami flag for regional events. This is not a tsunami prediction.'
    );
  } else {
    parts.push('Tsunami status is currently unknown.');
    unavailableFields.push('tsunami status');
  }

  // --- data quality ----------------------------------------------------
  const quality = assessment.quality;
  parts.push(`Data quality is ${quality.state.toLowerCase()}, assessed ${quality.assessment.toLowerCase()}.`);

  // --- all-clear gate --------------------------------------------------
  // Only assert safety when EVERY precondition is genuinely met.
  const dimensionsNamed = Object.values(assessment.dimensions);
  const everyDimensionResolved = dimensionsNamed.every(
    (d) => d.state !== 'insufficient-data'
  );
  const everySourceCurrent = quality.state === 'CURRENT';

  const assertsAllClear =
    state === 'nominal' &&
    assessment.officialWarningActive === false &&
    everyDimensionResolved &&
    everySourceCurrent &&
    unavailableFields.length === 0;

  if (assertsAllClear) {
    parts.push('All monitored sources are current and no threshold has been crossed.');
  } else if (unavailableFields.length > 0) {
    parts.push(
      `This alert does not confirm safety. ${unavailableFields.length} input(s) are unavailable.`
    );
  }

  if (retrievedAt) {
    parts.push(`Data retrieved at ${retrievedAt}.`);
  }

  return {
    text: parts.join(' '),
    unavailableFields,
    assertsAllClear,
  };
}

// =====================================================================
// AUDIO PRODUCTION
// =====================================================================

export interface VoiceDeps {
  /** Supabase project URL; the Edge Function is invoked against it. */
  supabaseUrl?: string;
  /** Public anon key. Safe to expose: the Edge Function holds the real key. */
  supabaseKey?: string;
  fetchImpl?: typeof fetch;
  /** Present only in a real browser. */
  speechSynthesis?: typeof speechSynthesis | null;
}

/** Non-secret configuration, read from the same env vars as the app. */
export function readVoiceConfig(): { supabaseUrl: string | null; supabaseKey: string | null } {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    supabaseUrl: env.VITE_SUPABASE_URL ?? null,
    supabaseKey: env.VITE_SUPABASE_PUBLISHABLE_KEY ?? null,
  };
}

/**
 * Produce playable audio for a script.
 *
 * Tries the ElevenLabs Edge Function first, then the browser speech engine.
 * Both are real. If neither is available the caller receives `unavailable`
 * with a reason — never a silent success.
 */
export async function generateVoiceAlert(
  script: string,
  deps: VoiceDeps = {}
): Promise<Extract<VoiceState, { kind: 'ready' | 'error' | 'unavailable' }>> {
  const {
    supabaseUrl,
    supabaseKey,
    fetchImpl = globalThis.fetch,
    speechSynthesis =
      typeof window !== 'undefined' ? window.speechSynthesis : null,
  } = deps;

  const url = supabaseUrl;
  const key = supabaseKey;

  if (url && key) {
    try {
      const response = await fetchImpl(`${url}/functions/v1/elevenlabs-tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ text: script }),
      });

      if (response.ok) {
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('audio')) {
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          return { kind: 'ready', url: objectUrl, source: 'elevenlabs', script };
        }
      }
      // Non-OK or wrong content type: fall through to the browser engine.
    } catch {
      // Network failure against the Edge Function: fall through.
    }
  }

  // Browser speech engine. Guarded on the Utterance constructor too: some
  // environments expose `speechSynthesis` without `SpeechSynthesisUtterance`,
  // and constructing it there would throw and lose the fallback entirely.
  const hasUtterance =
    speechSynthesis !== null && typeof window !== 'undefined' && 'SpeechSynthesisUtterance' in window;

  if (hasUtterance) {
    try {
      const utterance = new SpeechSynthesisUtterance(script);
      utterance.rate = 1.0;
      speechSynthesis!.speak(utterance);
      // An empty string URL signals "played live, not a downloadable file".
      return { kind: 'ready', url: '', source: 'browser', script };
    } catch (err) {
      return {
        kind: 'error',
        message: err instanceof Error ? err.message : 'Browser speech failed',
        retryable: true,
      };
    }
  }

  return {
    kind: 'unavailable',
    reason:
      'No speech backend is available. The ElevenLabs Edge Function is not configured ' +
      '(VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY), and this browser has no ' +
      'usable speech synthesis engine.',
  };
}
