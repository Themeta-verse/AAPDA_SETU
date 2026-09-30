import { describe, it, expect, vi } from 'vitest';
import {
  WARNING_PRODUCTS,
  probeWarningProduct,
  probeOfficialWarnings,
  summarizeOfficialWarnings,
  type ProbeResponseLike,
} from './officialWarnings';
import type { OfficialWarningStatus } from './types';

/**
 * Behavioral tests for the official-warning adapters.
 *
 * These reproduce the access constraints MEASURED against the live endpoints:
 *  - IMD sends `Access-Control-Allow-Origin: https://mausamstdby.imd.gov.in`
 *  - INCOIS sends no `Access-Control-Allow-Origin` at all
 *
 * The most important assertions are negative: a blocked source must yield
 * `active: null` (UNKNOWN), never `false`. Reporting "no official warning" when
 * we simply could not read the bulletin would be the worst failure this system
 * could produce.
 */

function fakeResponse(options: {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
}): ProbeResponseLike {
  const headers = options.headers ?? {};
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    header: (name: string) => {
      const key = Object.keys(headers).find((h) => h.toLowerCase() === name.toLowerCase());
      return key ? headers[key] : null;
    },
  };
}

/** The exact response observed from mausam.imd.gov.in. */
const imdResponse = () =>
  fakeResponse({
    status: 200,
    headers: {
      'content-type': 'text/html; charset=UTF-8',
      'access-control-allow-origin': 'https://mausamstdby.imd.gov.in',
    },
  });

/** The exact response observed from tsunami.incois.gov.in/TEWS/. */
const incoisResponse = () =>
  fakeResponse({
    status: 200,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
  });

const IM = {
  origin: 'https://localhost:8080',
} as Location;

beforeEach(() => {
  vi.unstubAllGlobals();
});

// =====================================================================
// ACCESS CLASSIFICATION
// =====================================================================

describe('IMD access constraint', () => {
  it('reports permission-denied-style unknown for the real observed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imdResponse()));

    const result = await probeWarningProduct(WARNING_PRODUCTS[0], {
      fetchImpl: globalThis.fetch,
    });

    expect(result.active).toBeNull();
    expect(result.blocker).toBe('cors-origin-restricted');
    expect(result.httpStatus).toBe(200);
    expect(result.contentType).toContain('text/html');
  });

  it('names the granted origin in the explanation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imdResponse()));
    const result = await probeWarningProduct(WARNING_PRODUCTS[0], {
      fetchImpl: globalThis.fetch,
    });

    expect(result.blockerDetail).toContain('mausamstdby.imd.gov.in');
  });

  it('documents the exact integration requirement', () => {
    const spec = WARNING_PRODUCTS.find((p) => p.productId === 'IMD_MARINE_FORECAST')!;
    // The requirement names the actual blocker: CORS, and the proxy needed.
    expect(spec.integrationRequirement).toMatch(/Access-Control-Allow-Origin/i);
    expect(spec.integrationRequirement).toContain('proxy');
    expect(spec.relevantToMumbai).toBe(true);
  });
});

describe('INCOIS access constraint', () => {
  it('reports cors-denied for the real observed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(incoisResponse()));

    const result = await probeWarningProduct(
      WARNING_PRODUCTS.find((p) => p.productId === 'INCOIS_TSUNAMI')!,
      { fetchImpl: globalThis.fetch }
    );

    expect(result.active).toBeNull();
    expect(result.blocker).toBe('cors-denied');
  });

it('never invents a headline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(incoisResponse()));
    const result = await probeWarningProduct(
      WARNING_PRODUCTS.find((p) => p.productId === 'INCOIS_TSUNAMI')!,
      { fetchImpl: globalThis.fetch }
    );

    expect(result.headline).toBeNull();
    expect(result.issuedAt).toBeNull();
    expect(result.affectedArea).toBeNull();
  });
});

// =====================================================================
// TRI-STATE BEHAVIOUR
// =====================================================================

