/**
 * Source-time formatting.
 *
 * Guards the timezone correctness of forecast rendering: a source-local
 * timestamp must render identically for every viewer, and must never be
 * reinterpreted in the browser's timezone.
 */

import { describe, it, expect } from 'vitest';
import {
  formatForecastHourLabel,
  formatForecastTimestamp,
  formatForecastDateLabel,
  formatInstantInSourceTimezone,
} from './sourceTime';

describe('hour labels', () => {
  it('renders the source-local hour verbatim', () => {
    expect(formatForecastHourLabel('2026-10-01T14:00')).toBe('14:00');
  });

  it('does not shift the hour into the browser timezone', () => {
    // 14:00 IST is 08:30 UTC. A `new Date(...)` round-trip would render
    // 08:30 for a UTC viewer and 20:00 for a UTC+6 viewer.
    expect(formatForecastHourLabel('2026-10-01T14:00')).toBe('14:00');
    expect(formatForecastHourLabel('2026-10-01T00:00')).toBe('00:00');
    expect(formatForecastHourLabel('2026-10-01T23:00')).toBe('23:00');
  });

  it('is identical for a real instant string too, rather than shifting it', () => {
    // We never call this on an instant, but it must not silently shift either.
    expect(formatForecastHourLabel('2026-10-01T14:00:00Z')).toBe('14:00');
  });

  it('returns the input unchanged when unrecognisable', () => {
    expect(formatForecastHourLabel('whenever')).toBe('whenever');
  });

  it('never renders NaN or Invalid Date', () => {
    for (const input of ['nonsense', '', '2026-13-45T99:99']) {
      const out = formatForecastHourLabel(input) + formatForecastTimestamp(input);
      expect(out).not.toContain('NaN');
      expect(out).not.toContain('Invalid');
    }
  });
});

describe('full timestamps', () => {
  it('includes weekday, date and the IST hour', () => {
    const out = formatForecastTimestamp('2026-10-01T14:00');
    expect(out).toContain('14:00');
    expect(out).toContain('1 Oct');
    expect(out).toContain('Thu');
  });

  it('does not roll the date forward across the IST boundary', () => {
    // 2026-10-01T00:00 IST is 2026-09-30T18:30 UTC. A naive UTC render would
    // show "30 Sep". The source-local value must stay 1 Oct.
    expect(formatForecastTimestamp('2026-10-01T00:00')).toContain('1 Oct');
  });

  it('keeps 23:00 on the same day it was published', () => {
    expect(formatForecastTimestamp('2026-10-01T23:00')).toContain('1 Oct');
  });

  it('renders each distinct hour distinctly', () => {
    const labels = ['2026-10-01T00:00', '2026-10-01T06:00', '2026-10-01T18:00'].map(
      formatForecastHourLabel
    );
    expect(new Set(labels).size).toBe(3);
  });
});

describe('date labels', () => {
  it('renders the source-local date', () => {
    expect(formatForecastDateLabel('2026-10-01T14:00')).toBe('1 Oct');
  });

  it('spans correctly across a month boundary', () => {
    expect(formatForecastDateLabel('2026-10-31T23:00')).toBe('31 Oct');
    expect(formatForecastDateLabel('2026-11-01T00:00')).toBe('1 Nov');
  });
});

describe('real instants', () => {
  it('renders a fetch timestamp pinned to Asia/Kolkata', () => {
    // 08:30 UTC is 14:00 IST.
    const out = formatInstantInSourceTimezone('2026-10-01T08:30:00.000Z');
    expect(out).toContain('14:00');
    expect(out).toContain('1 Oct');
  });

  it('returns the input unchanged for an unparseable instant', () => {
    expect(formatInstantInSourceTimezone('not-a-date')).toBe('not-a-date');
  });
});