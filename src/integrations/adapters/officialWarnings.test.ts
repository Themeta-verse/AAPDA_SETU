/**
 * Server-side official warning retrieval.
 *
 * These tests cover the adapter's handling of the Edge Function boundary — not
 * the tri-state algebra itself, which is covered in
 * `src/lib/officialWarnings.test.ts`.
 *
 * The behaviour worth pinning here is that NO failure of this function can be
 * mistaken for good news. Every error path here must produce UNKNOWN.
 */

import { describe, it, expect, vi } from 'vitest';
import { fetchOfficialWarnings } from './officialWarnings';

function product(overrides: Record<string, unknown> = {}) {
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
    status: 'unavailable',
    blocker: 'no-bulletin-content',
    blockerDetail: 'navigation content only',
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

function client(response: unknown, error: { message: string } | null = null) {
  return {
    functions: { invoke: vi.fn().mockResolvedValue({ data: response, error }) },
  };
}

describe('successful retrieval', () => {
  it('returns the products the function reported', async () => {
    const c = client({ retrievedAt: '2026-09-30T12:00:00.000Z', products: [product()] });
    const lookup = await fetchOfficialWarnings(c);

    expect(lookup.products).toHaveLength(1);
    expect(lookup.products[0].blocker).toBe('no-bulletin-content');
    expect(lookup.unreachable).toBe(false);
    expect(lookup.outcome).toBe('partial');
  });

  it('is partial, not complete, while no bulletin is parseable', async () => {
    // The HTTP exchange succeeded but nothing was readable, so this must not be
    // reported as a completed check.
    const c = client({ retrievedAt: '2026-09-30T12:00:00.000Z', products: [product()] });
    const lookup = await fetchOfficialWarnings(c);
    expect(lookup.outcome).not.toBe('complete');
  });

  it('preserves the evidence the function attached', async () => {
    const c = client({
      retrievedAt: '2026-09-30T12:00:00.000Z',
      products: [product()],
    });
    const lookup = await fetchOfficialWarnings(c);
    expect(lookup.products[0].diagnostics.looksLikeNavigationOnly).toBe(true);
    expect(lookup.products[0].httpStatus).toBe(200);
  });
});

describe('failures are never mistaken for an all-clear', () => {
  it('is unreachable when the function returns an error', async () => {
    const c = client(null, { message: 'Function not found' });
    const lookup = await fetchOfficialWarnings(c);

    expect(lookup.unreachable).toBe(true);
    expect(lookup.outcome).toBe('unreachable');
    expect(lookup.products).toHaveLength(0);
  });

  it('says explicitly that unreachable is not an all-clear', async () => {
    const c = client(null, { message: 'Function not found' });
    const lookup = await fetchOfficialWarnings(c);
    expect(lookup.detail).toContain('UNKNOWN');
    expect(lookup.detail).toContain('not an all-clear');
  });

  it('is unreachable when the function throws', async () => {
    const c = {
      functions: { invoke: vi.fn().mockRejectedValue(new Error('network down')) },
    };
    const lookup = await fetchOfficialWarnings(c);
    expect(lookup.unreachable).toBe(true);
    expect(lookup.detail).toContain('network down');
  });

  it('is unreachable when the response carries no products', async () => {
    // An empty array must not be read as "zero warnings active".
    const c = client({ retrievedAt: '2026-09-30T12:00:00.000Z', products: [] });
    const lookup = await fetchOfficialWarnings(c);

    expect(lookup.unreachable).toBe(true);
    expect(lookup.detail).toContain('UNKNOWN');
  });

  it('is unreachable when the response shape is not usable', async () => {
    const c = client({ unexpected: true });
    const lookup = await fetchOfficialWarnings(c);
    expect(lookup.unreachable).toBe(true);
  });

  it('never reports UNKNOWN as a live source', async () => {
    const c = client(null, { message: 'JWT expired' });
    const lookup = await fetchOfficialWarnings(c);
    // The caller derives source status from `unreachable`; it must not be able
    // to mistake this for a successful read.
    expect(lookup.outcome).toBe('unreachable');
  });
});