describe('active flag is tri-state', () => {
  it('is null when the request fails entirely', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Failed to fetch'))
    );

    const result = await probeWarningProduct(WARNING_PRODUCTS[0], {
      fetchImpl: globalThis.fetch,
    });

    expect(result.active).toBeNull();
    expect(result.status).toBe('unavailable');
    expect(result.blockerDetail).toContain('UNKNOWN');
  });

  it('is null and status offline when the browser is offline', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const result = await probeWarningProduct(WARNING_PRODUCTS[0], {
      fetchImpl: globalThis.fetch,
      isOnline: () => false,
    });

    expect(result.active).toBeNull();
    expect(result.status).toBe('offline');
  });

  it('never returns false for any unreadable source', async () => {
    const responses = [
      imdResponse(),
      incoisResponse(),
      fakeResponse({ status: 500, headers: {} }),
      fakeResponse({ status: 404, headers: { 'content-type': 'application/json' } }),
    ];

    for (const response of responses) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      const result = await probeWarningProduct(WARNING_PRODUCTS[0], {
        fetchImpl: globalThis.fetch,
      });
      expect(result.active).toBeNull();
    }
  });

  it('detects a timeout abort', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'))
    );

    const result = await probeWarningProduct(WARNING_PRODUCTS[0], {
      fetchImpl: globalThis.fetch,
      timeoutMs: 1,
    });

    expect(result.active).toBeNull();
    expect(result.blockerDetail).toMatch(/abort|UNKNOWN/i);
  });

  it('reports no-machine-readable-feed when CORS allows but HTML is served', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          status: 200,
          headers: {
            'content-type': 'text/html',
            'access-control-allow-origin': '*',
          },
        })
      )
    );

    const result = await probeWarningProduct(WARNING_PRODUCTS[0], {
      fetchImpl: globalThis.fetch,
    });

    expect(result.blocker).toBe('no-machine-readable-feed');
    expect(result.active).toBeNull();
  });
});

// =====================================================================
// PROBING MANY PRODUCTS
// =====================================================================

describe('probeOfficialWarnings', () => {
  it('returns one status per product, in declared order', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(incoisResponse()));

    const results = await probeOfficialWarnings(WARNING_PRODUCTS, {
      fetchImpl: globalThis.fetch,
    });

    expect(results).toHaveLength(WARNING_PRODUCTS.length);
    expect(results.map((r) => r.productId)).toEqual(WARNING_PRODUCTS.map((p) => p.productId));
  });

  it('isolates a failing product so others still report', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(incoisResponse())
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(incoisResponse())
        .mockResolvedValueOnce(incoisResponse())
    );

    const results = await probeOfficialWarnings(WARNING_PRODUCTS, {
      fetchImpl: globalThis.fetch,
    });

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.active === null)).toBe(true);
  });
});

// =====================================================================
// SUMMARY LOGIC
// =====================================================================

function status(overrides: Partial<OfficialWarningStatus>): OfficialWarningStatus {
  return {
    authority: 'IMD',
    productId: 'IMD_MARINE_FORECAST',
    label: 'IMD Marine Forecast',
    url: 'https://mausam.imd.gov.in/responsive/marine_forecast.php',
    active: null,
    issuedAt: null,
    validFrom: null,
    validUntil: null,
    headline: null,
    affectedArea: null,
    retrievedAt: '2026-09-30T12:00:00Z',
    status: 'unavailable',
    blocker: 'cors-denied',
    blockerDetail: null,
    httpStatus: 200,
    contentType: 'text/html',
    ...overrides,
  };
}

describe('summarizeOfficialWarnings', () => {
  it('is unknown when every product is unreadable', () => {
    const summary = summarizeOfficialWarnings([
      status({}),
      status({ productId: 'INCOIS_TSUNAMI', authority: 'INCOIS' }),
    ]);
    expect(summary.active).toBeNull();
  });

  it('is true when any product is positively active', () => {
    const summary = summarizeOfficialWarnings([
      status({ active: true, authority: 'INCOIS', productId: 'INCOIS_TSUNAMI' }),
      status({}),
    ]);
    expect(summary.active).toBe(true);
    expect(summary.authority).toBe('INCOIS');
  });

  it('is false only when EVERY product was readable and clear', () => {
    const summary = summarizeOfficialWarnings([
      status({ active: false, blocker: null }),
      status({ active: false, blocker: null, productId: 'INCOIS_TSUNAMI', authority: 'INCOIS' }),
    ]);
    expect(summary.active).toBe(false);
  });

  it('is unknown when even ONE product is unreadable, even if others are clear', () => {
    // This is the conservative rule that prevents a false all-clear.
    const summary = summarizeOfficialWarnings([
      status({ active: false, blocker: null }),
      status({ active: null, productId: 'INCOIS_TSUNAMI', authority: 'INCOIS' }),
    ]);
    expect(summary.active).toBeNull();
  });

  it('is unknown for an empty product set', () => {
    expect(summarizeOfficialWarnings([]).active).toBeNull();
  });
});
