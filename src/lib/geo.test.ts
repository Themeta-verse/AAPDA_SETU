/**
 * Geodesic helpers.
 *
 * These are checked against known values rather than against themselves, so a
 * sign error or a swapped argument cannot pass unnoticed.
 */

import { describe, it, expect } from 'vitest';
import {
  isValidCoordinate,
  distanceMetres,
  initialBearing,
  compassPoint,
  formatDistance,
  formatDuration,
  formatCoordinate,
  describeAccuracy,
} from './geo';

const JUHU = { latitude: 19.0988, longitude: 72.8267 };
/** Cooper Hospital, a real nearby landmark. */
const COOPER = { latitude: 19.076, longitude: 72.841 };

describe('isValidCoordinate', () => {
  it('accepts a real coordinate', () => {
    expect(isValidCoordinate(JUHU)).toBe(true);
  });

  it('rejects absent, partial and non-finite values', () => {
    expect(isValidCoordinate(null)).toBe(false);
    expect(isValidCoordinate(undefined)).toBe(false);
    expect(isValidCoordinate({})).toBe(false);
    expect(isValidCoordinate({ latitude: 19.0988 })).toBe(false);
    expect(isValidCoordinate({ latitude: NaN, longitude: 72.8 })).toBe(false);
    expect(isValidCoordinate({ latitude: 19, longitude: Infinity })).toBe(false);
  });

  it('rejects out-of-range values rather than clamping them silently', () => {
    expect(isValidCoordinate({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: 0, longitude: 181 })).toBe(false);
  });
});

describe('distanceMetres', () => {
  it('is zero for a point against itself', () => {
    expect(distanceMetres(JUHU, JUHU)).toBe(0);
  });

  it('matches a known real distance', () => {
    // Juhu Beach to Cooper Hospital is roughly 3.2 km as the crow flies.
    const metres = distanceMetres(JUHU, COOPER)!;
    expect(metres).toBeGreaterThan(2800);
    expect(metres).toBeLessThan(3600);
  });

  it('is symmetric', () => {
    expect(distanceMetres(JUHU, COOPER)).toBeCloseTo(distanceMetres(COOPER, JUHU)!, 6);
  });

  it('returns null rather than NaN for an unusable input', () => {
    // NaN would render as a plausible-looking but meaningless number.
    expect(distanceMetres(JUHU, { latitude: NaN, longitude: 0 })).toBeNull();
    expect(distanceMetres(null as never, COOPER)).toBeNull();
  });

  it('measures a degree of latitude at roughly 111 km', () => {
    const metres = distanceMetres({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })!;
    expect(metres).toBeGreaterThan(110000);
    expect(metres).toBeLessThan(112000);
  });
});

describe('initialBearing', () => {
  it('is due north for a point directly north', () => {
    const bearing = initialBearing({ latitude: 19, longitude: 72.8 }, { latitude: 20, longitude: 72.8 })!;
    expect(bearing).toBeCloseTo(0, 3);
  });

  it('is due east for a point directly east at the equator', () => {
    const bearing = initialBearing({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })!;
    expect(bearing).toBeCloseTo(90, 3);
  });

  it('is due south for a point directly south', () => {
    const bearing = initialBearing({ latitude: 20, longitude: 72.8 }, { latitude: 19, longitude: 72.8 })!;
    expect(bearing).toBeCloseTo(180, 3);
  });

  it('is null for coincident points, where bearing is undefined', () => {
    // Zero would be a fabricated direction.
    expect(initialBearing(JUHU, JUHU)).toBeNull();
  });

  it('returns null for an unusable input', () => {
    expect(initialBearing(JUHU, { latitude: NaN, longitude: 0 })).toBeNull();
  });

  it('points roughly south-east from Juhu to Cooper Hospital', () => {
    const bearing = initialBearing(JUHU, COOPER)!;
    expect(bearing).toBeGreaterThan(90);
    expect(bearing).toBeLessThan(180);
  });
});

describe('compassPoint', () => {
  it('maps cardinal bearings', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(270)).toBe('W');
  });

  it('wraps around 360', () => {
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(360)).toBe('N');
  });

  it('is null for a null bearing rather than defaulting to north', () => {
    expect(compassPoint(null)).toBeNull();
  });
});

describe('formatting helpers', () => {
  it('scales the distance unit to the magnitude', () => {
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(24500)).toBe('25 km');
  });

  it('is null for an absent or negative distance', () => {
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(-5)).toBeNull();
    expect(formatDistance(NaN)).toBeNull();
  });

  it('scales the duration to the magnitude', () => {
    expect(formatDuration(20)).toBe('< 1 min');
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(5400)).toBe('1 h 30 min');
  });

  it('is null for an absent duration rather than saying zero', () => {
    expect(formatDuration(null)).toBeNull();
  });

  it('formats coordinates at the requested precision', () => {
    expect(formatCoordinate(JUHU, 4)).toBe('19.0988, 72.8267');
  });

  it('never formats an invalid coordinate', () => {
    expect(formatCoordinate(null)).toBeNull();
    expect(formatCoordinate({ latitude: NaN, longitude: 0 })).toBeNull();
  });
});

describe('describeAccuracy', () => {
  it('distinguishes a precise fix from a poor one in words', () => {
    // A 5 m fix and a 2 km fix are not the same claim.
    expect(describeAccuracy(5)).toMatch(/Precise/);
    expect(describeAccuracy(2000)).toMatch(/Poor/);
    expect(describeAccuracy(2000)).toMatch(/2 km/);
  });

  it('is null when accuracy was not reported', () => {
    expect(describeAccuracy(null)).toBeNull();
  });
});
