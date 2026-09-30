/**
 * Official warning adapters for IMD and INCOIS.
 *
 * ===================================================================
 * WHY THIS MODULE MOSTLY REPORTS "UNKNOWN"
 * ===================================================================
 *
 * Both authorities were probed directly before this file was written. Findings,
 * measured (not assumed):
 *
 *  IMD — https://mausam.imd.gov.in/responsive/marine_forecast.php
 *    HTTP/2 200, Content-Type: text/html; charset=UTF-8
 *    Access-Control-Allow-Origin: https://mausamstdby.imd.gov.in
 *    -> Reachable, but CORS is granted ONLY to a single IMD standby origin.
 *       A browser application served from any other origin cannot read the
 *       body. The page is also server-rendered navigation chrome: the bulletin
 *       text is not present in a machine-readable form.
 *
 *  INCOIS — https://tsunami.incois.gov.in/TEWS/
 *    HTTP/2 200, Content-Type: text/html; charset=UTF-8
 *    Access-Control-Allow-Origin: (absent)
 *    -> The root redirects (meta refresh) to /site/index.jsp; the tsunami
 *       product redirects to /TEWS/, which returns a 2019-dated jQuery shell
 *       with no embedded data payload and no CORS header. There is no public
 *       JSON, XML or plain-text bulletin reachable from a browser.
 *
 * CONSEQUENCE, stated plainly: this application cannot read IMD or INCOIS
 * bulletins. Rather than fabricate warning text, this adapter performs a REAL
 * probe of the documented endpoint on every call and reports the ACTUAL
 * outcome. When the probe cannot establish whether a warning is active, the
 * result is `active: null` — UNKNOWN — never `false`.
 *
 * This distinction is the whole point of the module. A user who sees
 * "No official warning" must be able to trust that we actually checked. If we
 * display "unknown" instead, that is the system being honest about the gap.
 *
 * DESIGN NOTE: `probeOfficialWarnings` is deliberately dependency-injected so
 * tests can simulate CORS-restricted, network-failed and HTML-only responses
 * without network access, and so a future backend proxy can be swapped in
 * without touching the risk engine.
 */

import type {
  OfficialWarningAuthority,
  OfficialWarningStatus,
  SourceStatus,
  WarningAccessBlocker,
} from './types';

/**
 * Products we attempt, with the exact URLs verified by probe.
 *
 * `seaAreaRelevantToMumbai` documents whether the product's stated geographic
 * scope includes the Mumbai coast. This is metadata about the PRODUCT, taken
 * from the authority's own naming and known coverage — it is NOT a claim that
 * we have read a current bulletin.
 */
export interface WarningProductSpec {
  productId: string;
  authority: OfficialWarningAuthority;
  label: string;
  url: string;
  /** Null when we cannot establish scope without reading the bulletin. */
  expectedScope: string | null;
  /** False when we know the product does not cover the Mumbai coast. */
  relevantToMumbai: boolean;
  /** What we would do if this source were reachable. Documented, not faked. */
  integrationRequirement: string;
}

export const WARNING_PRODUCTS: readonly WarningProductSpec[] = [
  {
    productId: 'IMD_MARINE_FORECAST',
    authority: 'IMD',
    label: 'IMD Marine Forecast (fishermen warnings)',
    url: 'https://mausam.imd.gov.in/responsive/marine_forecast.php',
    // The page lists "North Maharashtra Coast, South Maharashtra coast, Goa
    // coast" among its covered areas, so this product is in scope for Mumbai.
    expectedScope: 'Includes North Maharashtra Coast, which covers the Mumbai coast',
    relevantToMumbai: true,
    integrationRequirement:
      'Requires a server-side proxy. IMD serves this page with ' +
      "Access-Control-Allow-Origin: https://mausamstdby.imd.gov.in only, so a browser " +
      'application cannot read it directly. A Supabase Edge Function holding the fetch ' +
      'would be required, and the bulletin text would need to be parsed out of the ' +
      'server-rendered HTML.',
  },
  {
    productId: 'IMD_SEA_AREA_BULLETIN',
    authority: 'IMD',
    label: 'IMD Sea Area Bulletin',
    url: 'https://mausam.imd.gov.in/responsive/all_india_forcast_bulletin.php',
    expectedScope: 'Arabian Sea sea areas, which include the waters off Mumbai',
    relevantToMumbai: true,
    integrationRequirement:
      'Requires a server-side proxy for the same CORS reason as IMD_MARINE_FORECAST. ' +
      'The page returns HTML navigation chrome rather than a structured bulletin.',
  },
  {
    productId: 'INCOIS_TSUNAMI',
    authority: 'INCOIS',
    label: 'INCOIS Tsunami Early Warning System',
    url: 'https://tsunami.incois.gov.in/TEWS/',
    expectedScope: 'Indian Ocean basin',
    relevantToMumbai: true,
    integrationRequirement:
      'Requires a server-side proxy. The endpoint returns no Access-Control-Allow-Origin ' +
      'header and serves a 2019-dated jQuery shell rather than a data payload. A ' +
      'backend poller would also need to locate the underlying bulletin resource, ' +
      'which is not advertised in the page markup.',
  },
  {
    productId: 'INCOIS_OCEAN_STATE',
    authority: 'INCOIS',
    label: 'INCOIS Ocean State Forecast',
    url: 'https://www.incois.gov.in/site/index.jsp',
    expectedScope: 'Indian Ocean coastal waters',
    relevantToMumbai: true,
    integrationRequirement:
      'Requires a server-side proxy. The site root issues an HTML meta-refresh to ' +
      '/site/index.jsp and exposes no public JSON or XML bulletin feed. No documented ' +
      'machine-readable endpoint was found.',
  },
] as const;

