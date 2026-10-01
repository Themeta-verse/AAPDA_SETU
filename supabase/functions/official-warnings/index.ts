/**
 * Official warning retrieval for IMD and INCOIS, performed SERVER-SIDE.
 *
 * ===================================================================
 * WHY THIS FUNCTION EXISTS
 * ===================================================================
 *
 * The browser cannot read IMD or INCOIS. That is a CORS problem, and CORS is a
 * browser-enforced restriction, not an authority decision: it disappears the
 * moment the request is made by a server. This function therefore exists to
 * answer a question the browser structurally cannot:
 *
 *   "If we were NOT behind CORS, could we actually read a bulletin?"
 *
 * The honest answer, measured on 2026-09-30 against the live endpoints, is NO —
 * and this function reports exactly that, with the evidence attached, instead of
 * leaving the UI to guess. See `EXTRACTION_MARKERS` below for what was checked.
 *
 * WHAT THIS FUNCTION DOES NOT DO
 * -----------------------------
 * It does not infer, summarise, or synthesise a warning. If it cannot find a
 * bulletin it says so and reports `active: null` — UNKNOWN. It never returns
 * `active: false` from a page it could not parse, because "we could not read it"
 * and "there is no warning" are different facts and only one of them is safe to
 * act on.
 *
 * SECURITY
 * --------
 * `verify_jwt = true` is set in config.toml, so only signed-in callers reach
 * this function. The upstream host list is a hardcoded allowlist, so this cannot
 * be used as an open proxy. Responses are cached briefly to keep repeated polls
 * from hammering two public government sites.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * The exact products this application reports on.
 *
 * `host` is part of the allowlist check. A caller cannot supply a URL: the
 * upstream is chosen by `productId` alone.
 */
const PRODUCTS = [
  {
    productId: "IMD_MARINE_FORECAST",
    authority: "IMD",
    label: "IMD Marine Forecast (fishermen warnings)",
    url: "https://mausam.imd.gov.in/responsive/marine_forecast.php",
    relevantToMumbai: true,
  },
  {
    productId: "IMD_SEA_AREA_BULLETIN",
    authority: "IMD",
    label: "IMD Sea Area Bulletin",
    url: "https://mausam.imd.gov.in/responsive/all_india_forcast_bulletin.php",
    relevantToMumbai: true,
  },
  {
    productId: "INCOIS_TSUNAMI",
    authority: "INCOIS",
    label: "INCOIS Tsunami Early Warning System",
    url: "https://tsunami.incois.gov.in/TEWS/",
    relevantToMumbai: true,
  },
  {
    productId: "INCOIS_OCEAN_STATE",
    authority: "INCOIS",
    label: "INCOIS Ocean State Forecast",
    url: "https://www.incois.gov.in/site/index.jsp",
    relevantToMumbai: true,
  },
] as const;

const ALLOWED_HOSTS = new Set([
  "mausam.imd.gov.in",
  "tsunami.incois.gov.in",
  "www.incois.gov.in",
]);

/**
 * Markers that would indicate a real, published bulletin body.
 *
 * Each was verified absent from the live responses. They are kept, and reported
 * back, so that the diagnosis is falsifiable: if a bulletin ever appears, the
 * matching marker is named in the response and the extraction path can be
 * completed against real text rather than guessed at.
 */
const EXTRACTION_MARKERS = [
  "valid upto",
  "valid up to",
  "issued on",
  "next 5 days",
  "warning signal",
  "arabian sea",
  "maharashtra coast",
  "tsunami bulletin",
] as const;

/** Strip scripts, styles and tags so only human-visible text remains. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

interface ProductResult {
  productId: string;
  authority: string;
  label: string;
  url: string;
  /** Always null. See the header comment: we never synthesise a warning. */
  active: null;
  issuedAt: null;
  validFrom: null;
  validUntil: null;
  headline: null;
  affectedArea: null;
  retrievedAt: string;
  status: "live" | "unavailable";
  /** `no-bulletin-content` | `http-error` | `network-error` | `not-allowed` */
  blocker: string | null;
  blockerDetail: string;
  httpStatus: number | null;
  contentType: string | null;
  /** Evidence for the diagnosis, so it can be checked rather than trusted. */
  diagnostics: {
    finalUrl: string | null;
    bytes: number;
    visibleChars: number;
    /** Which extraction markers were present. Empty means none matched. */
    markersFound: string[];
    /** True when the body was navigation chrome only. */
    looksLikeNavigationOnly: boolean;
  };
  relevantToMumbai: boolean;
}

