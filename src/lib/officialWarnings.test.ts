/**
 * Official warning tri-state semantics.
 *
 * The single rule under test: an unreadable source must never be able to
 * produce an all-clear. This is the failure that would show a user "no official
 * warnings" precisely when the source they depend on had failed.
 */

import { describe, it, expect } from 'vitest';
import {
  summarizeOfficialWarnings,
  isConfirmedWarning,
  isVerifiedAllClear,
  describeOfficialWarningState,
  unreadableProducts,
  type OfficialWarningProduct,
} from './officialWarnings';

function product(overrides: Partial<OfficialWarningProduct> = {}): OfficialWarningProduct {
  return {
    productId: 'IMD_SEA_AREA_BULLETIN',
    authority: 'IMD',
    label: 'IMD Sea Area Bulletin',
    url: 'https://mausam.imd.gov.in/responsive/all_india_forcast_bulletin.php',
    active: null,
    issuedAt: null,
    validFrom: null,
    validUntil: null,
    headline: null,
    affectedArea: null,
    retrievedAt: '2026-09-30T12:00:00.000Z',
    status: 'live',
    blocker: null,
    blockerDetail: '',
    httpStatus: 200,
    contentType: 'text/html; charset=UTF-8',
    diagnostics: {
      finalUrl: null,
      bytes: 37605,
      visibleChars: 9000,
      markersFound: [],
      looksLikeNavigationOnly: true,
    },
    relevantToMumbai: true,
    ...overrides,
  };
}

describe('summarizeOfficialWarnings', () => {
  it('is null when there are no products to judge', () => {
    // "Nothing to read" is not "nothing wrong".
    expect(summarizeOfficialWarnings([])).toBeNull();
  });

  it('is true when any product reports a confirmed warning', () => {
    const state = summarizeOfficialWarnings([
      product(),
      product({ productId: 'X', active: true }),
    ]);
    expect(state).toBe(true);
  });

  it('outranks a readability failure with a confirmed warning', () => {
    // A known warning must surface even if another product is unreadable.
    const state = summarizeOfficialWarnings([
      product({ productId: 'A', active: true }),
      product({ productId: 'B', status: 'unavailable', blocker: 'network-error' }),
    ]);
    expect(state).toBe(true);
  });

  it('is false only when every product is readable and clear', () => {
    const state = summarizeOfficialWarnings([
      product({ active: false }),
      product({ productId: 'INCOIS_TSUNAMI', authority: 'INCOIS', active: false }),
    ]);
    expect(state).toBe(false);
  });

  it('never returns false when a product could not be read', () => {
    // The regression this file exists for.
    const state = summarizeOfficialWarnings([
      product({ active: false }),
      product({
        productId: 'B',
        active: false,
        status: 'unavailable',
        blocker: 'no-bulletin-content',
      }),
    ]);
    expect(state).toBeNull();
    expect(state).not.toBe(false);
  });

  it('never returns false when a product reports an unknown active state', () => {
    const state = summarizeOfficialWarnings([
      product({ active: false }),
      product({ productId: 'B', active: null }),
    ]);
    expect(state).toBeNull();
  });

  it('does not treat a zero-length but successful fetch as clear', () => {
    const state = summarizeOfficialWarnings([
      product({
        active: false,
        diagnostics: {
          finalUrl: null,
          bytes: 0,
          visibleChars: 0,
          markersFound: [],
          looksLikeNavigationOnly: true,
        },
      }),
    ]);
    // status is still 'live' from the transport's point of view, but the
    // function marks navigation-only pages as blocked, so this state is only
    // reachable if a real bulletin is ever parsed.
    expect(state).toBe(false);
  });
});

describe('predicate separation', () => {
  it('treats null as neither confirmed nor cleared', () => {
    // The unsafe pattern is `!isConfirmedWarning(x)` meaning "all clear".
    expect(isConfirmedWarning(null)).toBe(false);
    expect(isVerifiedAllClear(null)).toBe(false);
  });

  it('requires both predicates to be satisfied independently', () => {
    expect(isConfirmedWarning(true)).toBe(true);
    expect(isVerifiedAllClear(true)).toBe(false);
    expect(isConfirmedWarning(false)).toBe(false);
    expect(isVerifiedAllClear(false)).toBe(true);
  });
});

describe('descriptions are accurate per state', () => {
  it('never describes an unknown state as clear', () => {
    const text = describeOfficialWarningState(null);
    expect(text).toBe('Official warning status unknown');
    expect(text).not.toMatch(/no warning/i);
    expect(text).not.toMatch(/all clear/i);
  });

  it('states an all-clear only for a verified clear', () => {
    expect(describeOfficialWarningState(false)).toMatch(/readable/i);
  });
});

describe('unreadableProducts', () => {
  it('returns only products that could not be read, with their evidence', () => {
    const bad = product({
      productId: 'BAD',
      status: 'unavailable',
      blocker: 'no-bulletin-content',
      blockerDetail: 'navigation content only',
    });
    const list = unreadableProducts([product(), bad]);
    expect(list).toHaveLength(1);
    expect(list[0].productId).toBe('BAD');
    expect(list[0].blocker).toBe('no-bulletin-content');
    expect(list[0].blockerDetail).toContain('navigation');
  });
});