/** Minimal fetch shape, so tests can supply a Response-like object. */
export interface ProbeResponseLike {
  ok: boolean;
  status: number;
  /** Case-insensitive header lookup. */
  header(name: string): string | null;
}

export interface WarningProbeDeps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  isOnline?: () => boolean;
  /** Per-request timeout. Prevents a hung IMD host stalling the whole pipeline. */
  timeoutMs?: number;
}

/**
 * Read the CORS header case-insensitively.
 *
 * Browser `fetch` does this for us, but the value must be inspected to
 * distinguish "no header" from "header present but not for us".
 */
function readHeader(response: ProbeResponseLike, name: string): string | null {
  try {
    return response.header(name);
  } catch {
    return null;
  }
}

/**
 * Classify why we cannot trust this response as a machine-readable bulletin.
 *
 * `origin` is the origin this application is served from, used to decide
 * whether an allowed origin is actually ours.
 */
function classifyBlocker(
  response: ProbeResponseLike,
  origin: string
): WarningAccessBlocker | null {
  const acao = readHeader(response, 'access-control-allow-origin');
  const contentType = readHeader(response, 'content-type') ?? '';

  if (acao === null || acao.trim() === '') return 'cors-denied';

  const isWildcard = acao.trim() === '*';
  const isOurOrigin = acao.trim().replace(/\/$/, '') === origin.replace(/\/$/, '');

  if (!isWildcard && !isOurOrigin) return 'cors-origin-restricted';

  // CORS is fine for us, but the payload still has to be structured data.
  if (contentType.includes('text/html')) return 'no-machine-readable-feed';

  return null;
}

function describe(
  blocker: WarningAccessBlocker,
  httpStatus: number | null,
  contentType: string | null,
  acao: string | null
): string {
  const parts: string[] = [];
  if (httpStatus !== null) parts.push(`HTTP ${httpStatus}`);
  if (contentType) parts.push(`content-type ${contentType}`);
  if (acao === null) parts.push('no Access-Control-Allow-Origin header');
  else parts.push(`Access-Control-Allow-Origin: ${acao}`);

  const observed = parts.length ? ` (observed: ${parts.join(', ')})` : '';

  switch (blocker) {
    case 'cors-denied':
      return `The source returned no CORS header, so this browser cannot read it.${observed}`;
    case 'cors-origin-restricted':
      return `The source grants CORS only to a different origin.${observed}`;
    case 'no-machine-readable-feed':
      return `The source is reachable but serves HTML, not a parseable bulletin feed.${observed}`;
    case 'requires-authentication':
      return `The source requires credentials this application does not hold.${observed}`;
    default:
      return `The source could not be read.${observed}`;
  }
}

/**
 * Probe one official-warning product.
 *
 * Performs a genuine network request to the documented URL and reports what
 * actually happened. Never invents a headline, an issue time, or an `active`
 * value it did not observe.
 */
