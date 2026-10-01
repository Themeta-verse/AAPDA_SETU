import { describe, it, expect } from 'vitest';
import { EVENT_LABEL } from './CoastalCommandCenter';
import type { BayWatchEventKind } from '@/notifications/types';

/**
 * Every event kind the system can file must have a human label in the stream.
 * An unlabelled kind renders as a raw machine string, which trains operators
 * to ignore the stream — the opposite of what it is for.
 */
const ALL_KINDS: BayWatchEventKind[] = [
  'source-recovered',
  'source-failed',
  'source-unavailable',
  'earthquake-received',
  'incident-received',
  'forecast-changed',
  'risk-changed',
  'official-warning-detected',
  'official-warning-cleared',
  'official-warning-unknown',
  'tsunami-flag-set',
  'tsunami-flag-cleared',
  'notification-generated',
  'notification-acknowledged',
  'voice-generated',
  'voice-failed',
  'manual-refresh',
  'gps-granted',
  'gps-denied',
  'gps-lost',
  'destination-selected',
  'route-calculated',
  'route-failed',
  'went-offline',
  'came-online',
];

describe('event stream labels', () => {
  it.each(ALL_KINDS)('labels the %s event kind', (kind) => {
    expect(EVENT_LABEL[kind]).toBeDefined();
    expect(EVENT_LABEL[kind]).not.toBe(kind);
  });
});
