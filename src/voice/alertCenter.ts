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
import { formatInstantInSourceTimezone } from '@/lib/sourceTime';
import type { Language } from '@/lib/translations';

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

// =====================================================================
// MULTILINGUAL SCRIPT FRAMING
// =====================================================================
//
// The script is ONE canonical derivation from observed state. Only the fixed
// framing sentences are translated; every number, state label and timestamp is
// interpolated identically in all four languages from the same observed
// values. A translation therefore cannot change what is claimed, only the
// language it is claimed in.
//
// The `en` column holds the exact historical wording so existing behaviour
// (and tests) are unchanged. Canonical state/quality words ("Nominal",
// "CURRENT", ...) stay in English in every language because they are the exact
// labels the rest of the UI renders; translating them would disconnect the
// spoken alert from the badges on screen.

interface VoiceStrings {
  header: string;
  riskUnknown: string;
  riskIs: (state: string) => string;
  waveIs: (wave: string) => string;
  waveUnavailable: string;
  fieldWaveHeight: string;
  swellIs: (swell: string) => string;
  swellUnavailable: string;
  fieldSwellHeight: string;
  windIs: (wind: string) => string;
  windUnavailable: string;
  fieldWindSpeed: string;
  gustsAre: (gust: string) => string;
  fieldWindGusts: string;
  warningActive: string;
  warningNone: string;
  warningUnknown: string;
  fieldWarningState: string;
  tsunamiPresent: string;
  tsunamiNotFlagged: string;
  tsunamiUnknown: string;
  fieldTsunamiStatus: string;
  qualityIs: (state: string, assessment: string) => string;
  allClear: string;
  notConfirmingSafety: (count: number) => string;
  retrievedAt: (when: string) => string;
}

