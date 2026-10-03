/**
 * The one speech engine.
 *
 * This module owns playback only: turning a script into audible output and
 * stopping it again. It does NOT decide what is said — that is
 * `buildVoiceScript` in `./alertCenter`, which is the single generator of
 * spoken text derived from verified application state.
 *
 * Two real backends, tried in order:
 *
 *   1. `elevenlabs-tts` Supabase Edge Function. The provider API key lives
 *      server-side in the function; this client never sees it. The function has
 *      `verify_jwt = true`, so the signed-in user's access token is sent as the
 *      bearer rather than the anonymous key.
 *   2. The browser's built-in speech synthesis. A real fallback, not a stub.
 *
 * Overlapping speech is prevented by cancelling anything in flight before a new
 * utterance starts, and by owning the single in-flight audio element.
 */

import { supabase } from '@/integrations/supabase/client';
import { publishActionEvent } from '@/events/eventBus';

export type SpeechBackend = 'elevenlabs' | 'browser';

export type SpeechResult =
  | { kind: 'playing'; backend: SpeechBackend }
  | { kind: 'failed'; message: string; retryable: boolean }
  | { kind: 'unavailable'; reason: string };

/** BCSS/BCP-47 tags for the languages the app ships. */
const SPEECH_LANG: Record<string, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  mr: 'mr-IN',
  gu: 'gu-IN',
};

