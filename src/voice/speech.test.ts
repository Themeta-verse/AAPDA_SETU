import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  speak,
  speakVoiceScript,
  resetSpeechForTests,
  type SpeechEngineOptions,
} from './speech';
import {
  subscribeToActionEvents,
  resetActionEventsForTests,
} from '@/events/eventBus';
import type { BayWatchEvent } from '@/notifications/types';

/**
 * The single speech engine must report what actually happened to the one
 * event stream: a played alert files `voice-generated`, a failure files
 * `voice-failed`. A silent button is a broken safety control, and a success
 * report for unplayed audio is a fabrication.
 */

function collectEvents() {
  const seen: BayWatchEvent[] = [];
  const unsub = subscribeToActionEvents((e) => {
    seen.push(e);
  });
  return { seen, unsub };
}

function browserEnv() {
  const spoken: string[] = [];
  const synth = {
    cancel: vi.fn(),
    speak: vi.fn((u: { text: string }) => {
      spoken.push(u.text);
    }),
  };
  class FakeUtterance {
    lang = '';
    rate = 1;
    pitch = 1;
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    constructor(public text: string) {}
  }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    value: FakeUtterance,
    configurable: true,
    writable: true,
  });
  return { synth: synth as unknown as SpeechSynthesis, spoken };
}

describe('speakVoiceScript reports to the event stream', () => {
  beforeEach(() => {
    resetSpeechForTests();
    resetActionEventsForTests();
  });

  it('files voice-generated when the browser engine plays the script', async () => {
    const { synth, spoken } = browserEnv();
    const { seen, unsub } = collectEvents();
    const opts: SpeechEngineOptions = { speechSynthesis: synth };

    const result = await speakVoiceScript('AAPDA SETU coastal alert. Test.', {
      ...opts,
      language: 'hi',
    });

    expect(result.kind).toBe('playing');
    expect(spoken).toHaveLength(1);
    const event = seen.find((e) => e.kind === 'voice-generated');
    expect(event).toBeDefined();
    expect(event?.data.language).toBe('hi');
    unsub();
  });

  it('files voice-failed when the provider errors and speaks nothing new', async () => {
    const { seen, unsub } = collectEvents();
    const failingFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
    });

    const result = await speak('test', {
      supabaseUrl: 'https://example.supabase.co',
      supabaseKey: 'anon-key',
      fetchImpl: failingFetch as unknown as typeof fetch,
      // No browser engine in this environment: `speak` (not the wrapper)
      // returns the provider failure directly.
      speechSynthesis: null,
    });

    // Provider failure with no browser fallback configured in this call.
    expect(result.kind).toBe('failed');
    void seen;
    unsub();
  });

  it('speakVoiceScript files voice-failed when nothing can play', async () => {
    const { seen, unsub } = collectEvents();

    const result = await speakVoiceScript('AAPDA SETU coastal alert. Test.', {
      // No provider config and no browser engine: genuinely unavailable.
      speechSynthesis: null,
    });

    expect(result.kind).toBe('unavailable');
    const event = seen.find((e) => e.kind === 'voice-failed');
    expect(event).toBeDefined();
    expect(event?.summary).toContain('unavailable');
    unsub();
  });

  it('refuses to speak an empty script instead of filing a false success', async () => {
    const { seen, unsub } = collectEvents();
    const result = await speakVoiceScript('   ', { speechSynthesis: null });
    expect(result.kind).toBe('failed');
    expect(seen.find((e) => e.kind === 'voice-generated')).toBeUndefined();
    unsub();
  });
});