const VOICE_STRINGS: Record<Language, VoiceStrings> = {
  en: {
    header: 'AAPDA SETU coastal alert.',
    riskUnknown: 'Coastal risk state is unknown because required data is unavailable.',
    riskIs: (state) => `Coastal risk state is ${state}.`,
    waveIs: (wave) => `Significant wave height is ${wave}.`,
    waveUnavailable: 'Significant wave height is currently unavailable.',
    fieldWaveHeight: 'wave height',
    swellIs: (swell) => `Swell wave height is ${swell}.`,
    swellUnavailable: 'Swell wave height is currently unavailable.',
    fieldSwellHeight: 'swell height',
    windIs: (wind) => `Sustained wind is ${wind}.`,
    windUnavailable: 'Wind speed is currently unavailable.',
    fieldWindSpeed: 'wind speed',
    gustsAre: (gust) => `Wind gusts are ${gust}.`,
    fieldWindGusts: 'wind gusts',
    warningActive: 'An official IMD or INCOIS warning is currently active.',
    warningNone: 'The official bulletins this application can read report no active warning.',
    warningUnknown:
      'Official IMD and INCOIS bulletins could not be read, so warning status is unknown. ' +
      'This is not an all-clear.',
    fieldWarningState: 'official warning state',
    tsunamiPresent: 'An official tsunami flag is present for a recent regional event.',
    tsunamiNotFlagged:
      'The USGS published a non-tsunami flag for regional events. This is not a tsunami prediction.',
    tsunamiUnknown: 'Tsunami status is currently unknown.',
    fieldTsunamiStatus: 'tsunami status',
    qualityIs: (state, assessment) => `Data quality is ${state}, assessed ${assessment}.`,
    allClear: 'All monitored sources are current and no threshold has been crossed.',
    notConfirmingSafety: (count) =>
      `This alert does not confirm safety. ${count} input(s) are unavailable.`,
    retrievedAt: (when) => `Data retrieved at ${when} IST.`,
  },
  hi: {
    header: 'आपदा सेतु तटीय चेतावनी।',
    riskUnknown: 'आवश्यक डेटा उपलब्ध नहीं है, इसलिए तटीय जोखिम स्थिति अज्ञात है।',
    riskIs: (state) => `तटीय जोखिम स्थिति ${state} है।`,
    waveIs: (wave) => `महत्वपूर्ण लहर ऊंचाई ${wave} है।`,
    waveUnavailable: 'महत्वपूर्ण लहर ऊंचाई वर्तमान में उपलब्ध नहीं है।',
    fieldWaveHeight: 'लहर ऊंचाई',
    swellIs: (swell) => `प्रभावी सूजन लहर ऊंचाई ${swell} है।`,
    swellUnavailable: 'सूजन लहर ऊंचाई वर्तमान में उपलब्ध नहीं है।',
    fieldSwellHeight: 'सूजन लहर ऊंचाई',
    windIs: (wind) => `निरंतर हवा ${wind} है।`,
    windUnavailable: 'हवा की गति वर्तमान में उपलब्ध नहीं है।',
    fieldWindSpeed: 'हवा की गति',
    gustsAre: (gust) => `हवा के झोंके ${gust} हैं।`,
    fieldWindGusts: 'हवा के झोंके',
    warningActive: 'वर्तमान में IMD या INCOIS की आधिकारिक चेतावनी सक्रिय है।',
    warningNone: 'इस एप्लिकेशन द्वारा पढ़े गए आधिकारिक बुलेटिनों में कोई सक्रिय चेतावनी नहीं है।',
    warningUnknown:
      'IMD और INCOIS के आधिकारिक बुलेटिन पढ़े नहीं जा सके, इसलिए चेतावनी स्थिति अज्ञात है। ' +
      'यह पूर्ण सुरक्षा की घोषणा नहीं है।',
    fieldWarningState: 'आधिकारिक चेतावनी स्थिति',
    tsunamiPresent: 'हाल की क्षेत्रीय घटना के लिए आधिकारिक सुनामी ध्वज मौजूद है।',
    tsunamiNotFlagged:
      'USGS ने क्षेत्रीय घटनाओं के लिए गैर-सुनामी ध्वज प्रकाशित किया है। यह सुनामी की भविष्यवाणी नहीं है।',
    tsunamiUnknown: 'सुनामी स्थिति वर्तमान में अज्ञात है।',
    fieldTsunamiStatus: 'सुनामी स्थिति',
    qualityIs: (state, assessment) => `डेटा गुणवत्ता ${state} है, मूल्यांकन ${assessment}।`,
    allClear: 'सभी निगरानी स्रोत वर्तमान हैं और कोई सीमा पार नहीं हुई है।',
    notConfirmingSafety: (count) =>
      `यह चेतावनी सुरक्षा की पुष्टि नहीं करती। ${count} इनपुट उपलब्ध नहीं हैं।`,
    retrievedAt: (when) => `डेटा ${when} IST पर प्राप्त किया गया।`,
  },
  mr: {
    header: 'आपदा सेतु किनारपट्टी इशारा।',
    riskUnknown: 'आवश्यक डेटा उपलब्ध नाही, म्हणून किनारपट्टी जोखीम स्थिती अज्ञात आहे।',
    riskIs: (state) => `किनारपट्टी जोखीम स्थिती ${state} आहे।`,
    waveIs: (wave) => `महत्त्वाची लाट उंची ${wave} आहे।`,
    waveUnavailable: 'महत्त्वाची लाट उंची सध्या उपलब्ध नाही।',
    fieldWaveHeight: 'लाट उंची',
    swellIs: (swell) => `उफान लाट उंची ${swell} आहे।`,
    swellUnavailable: 'उफान लाट उंची सध्या उपलब्ध नाही।',
    fieldSwellHeight: 'उफान लाट उंची',
    windIs: (wind) => `सातत्यपूर्ण वारा ${wind} आहे।`,
    windUnavailable: 'वाऱ्याचा वेग सध्या उपलब्ध नाही।',
    fieldWindSpeed: 'वाऱ्याचा वेग',
    gustsAre: (gust) => `वाऱ्याचे झोत ${gust} आहेत।`,
    fieldWindGusts: 'वाऱ्याचे झोत',
    warningActive: 'सध्या IMD किंवा INCOIS ची अधिकृत चेतावणी सक्रिय आहे।',
    warningNone: 'या ॲपला वाचता आलेल्या अधिकृत बुलेटिनमध्ये कोणतीही सक्रिय चेतावणी नाही।',
    warningUnknown:
      'IMD आणि INCOIS ची अधिकृत बुलेटिन वाचता आली नाहीत, म्हणून चेतावणी स्थिती अज्ञात आहे। ' +
      'ही पूर्ण सुरक्षेची घोषणा नाही।',
    fieldWarningState: 'अधिकृत चेतावणी स्थिती',
    tsunamiPresent: 'अलीकडील प्रादेशिक घटनेसाठी अधिकृत त्सुनामी ध्वज आहे।',
    tsunamiNotFlagged:
      'USGS ने प्रादेशिक घटनांसाठी त्सुनामी-नसलेला ध्वज प्रकाशित केला आहे। ही त्सुनामी भविष्यवाणी नाही।',
    tsunamiUnknown: 'त्सुनामी स्थिती सध्या अज्ञात आहे।',
    fieldTsunamiStatus: 'त्सुनामी स्थिती',
    qualityIs: (state, assessment) => `डेटा गुणवत्ता ${state} आहे, मूल्यांकन ${assessment}।`,
    allClear: 'सर्व निरीक्षण स्रोत अद्ययावत आहेत आणि कोणतीही मर्यादा ओलांडली नाही।',
    notConfirmingSafety: (count) =>
      `हा इशारा सुरक्षेची पुष्टी करत नाही। ${count} इनपुट उपलब्ध नाहीत।`,
    retrievedAt: (when) => `डेटा ${when} IST रोजी प्राप्त झाला।`,
  },
  gu: {
    header: 'આપદા સેતુ દરિયાકાંઠા ચેતવણી।',
    riskUnknown: 'જરૂરી ડેટા ઉપલબ્ધ નથી, તેથી દરિયાકાંઠાનું જોખમ અજ્ઞાત છે।',
    riskIs: (state) => `દરિયાકાંઠાનું જોખમ ${state} છે।`,
    waveIs: (wave) => `નોંધપાત્ર મોજાની ઊંચાઈ ${wave} છે।`,
    waveUnavailable: 'નોંધપાત્ર મોજાની ઊંચાઈ હાલમાં ઉપલબ્ધ નથી।',
    fieldWaveHeight: 'મોજાની ઊંચાઈ',
    swellIs: (swell) => `ઉછાળાના મોજાની ઊંચાઈ ${swell} છે।`,
    swellUnavailable: 'ઉછાળાના મોજાની ઊંચાઈ હાલમાં ઉપલબ્ધ નથી।',
    fieldSwellHeight: 'ઉછાળાના મોજાની ઊંચાઈ',
    windIs: (wind) => `સતત પવન ${wind} છે।`,
    windUnavailable: 'પવનની ગતિ હાલમાં ઉપલબ્ધ નથી।',
    fieldWindSpeed: 'પવનની ગતિ',
    gustsAre: (gust) => `પવનના ઝાપટા ${gust} છે।`,
    fieldWindGusts: 'પવનના ઝાપટા',
    warningActive: 'હાલમાં IMD અથવા INCOIS ની સત્તાવાર ચેતવણી સક્રિય છે।',
    warningNone: 'આ એપ વાંચી શકે તેવા સત્તાવાર બુલેટિનમાં કોઈ સક્રિય ચેતવણી નથી।',
    warningUnknown:
      'IMD અને INCOIS ના સત્તાવાર બુલેટિન વાંચી શકાયા નથી, તેથી ચેતવણી સ્થિતિ અજ્ઞાત છે। ' +
      'આ સંપૂર્ણ સલામતીની જાહેરાત નથી।',
    fieldWarningState: 'સત્તાવાર ચેતવણી સ્થિતિ',
    tsunamiPresent: 'તાજેતરની પ્રાદેશિક ઘટના માટે સત્તાવાર સુનામી ધ્વજ છે।',
    tsunamiNotFlagged:
      'USGS એ પ્રાદેશિક ઘટનાઓ માટે બિન-સુનામી ધ્વજ પ્રકાશિત કર્યો છે। આ સુનામીની આગાહી નથી।',
    tsunamiUnknown: 'સુનામી સ્થિતિ હાલમાં અજ્ઞાત છે।',
    fieldTsunamiStatus: 'સુનામી સ્થિતિ',
    qualityIs: (state, assessment) => `ડેટા ગુણવત્તા ${state} છે, મૂલ્યાંકન ${assessment}।`,
    allClear: 'બધા નિરીક્ષણ સ્ત્રોત વર્તમાન છે અને કોઈ મર્યાદા ઓળંગાઈ નથી।',
    notConfirmingSafety: (count) =>
      `આ ચેતવણી સલામતીની પુષ્ટિ કરતી નથી। ${count} ઇનપુટ ઉપલબ્ધ નથી।`,
    retrievedAt: (when) => `ડેટા ${when} IST પર મેળવવામાં આવ્યો।`,
  },
};

