/**
 * Server-side official warning retrieval.
 *
 * Reads IMD and INCOIS through the `official-warnings` Edge Function instead of
 * from the browser, because those hosts send no CORS headers and a browser can
 * never read them.
 *
 * HONESTY CONTRACT
 * ----------------
 * This adapter's central job is to keep "no warning exists" and "we could not
 * read the source" apart.
 *
 *   active === true   a published, parsed warning was confirmed
 *   active === false  every product was readable AND clear
 *   active === null   unknown — at least one product could not be read
 *
 * `summarizeOfficialWarnings` in `src/lib/officialWarnings.ts` enforces that on
 * top of these results, so a partial outage can never render as an all-clear.
 *
 * A failure of this function itself (not deployed, offline, 401) is also
 * reported as `null` rather than being allowed to look like a clean bill of
 * health.
 */

import type { OfficialWarningProduct } from '@/lib/officialWarnings';

/** Mirrors the shape returned by supabase/functions/official-warnings/index.ts. */
interface OfficialWarningsResponse {
  retrievedAt: string;
  note: string;
  products: OfficialWarningProduct[];
}

export interface OfficialWarningLookup {
  products: OfficialWarningProduct[];
  retrievedAt: string;
  /** `complete` | `partial` | `unreachable` | `degraded` */
  outcome: 'complete' | 'partial' | 'unreachable' | 'degraded';
  /** True when the request never reached the function. */
  unreachable: boolean;
  detail: string;
}

const UNREACHABLE: OfficialWarningLookup = {
  products: [],
  retrievedAt: new Date().toISOString(),
  outcome: 'unreachable',
  unreachable: true,
  detail:
    'The server-side warning retriever could not be reached, so IMD and INCOIS status is ' +
    'UNKNOWN. This is not an all-clear.',
};

/**
 * Fetch official warnings through the Edge Function.
 *
 * Requires an authenticated Supabase session: the function is JWT-gated, and the
 * caller's access token is what lets the gateway attribute the request.
 */
export async function fetchOfficialWarnings(
  supabase: {
    functions: {
      invoke: (
        fn: string,
        opts?: { body?: unknown },
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  },
  options: { timeoutMs?: number } = {},
): Promise<OfficialWarningLookup> {
  const { timeoutMs = 30000 } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { data, error } = await supabase.functions.invoke('official-warnings', {
      body: {},
    });

    if (error) {
      return {
        ...UNREACHABLE,
        retrievedAt: new Date().toISOString(),
        detail: `The server-side warning retriever returned an error (${error.message}). IMD and ` +
          'INCOIS status is UNKNOWN. This is not an all-clear.',
      };
    }

    const payload = data as Partial<OfficialWarningsResponse> | null;
    const products = Array.isArray(payload?.products) ? payload.products : [];

    if (products.length === 0) {
      return {
        ...UNREACHABLE,
        retrievedAt: payload?.retrievedAt ?? new Date().toISOString(),
        detail:
          'The server-side warning retriever responded without any products, so IMD and INCOIS ' +
          'status is UNKNOWN. This is not an all-clear.',
      };
    }

    // The function is designed so that `active` is always null today: it never
    // synthesises a warning. `complete` therefore means "every product was
    // fetched and inspected, and each one is explicitly still blocked", which
    // keeps the UI honest instead of silently degrading to an empty list.
    const readable = products.filter((p) => p.status === 'live').length;

    return {
      products,
      retrievedAt: payload?.retrievedAt ?? new Date().toISOString(),
      outcome: readable === products.length ? 'complete' : 'partial',
      unreachable: false,
      detail:
        readable === products.length
          ? 'All official warning sources were fetched and inspected. None currently exposes a ' +
            'parseable bulletin, so their status is UNKNOWN rather than clear.'
          : `${products.length - readable} of ${products.length} official warning sources could ` +
            'not be read, so their status is UNKNOWN rather than clear.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...UNREACHABLE,
      retrievedAt: new Date().toISOString(),
      detail:
        `The server-side warning retriever threw while contacting IMD and INCOIS (${message}). ` +
        'Their status is UNKNOWN. This is not an all-clear.',
    };
  } finally {
    clearTimeout(timer);
  }
}