export async function probeWarningProduct(
  spec: WarningProductSpec,
  deps: WarningProbeDeps = {}
): Promise<OfficialWarningStatus> {
  const {
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    timeoutMs = 10000,
  } = deps;

  const base: OfficialWarningStatus = {
    authority: spec.authority,
    productId: spec.productId,
    label: spec.label,
    url: spec.url,
    // UNKNOWN until a read succeeds. Never optimistically false.
    active: null,
    issuedAt: null,
    validFrom: null,
    validUntil: null,
    headline: null,
    affectedArea: null,
    retrievedAt: null,
    status: 'unavailable',
    blocker: null,
    blockerDetail: null,
    httpStatus: null,
    contentType: null,
  };

  if (!isOnline()) {
    return {
      ...base,
      status: 'offline',
      blocker: 'cors-denied',
      blockerDetail:
        'The browser reports it is offline, so no official source could be contacted. ' +
        'Warning status is UNKNOWN, not "no warning".',
    };
  }

  let response: Response;
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer =
    controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

  try {
    response = await fetchImpl(spec.url, {
      signal: controller?.signal,
      headers: { Accept: 'application/json, text/plain, text/html' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network request failed';
    return {
      ...base,
      status: 'unavailable',
      blocker: 'cors-denied',
      // A browser fetch that fails before reaching the server is almost always
      // CORS, DNS, TLS or offline. We state the cause without guessing which.
      blockerDetail: `The request did not complete: ${message}. Warning status is UNKNOWN.`,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  const httpStatus = response.status;
  const contentType = readHeader(response, 'content-type');
  const acao = readHeader(response, 'access-control-allow-origin');
  const origin =
    typeof location !== 'undefined' && location.origin ? location.origin : '';

  const blocker = classifyBlocker(response, origin);

  if (blocker) {
    return {
      ...base,
      status: isOnline() ? 'unavailable' : 'offline',
      blocker,
      blockerDetail: describe(blocker, httpStatus, contentType, acao),
      httpStatus,
      contentType,
    };
  }

  // CORS is satisfied and the payload is not HTML. We would need to parse the
  // structured body here. Because no such feed is currently reachable, this
  // branch reports UNKNOWN rather than guessing at a schema.
  return {
    ...base,
    status: 'unavailable',
    blocker: 'no-machine-readable-feed',
    blockerDetail:
      'The endpoint responded and is readable, but no published bulletin schema was ' +
      'identified for this product, so its warning state cannot be determined. ' +
      'Warning status is UNKNOWN, not "no warning".',
    httpStatus,
    contentType,
  };
}

/**
 * Probe every configured product.
 *
 * Runs them concurrently but returns results in the declared product order so
 * the UI is stable between renders.
 */
export async function probeOfficialWarnings(
  specs: readonly WarningProductSpec[] = WARNING_PRODUCTS,
  deps: WarningProbeDeps = {}
): Promise<OfficialWarningStatus[]> {
  const results = await Promise.all(specs.map((spec) => probeWarningProduct(spec, deps)));
  return specs.map((spec) => results.find((r) => r.productId === spec.productId)!);
}

/**
 * Reduce a set of product statuses to a single conservative answer.
 *
 * This is the value the risk engine consumes. The rule is deliberately strict:
 *
 *  - If ANY relevant product is actively warning -> `true`.
 *  - If at least one is active and NONE is unknown -> `false` (we checked).
 *  - Otherwise -> `null` (we could not establish it).
 *
 * A single unreadable source therefore prevents the system from claiming
 * "there is no official warning".
 */
export function summarizeOfficialWarnings(
  statuses: readonly OfficialWarningStatus[]
): { active: boolean | null; authority: OfficialWarningAuthority | null; checkedAt: string | null } {
  const relevant = statuses.filter((s) =>
    WARNING_PRODUCTS.some((spec) => spec.productId === s.productId && spec.relevantToMumbai)
  );

  if (relevant.length === 0) {
    return { active: null, authority: null, checkedAt: null };
  }

  if (relevant.some((s) => s.active === true)) {
    const authority = relevant.find((s) => s.active === true)!.authority;
    return { active: true, authority, checkedAt: retrievedAtOf(relevant) };
  }

  if (relevant.some((s) => s.active === null)) {
    return { active: null, authority: null, checkedAt: retrievedAtOf(relevant) };
  }

  return { active: false, authority: relevant[0].authority, checkedAt: retrievedAtOf(relevant) };
}

function retrievedAtOf(statuses: readonly OfficialWarningStatus[]): string | null {
  const times = statuses
    .map((s) => s.retrievedAt)
    .filter((t): t is string => typeof t === 'string');
  if (times.length === 0) return null;
  // All products are probed in one pass; take the newest for the summary stamp.
  return times.sort().at(-1) ?? null;
}