/**
 * Build the spoken script from observed state.
 *
 * The wording is deliberately literal and numeric. It never rounds away a
 * threshold crossing, never substitutes a qualitative adjective for a missing
 * measurement, and never claims an authority has issued or not issued a warning
 * unless we actually read the bulletin.
 *
 * `language` selects only the framing sentences (see VOICE_STRINGS). Values,
 * state labels and timestamps are identical in every language.
 */
export function buildVoiceScript(args: {
  features: HazardFeatures;
  assessment: CoastalRiskAssessment;
  officialWarnings: readonly OfficialWarningStatus[];
  retrievedAt: string | null;
  language?: Language;
}): VoiceScript {
  const { features, assessment, officialWarnings, retrievedAt, language = 'en' } = args;
  const s = VOICE_STRINGS[language] ?? VOICE_STRINGS.en;
  const unavailableFields: string[] = [];
  const parts: string[] = [s.header];

  // --- headline state --------------------------------------------------
  const state = assessment.state;
  if (state === 'unknown') {
    parts.push(s.riskUnknown);
  } else {
    parts.push(s.riskIs(formatState(state).toLowerCase()));
  }

  // --- wave height -----------------------------------------------------
  const wave = fmt(features.waveHeightM, ' metres');
  if (wave) {
    parts.push(s.waveIs(wave));
  } else {
    parts.push(s.waveUnavailable);
    unavailableFields.push(s.fieldWaveHeight);
  }

  // --- swell -----------------------------------------------------------
  const swell = fmt(features.swellHeightM, ' metres');
  if (swell) {
    parts.push(s.swellIs(swell));
  } else {
    parts.push(s.swellUnavailable);
    unavailableFields.push(s.fieldSwellHeight);
  }

  // --- wind ------------------------------------------------------------
  const wind = fmt(features.windSpeedKmh, ' kilometres per hour', 0);
  if (wind) {
    parts.push(s.windIs(wind));
  } else {
    parts.push(s.windUnavailable);
    unavailableFields.push(s.fieldWindSpeed);
  }

  const gust = fmt(features.windGustKmh, ' kilometres per hour', 0);
  if (gust) {
    parts.push(s.gustsAre(gust));
  } else {
    unavailableFields.push(s.fieldWindGusts);
  }

  // --- official warning ------------------------------------------------
  if (assessment.officialWarningActive === true) {
    parts.push(s.warningActive);
  } else if (assessment.officialWarningActive === false) {
    parts.push(s.warningNone);
  } else {
    // The honest and important case: we could not check. The wording names the
    // outcome, not the mechanism, so it stays accurate whether the blocker was
    // CORS, an unreachable retriever, or a page that carried no bulletin.
    parts.push(s.warningUnknown);
    unavailableFields.push(s.fieldWarningState);
  }

  // --- tsunami ---------------------------------------------------------
  if (assessment.tsunamiStatus === true && assessment.tsunamiAuthoritative) {
    parts.push(s.tsunamiPresent);
  } else if (assessment.tsunamiStatus === false && assessment.tsunamiAuthoritative) {
    parts.push(s.tsunamiNotFlagged);
  } else {
    parts.push(s.tsunamiUnknown);
    unavailableFields.push(s.fieldTsunamiStatus);
  }

  // --- data quality ----------------------------------------------------
  const quality = assessment.quality;
  parts.push(s.qualityIs(quality.state.toLowerCase(), quality.assessment.toLowerCase()));

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
    parts.push(s.allClear);
  } else if (unavailableFields.length > 0) {
    parts.push(s.notConfirmingSafety(unavailableFields.length));
  }

  if (retrievedAt) {
    parts.push(s.retrievedAt(formatInstantInSourceTimezone(retrievedAt)));
  }

  void officialWarnings;

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
 * DEPRECATED as a UI path: the single speech engine is `speak()` in
 * `./speech` (ElevenLabs Edge Function first, browser speech synthesis
 * second, with per-language voices). New UI must call
 * `speakVoiceScript()` from `./speech` with the canonical text from
 * `buildVoiceScript`, so playback, language selection and event-stream
 * reporting stay in one place.
 *
 * Kept (and still tested) because it is a small, dependency-free playback
 * helper; it is no longer wired to any component.
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