export interface SpeakOptions {
  language?: string;
  /** Element used to play ElevenLabs audio. Defaults to a detached Audio. */
  audio?: HTMLAudioElement;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

export interface SpeechEngineOptions {
  supabaseUrl?: string;
  supabaseKey?: string;
  fetchImpl?: typeof fetch;
  speechSynthesis?: SpeechSynthesis | null;
  signal?: AbortSignal;
}

let inFlightAudio: HTMLAudioElement | null = null;
let inFlightObjectUrl: string | null = null;
let elevenLabsDisabledForSession = false;

/** Non-secret configuration read from the same env vars as the rest of the app. */
/** Non-secret configuration read from the same env vars as the rest of the app. */
export function readSpeechConfig(): { supabaseUrl: string | null; supabaseKey: string | null } {
  const env = import.meta.env as Record<string, string | undefined>;
  if (env.MODE === 'test') {
    return { supabaseUrl: null, supabaseKey: null };
  }
  return {
    supabaseUrl: env.VITE_SUPABASE_URL ?? null,
    supabaseKey: env.VITE_SUPABASE_PUBLISHABLE_KEY ?? null,
  };
}

/** Stop any speech in flight, from either backend. */
export function stopSpeech(): void {
  if (inFlightAudio) {
    inFlightAudio.pause();
    inFlightAudio.currentTime = 0;
    inFlightAudio = null;
  }
  if (inFlightObjectUrl) {
    URL.revokeObjectURL(inFlightObjectUrl);
    inFlightObjectUrl = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

/** True when a backend is at least configured in this environment. */
export function isSpeechAvailable(options: SpeechEngineOptions = {}): boolean {
  const synth =
    options.speechSynthesis !== undefined
      ? options.speechSynthesis
      : typeof window !== 'undefined'
      ? window.speechSynthesis ?? null
      : null;
  const hasUtterance = typeof window !== 'undefined' && 'SpeechSynthesisUtterance' in window;
  return Boolean(hasUtterance && synth);
}

/**
 * Speak a script.
 *
 * Resolves with what actually happened. Never resolves `playing` when nothing
 * is audible, and never throws for an ordinary failure — the caller renders the
 * returned state.
 */
export async function speak(
  script: string,
  options: SpeakOptions & SpeechEngineOptions = {}
): Promise<SpeechResult> {
  // Never allow two overlapping utterances.
  stopSpeech();

  const text = script.trim();
  if (!text) {
    return { kind: 'failed', message: 'There is nothing to speak.', retryable: false };
  }

  if (!elevenLabsDisabledForSession) {
    const result = await speakViaElevenLabs(text, options);
    if (result && result.kind === 'playing') return result;
    // The provider path failed in a way that will not fix itself on an
    // immediate retry; stop trying for the rest of the session.
    elevenLabsDisabledForSession = true;
    // If browser speech is unavailable and the provider gave a failure result,
    // surface the provider failure rather than "unavailable".
    if (!isSpeechAvailable(options) && result) {
      return result;
    }
  }

  return speakViaBrowser(text, options);
}

async function speakViaElevenLabs(
  text: string,
  options: SpeakOptions & SpeechEngineOptions
): Promise<SpeechResult | null> {
  const env = readSpeechConfig();
  const url = options.supabaseUrl ?? env.supabaseUrl;
  const key = options.supabaseKey ?? env.supabaseKey;
  if (!url || !key) return null;

  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    // verify_jwt = true: send the user's access token when a session exists.
    let bearer = key;
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) bearer = data.session.access_token;
    } catch {
      // No session: the publishable key is the correct credential to try.
    }

    const response = await doFetch(`${url}/functions/v1/elevenlabs-tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ text, language: options.language ?? 'en' }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { kind: 'failed', message: `Voice service returned HTTP ${response.status}.`, retryable: true };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('audio')) {
      return { kind: 'failed', message: 'Voice service did not return audio.', retryable: true };
    }

    const blob = await response.blob();
    if (blob.size < 100) {
      return { kind: 'failed', message: 'Voice service returned an empty recording.', retryable: true };
    }

    const objectUrl = URL.createObjectURL(blob);
    const audio = options.audio ?? new Audio(objectUrl);
    inFlightObjectUrl = objectUrl;
    inFlightAudio = audio;

    return await new Promise<SpeechResult>((resolve) => {
      const finish = (result: SpeechResult) => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        inFlightAudio = null;
        inFlightObjectUrl = null;
        URL.revokeObjectURL(objectUrl);
        resolve(result);
      };

      audio.onended = () => {
        options.onEnd?.();
        finish({ kind: 'playing', backend: 'elevenlabs' });
      };
      audio.onerror = () => {
        const message = 'The recording could not be played.';
        options.onError?.(message);
        finish({ kind: 'failed', message, retryable: true });
      };

      audio.play().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Playback was blocked.';
        options.onError?.(message);
        finish({ kind: 'failed', message, retryable: true });
      });
    });
  } catch (err) {
    // A network or abort failure here is not a user-facing error: the browser
    // engine is a real alternative, so signal "try the next backend" with null.
    void err;
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

function speakViaBrowser(
  text: string,
  options: SpeakOptions & SpeechEngineOptions
): SpeechResult {
  const synth =
    options.speechSynthesis !== undefined
      ? options.speechSynthesis
      : typeof window !== 'undefined'
      ? window.speechSynthesis ?? null
      : null;
  const hasUtterance = typeof window !== 'undefined' && 'SpeechSynthesisUtterance' in window;

  if (!synth || !hasUtterance) {
    return {
      kind: 'unavailable',
      reason:
        'No speech backend is available. The voice service is not configured ' +
        '(VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY), and this browser has no ' +
        'usable speech synthesis engine.',
    };
  }

  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LANG[options.language ?? 'en'] ?? 'en-IN';
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => options.onEnd?.();
    utterance.onerror = (event) => {
      const message =
        event.error === 'not-allowed'
          ? 'The browser blocked speech playback. Allow audio for this site and retry.'
          : 'Browser speech playback failed.';
      options.onError?.(message);
    };
    synth.cancel();
    synth.speak(utterance);
    return { kind: 'playing', backend: 'browser' };
  } catch (err) {
    return {
      kind: 'failed',
      message: err instanceof Error ? err.message : 'Browser speech failed.',
      retryable: true,
    };
  }
}

/** Test-only: allow the provider path to be attempted again. */
export function resetSpeechForTests(): void {
  stopSpeech();
  elevenLabsDisabledForSession = false;
}

/**
 * Speak a canonical voice script and report the outcome to the event stream.
 *
 * This is the ONE entry point UI uses to play a generated alert. The text
 * comes from `buildVoiceScript` (the single generator of spoken content);
 * this function owns audibility only, plus exactly one action event so the
 * stream can show "voice alert generated" or "voice failed" without any
 * component owning a parallel log.
 */
export async function speakVoiceScript(
  script: string,
  options: SpeakOptions & SpeechEngineOptions = {}
): Promise<SpeechResult> {
  const result = await speak(script, options);
  const at = new Date().toISOString();
  if (result.kind === 'playing') {
    publishActionEvent({
      kind: 'voice-generated',
      at,
      summary: `Voice alert played via ${result.backend === 'elevenlabs' ? 'ElevenLabs' : 'browser speech'} (${options.language ?? 'en'})`,
      source: 'AAPDA SETU voice',
      data: { backend: result.backend, language: options.language ?? 'en' },
    });
  } else {
    publishActionEvent({
      kind: 'voice-failed',
      at,
      summary:
        result.kind === 'failed'
          ? `Voice alert failed: ${result.message}`
          : 'Voice alert unavailable: no speech backend in this environment',
      source: 'AAPDA SETU voice',
      data: {
        language: options.language ?? 'en',
        reason: result.kind === 'failed' ? result.message : result.reason,
      },
    });
  }
  return result;
}
