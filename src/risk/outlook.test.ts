/**
 * Derived 48-hour outlook.
 *
 * The property that matters most: the outlook must be exactly as uncertain as
 * the forecast hours behind it. An outlook built from nothing has to read as
 * unknown, because "no forecast yet" and "calm for two days" are completely
 * different things to tell someone on a coast.
 */

import { describe, it, expect } from 'vitest';
import { buildOutlook, describeOutlook, type OutlookHour } from './outlook';

const NONE = {
  waveHeightM: null,
  swellHeightM: null,
  wavePeriodS: null,
  windSpeedKmh: null,
  windGustKmh: null,
  precipitationMm: null,
  precipitationProbabilityPct: null,
  visibilityM: null,
};

/**
 * One forecast hour.
 *
 * `wavePeriodS` defaults to null so that a "no data" hour is genuinely empty.
 * Defaulting it to a plausible value would leave a rule-readable input behind
 * and quietly turn a data-gap test into a nominal-conditions test.
 */
function hour(at: string, waveHeightM: number | null, wavePeriodS: number | null = null): OutlookHour {
  return { at, values: { ...NONE, waveHeightM, wavePeriodS } };
}

/** Build a run of hourly timestamps. */
function series(startHour: number, count: number, wave: (i: number) => number | null): OutlookHour[] {
  return Array.from({ length: count }, (_, i) =>
    hour(new Date(Date.UTC(2026, 9, 1, startHour + i)).toISOString(), wave(i)),
  );
}

describe('buildOutlook with no usable data', () => {
  it('is unknown for an empty horizon, not nominal', () => {
    // The single most important case: silence must never read as calm.
    const outlook = buildOutlook([]);
    expect(outlook.peakState).toBeNull();
    expect(outlook.trend).toBe('unknown');
    expect(outlook.coverage).toBe('none');
    expect(outlook.hoursAssessed).toBe(0);
  });

  it('says conditions are unknown rather than calm', () => {
    expect(describeOutlook(buildOutlook([]))).toMatch(/unknown/i);
    expect(describeOutlook(buildOutlook([]))).not.toMatch(/calm|safe|steady/i);
  });

  it('is unknown when hours exist but carry no value any rule reads', () => {
    const outlook = buildOutlook(series(0, 48, () => null));
    expect(outlook.coverage).toBe('none');
    expect(outlook.peakState).toBeNull();
    expect(outlook.coverageNote).toMatch(/not calm/i);
  });
});

describe('peak and trend', () => {
  it('reports the worst hour as the peak', () => {
    const outlook = buildOutlook(series(0, 12, (i) => (i === 7 ? 3.8 : 1.0)));
    expect(outlook.peakState).toBe('high');
    expect(outlook.peakAt).toBe(new Date(Date.UTC(2026, 9, 1, 7)).toISOString());
  });

  it('detects a worsening trend from a rising sequence', () => {
    const outlook = buildOutlook(series(0, 12, (i) => (i < 6 ? 1.0 : 3.5)));
    expect(outlook.trend).toBe('worsening');
  });

  it('detects an improving trend from a falling sequence', () => {
    const outlook = buildOutlook(series(0, 12, (i) => (i < 6 ? 3.5 : 1.0)));
    expect(outlook.trend).toBe('improving');
  });

  it('calls a flat series steady rather than inventing movement', () => {
    const outlook = buildOutlook(series(0, 12, () => 1.0));
    expect(outlook.trend).toBe('stable');
  });

  it('is trend-unknown for too few hours to compare', () => {
    // Two points cannot establish a direction.
    expect(buildOutlook(series(0, 2, () => 1.0)).trend).toBe('unknown');
  });
});

