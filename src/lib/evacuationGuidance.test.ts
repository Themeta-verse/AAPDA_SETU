import { describe, it, expect } from 'vitest';
import { evacuationGuidanceFor } from './evacuationGuidance';
import type { CoastalRiskAssessment } from '@/risk/engine';

/**
 * The evacuation panel may only recommend movement for documented reasons.
 * These tests lock the deterministic rule: which observed facts produce
 * "evacuate", and that nothing else does. An invented trigger here would send
 * real people onto real roads.
 */

function assessment(overrides: Partial<CoastalRiskAssessment> = {}): CoastalRiskAssessment {
  return {
    state: 'nominal',
    officialWarningActive: false,
    tsunamiStatus: false,
    tsunamiAuthoritative: true,
    evaluatedAt: '2026-10-01T12:00:00.000Z',
    quality: {
      state: 'CURRENT',
      assessment: 'GOOD',
      reasons: [],
      sourceStatus: 'live',
      ageMs: 1000,
      rejectedRecords: 0,
      missingFields: [],
    },
    dimensions: {},
    ...overrides,
  } as CoastalRiskAssessment;
}

describe('evacuation guidance rule', () => {
  it('recommends evacuation on a severe state and names the trigger', () => {
    const g = evacuationGuidanceFor(assessment({ state: 'severe' }));
    expect(g.mode).toBe('evacuate');
    expect(g.triggers.join(' ')).toContain('severe');
  });

  it('recommends evacuation on a high state', () => {
    expect(evacuationGuidanceFor(assessment({ state: 'high' })).mode).toBe('evacuate');
  });

  it('recommends evacuation on an active official warning even when the model state is nominal', () => {
    const g = evacuationGuidanceFor(
      assessment({ state: 'nominal', officialWarningActive: true })
    );
    expect(g.mode).toBe('evacuate');
    expect(g.triggers.join(' ')).toContain('official');
  });

  it('recommends evacuation on an authoritative tsunami flag', () => {
    const g = evacuationGuidanceFor(
      assessment({ state: 'nominal', tsunamiStatus: true, tsunamiAuthoritative: true })
    );
    expect(g.mode).toBe('evacuate');
    expect(g.triggers.join(' ')).toContain('tsunami');
  });

  it('does NOT treat a non-authoritative tsunami value as a trigger', () => {
    const g = evacuationGuidanceFor(
      assessment({ state: 'nominal', tsunamiStatus: true, tsunamiAuthoritative: false })
    );
    expect(g.mode).toBe('normal');
  });

  it('says prepare on elevated/watch without evacuating', () => {
    expect(evacuationGuidanceFor(assessment({ state: 'elevated' })).mode).toBe('prepare');
    expect(evacuationGuidanceFor(assessment({ state: 'watch' })).mode).toBe('prepare');
  });

  it('is normal when nominal with no active warning', () => {
    expect(evacuationGuidanceFor(assessment()).mode).toBe('normal');
  });

  it('is unknown when the state is unknown — never silently safe', () => {
    const g = evacuationGuidanceFor(
      assessment({ state: 'unknown', officialWarningActive: null })
    );
    expect(g.mode).toBe('unknown');
    expect(g.detail).toContain('not');
  });

  it('is unknown when warnings are unreadable on a nominal state — not normal', () => {
    const g = evacuationGuidanceFor(
      assessment({ state: 'nominal', officialWarningActive: null })
    );
    expect(g.mode).toBe('unknown');
  });

  it('offers navigation only when there is no assessment at all', () => {
    const g = evacuationGuidanceFor(null);
    expect(g.mode).toBe('unavailable');
    expect(g.triggers).toEqual([]);
  });
});