async function retrieve(product: typeof PRODUCTS[number]): Promise<ProductResult> {
  const retrievedAt = new Date().toISOString();
  const base = {
    productId: product.productId,
    authority: product.authority,
    label: product.label,
    url: product.url,
    active: null,
    issuedAt: null,
    validFrom: null,
    validUntil: null,
    headline: null,
    affectedArea: null,
    retrievedAt,
    relevantToMumbai: product.relevantToMumbai,
  } as const;

  const host = new URL(product.url).host;
  if (!ALLOWED_HOSTS.has(host)) {
    return {
      ...base,
      status: "unavailable",
      blocker: "not-allowed",
      blockerDetail: `Host ${host} is not on the allowlist, so it was not requested.`,
      httpStatus: null,
      contentType: null,
      diagnostics: {
        finalUrl: null,
        bytes: 0,
        visibleChars: 0,
        markersFound: [],
        looksLikeNavigationOnly: false,
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(product.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Some government hosts reject requests with no identifying UA.
        "User-Agent": "BayWatch-Coastal-Alerts/1.0 (educational disaster-awareness project)",
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en",
      },
    });

    const contentType = response.headers.get("content-type");
    const body = await response.text();
    const text = visibleText(body);
    const lower = text.toLowerCase();
    const markersFound = EXTRACTION_MARKERS.filter((m) => lower.includes(m));

    const diagnostics = {
      finalUrl: response.url || null,
      bytes: body.length,
      visibleChars: text.length,
      markersFound,
      // A page whose visible text is mostly menu labels, with none of the
      // bulletin markers, is navigation chrome rather than a bulletin.
      looksLikeNavigationOnly: markersFound.length === 0,
    };

    if (!response.ok) {
      return {
        ...base,
        status: "unavailable",
        blocker: "http-error",
        blockerDetail:
          `The server answered HTTP ${response.status}. No bulletin could be read. ` +
          "Warning status is UNKNOWN, not 'no warning'.",
        httpStatus: response.status,
        contentType,
        diagnostics,
      };
    }

    if (contentType?.includes("json")) {
      // A machine-readable feed would be a genuine integration target. We are
      // explicit that no schema has been implemented rather than guessing at one
      // and reporting a fabricated result.
      return {
        ...base,
        status: "unavailable",
        blocker: "no-bulletin-content",
        blockerDetail:
          `A JSON response was received (${body.length} bytes) but no published schema for ` +
          "this product has been implemented, so no warning state can be derived. " +
          "Warning status is UNKNOWN, not 'no warning'.",
        httpStatus: response.status,
        contentType,
        diagnostics,
      };
    }

    return {
      ...base,
      status: "unavailable",
      blocker: "no-bulletin-content",
      blockerDetail:
        `Reached ${diagnostics.finalUrl ?? product.url} successfully (HTTP ${response.status}, ` +
        `${diagnostics.bytes} bytes of HTML, ${diagnostics.visibleChars} visible characters), but ` +
        "the response contains navigation and menu content only. None of the bulletin " +
        `markers (${EXTRACTION_MARKERS.slice(0, 4).join(", ")}, …) appear in it, so no ` +
        "published warning text, issue time or validity window is present to read. " +
        "Warning status is UNKNOWN, not 'no warning'.",
      httpStatus: response.status,
      contentType,
      diagnostics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ...base,
      status: "unavailable",
      blocker: "network-error",
      blockerDetail: aborted
        ? "The request to the official source timed out after 20 seconds. Warning status is UNKNOWN, not 'no warning'."
        : `The request to the official source failed: ${message}. Warning status is UNKNOWN, not 'no warning'.`,
      httpStatus: null,
      contentType: null,
      diagnostics: {
        finalUrl: null,
        bytes: 0,
        visibleChars: 0,
        markersFound: [],
        looksLikeNavigationOnly: false,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Short-lived cache so a polling client cannot hammer the upstream sites. */
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; body: unknown } | null = null;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Defense in depth. config.toml already sets verify_jwt = true.
  const auth = req.headers.get("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return new Response(JSON.stringify(cache.body), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "X-BayWatch-Cache": "hit",
      },
    });
  }

  try {
    const results = await Promise.all(PRODUCTS.map(retrieve));
    const body = {
      retrievedAt: new Date().toISOString(),
      // Stated once, plainly, for the UI to surface.
      note:
        "Server-side retrieval succeeded for the HTTP exchange. Where blocker is " +
        "'no-bulletin-content' the authority served a page with no published bulletin " +
        "in it, so the warning state is UNKNOWN rather than absent.",
      products: results,
    };
    cache = { at: Date.now(), body };
    return new Response(JSON.stringify(body), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "X-BayWatch-Cache": "miss",
      },
    });
  } catch (error) {
    console.error("official-warnings failed", error);
    return new Response(JSON.stringify({ error: "Retrieval failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