describe('windows', () => {
  it('groups consecutive elevated hours into one window', () => {
    const outlook = buildOutlook(series(0, 12, (i) => (i >= 4 && i <= 6 ? 3.2 : 1.0)));
    const window = outlook.windows.find((w) => w.hours === 3);
    expect(window).toBeDefined();
    expect(window!.state).toBe('elevated');
  });

  it('breaks a run across a data gap rather than bridging it', () => {
    // A missing hour must not silently extend an elevated window across the gap.
    const hours = [
      ...series(0, 3, () => 3.2),
      ...series(3, 1, () => null),
      ...series(4, 3, () => 3.2),
    ];
    const outlook = buildOutlook(hours);
    const threeHourWindows = outlook.windows.filter((w) => w.hours === 3);
    expect(threeHourWindows).toHaveLength(2);
  });

  it('reports no windows when nothing crosses the threshold', () => {
    const outlook = buildOutlook(series(0, 24, () => 0.8));
    expect(outlook.windows).toHaveLength(0);
    expect(describeOutlook(outlook)).toMatch(/No hour in the horizon crosses/);
  });

  it('lists the worst window first', () => {
    const outlook = buildOutlook(
      series(0, 12, (i) => (i < 3 ? 3.2 : i < 6 ? 3.9 : 1.0)),
    );
    expect(outlook.windows[0].state).toBe('high');
  });

  it('explains the peak with the values and rules that produced it', () => {
    // The projection must be auditable, not merely asserted.
    const outlook = buildOutlook(series(0, 6, (i) => (i === 2 ? 4.0 : 1.0)));
    const worst = outlook.windows[0];
    expect(worst.basis).not.toBeNull();
    expect(worst.basis!.values.waveHeightM).toBe(4.0);
    expect(worst.basis!.ruleIds.length).toBeGreaterThan(0);
  });

  it('names the rule that actually drove the peak, not merely any value present', () => {
    // A wave height can be present on an hour whose real trigger is a
    // visibility or wind rule. Attributing the peak to the wave would be a false
    // explanation of the cause.
    const hours: OutlookHour[] = [
      {
        at: '2026-09-30T18:00:00.000Z',
        // Waves are tiny; visibility is the real trigger (rule fires <= 1000 m).
        values: { ...NONE, waveHeightM: 0.56, visibilityM: 800 },
      },
    ];
    const outlook = buildOutlook(hours);
    const basis = outlook.windows[0]?.basis;
    expect(basis).toBeDefined();
    expect(basis!.triggers.length).toBeGreaterThan(0);
    // Whatever fired, it must not be a wave rule when waves are tiny.
    for (const trigger of basis!.triggers) {
      expect(trigger.ruleId).not.toMatch(/WAVE/);
      expect(trigger.observed.length).toBeGreaterThan(0);
    }
    expect(basis!.triggers.map((t) => t.ruleId)).toContain('WEATHER.VISIBILITY.LOW');
  });
});

describe('coverage honesty', () => {
  it('reports complete coverage when most of the horizon has data', () => {
    const outlook = buildOutlook(series(0, 48, () => 1.0), 48);
    expect(outlook.coverage).toBe('complete');
    expect(outlook.hoursAssessed).toBe(48);
  });

  it('reports partial coverage and names the shortfall', () => {
    const outlook = buildOutlook(series(0, 6, () => 1.0), 48);
    expect(outlook.coverage).toBe('partial');
    expect(outlook.coverageNote).toMatch(/6 of 48/);
  });

  it('counts only hours a rule could actually read', () => {
    const outlook = buildOutlook(series(0, 12, (i) => (i % 2 === 0 ? 1.0 : null)), 48);
    expect(outlook.hoursAssessed).toBe(6);
  });
});

describe('limitations are always stated', () => {
  it('disclaims machine learning and forecast-error growth', () => {
    const outlook = buildOutlook(series(0, 12, () => 1.0));
    expect(outlook.limitations.join(' ')).toMatch(/not a machine-learning prediction/i);
    expect(outlook.limitations.join(' ')).toMatch(/lead time/i);
  });

  it('is present even when there is no data at all', () => {
    expect(buildOutlook([]).limitations.length).toBeGreaterThan(0);
  });
});

describe('severe is unreachable from a forecast hour', () => {
  it('never projects severe however extreme the model values are', () => {
    // `severe` is reserved for an official authority or a confirmed tsunami
    // flag, neither of which is a per-hour model output.
    const outlook = buildOutlook(series(0, 12, () => 12));
    expect(outlook.peakState).not.toBe('severe');
  });
});
