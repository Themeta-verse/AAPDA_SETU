/**
 * Shared contract for every AAPDA SETU official data source adapter.
 *
 * Adapters are responsible for transport, validation and normalisation only.
 * They never render, never derive risk, and never invent values.
 */

/**
 * Single freshness vocabulary shared by every source in the application.
 *
 * This union is the ONLY freshness system. Do not add per-adapter or
 * per-component variants (no `isLive`, no `hasData`, no ad-hoc booleans).
 */
export type SourceStatus = 'live' | 'stale' | 'unavailable' | 'offline';

/** Identifiers for every official source the platform will eventually consume. */
export type SourceId =
  | 'open-meteo-marine'
  | 'open-meteo-weather'
  | 'usgs-earthquakes'
  | 'imd-marine-forecast'
  | 'imd-sea-area-bulletin'
  | 'incois-ocean-state'
  | 'incois-tsunami'
  | 'incois-high-wave';

export type SourceErrorKind =
  /** The request never reached the source (DNS, TLS, CORS, offline). */
  | 'network'
  /** The source answered with a non-2xx status. */
  | 'http'
  /** The source answered 2xx but the body could not be parsed. */
  | 'malformed'
  /** The source answered correctly but does not publish the fields we need. */
  | 'missing-fields'
  /** The source is reachable but explicitly reported an error payload. */
  | 'source-error';

export interface SourceError {
  kind: SourceErrorKind;
  message: string;
  httpStatus?: number;
  sourceId: SourceId;
}

/** Provenance carried alongside every normalized payload. */
export interface SourceMetadata {
  id: SourceId;
  label: string;
  authority: 'official';
  /** Endpoint the payload was actually read from. */
  url: string;
  /** Observation timestamp published by the source, ISO-8601, or null. */
  observedAt: string | null;
}

export interface MarineHourlyPoint {
  /** ISO-8601 timestamp as published by the source (source timezone). */
  time: string;
  waveHeight: number;
}

/**
 * Normalized marine observation for a single point.
 *
 * Field-by-field provenance:
 *  - wave height / wave direction / wave period / hourly series come from the
 *    Open-Meteo Marine endpoint. This is the authoritative sea-state source.
 *  - wind, precipitation, temperature and pressure come from the Open-Meteo
 *    Forecast endpoint, because the Marine endpoint does not publish wind.
 *    Both endpoints are the same provider at the same coordinate and are
 *    requested together, so they share one fetch window.
 *
 * Every numeric field is `number | null`. `null` means "the source did not
 * publish a usable value" and must never be replaced by a default constant.
 */
export interface NormalizedMarine {
  status: SourceStatus;
  /** When this payload was parsed, ISO-8601, or null if nothing was parsed. */
  fetchedAt: string | null;
  source: SourceMetadata;

  // Sea state — Open-Meteo Marine (authoritative).
  waveHeight: number | null;
  waveDirection: number | null;
  wavePeriod: number | null;
  hourly: MarineHourlyPoint[];

  // Atmosphere — Open-Meteo Forecast.
  windSpeed: number | null;
  windDirection: number | null;
  rainProbability: number | null;
  temperature: number | null;
  pressure: number | null;

  error: SourceError | null;
}

/**
 * Result of one adapter attempt. `data` is present only when the source
 * answered with a body we could validate; otherwise `error` explains why.
 */
export interface AdapterResult<T> {
  data: T | null;
  error: SourceError | null;
}

/**
 * One earthquake from the USGS Earthquake Hazards Program GeoJSON feed.
 *
 * Provenance — every field is read directly from the feed's own fields:
 *   id          <- feature.id
 *   magnitude   <- properties.mag
 *   place       <- properties.place
 *   occurredAt  <- properties.time      (epoch ms -> ISO)
 *   updatedAt   <- properties.updated   (epoch ms -> ISO)
 *   longitude   <- geometry.coordinates[0]
 *   latitude    <- geometry.coordinates[1]
 *   depthKm     <- geometry.coordinates[2]
 *   tsunami     <- properties.tsunami   (see normalizeTsunamiFlag)
 *   alert       <- properties.alert     (USGS PAGER level: green/yellow/orange/red)
 *   reviewStatus<- properties.status     (automatic / reviewed)
 *   eventType   <- properties.type       (earthquake, quarry blast, ice quake...)
 *   eventUrl    <- properties.url        (USGS event page)
 *   source, status, fetchedAt, error    <- adapter-level provenance
 *
 * Every field is `number | string | null`. `null` means "the source did not
 * publish a usable value". It is never replaced by 0, false or ''.
 */
export interface NormalizedEarthquake {
  id: string;
  magnitude: number | null;
  place: string | null;
  occurredAt: string | null;
  updatedAt: string | null;
  longitude: number;
  latitude: number;
  depthKm: number | null;
  tsunami: boolean | null;
  alert: string | null;
  reviewStatus: string | null;
  eventType: string | null;
  eventUrl: string | null;

  source: SourceMetadata;
  status: SourceStatus;
  fetchedAt: string | null;
  error: SourceError | null;
}

/**
 * Result of reading the USGS feed.
 *
 * `events` holds only events that passed the region filter, newest first.
 *
 * A feed that parsed successfully but contains no matching events is a VALID
 * reading, not a failure: `status` stays `live` with `events: []`. Reporting
 * "no earthquakes" as `unavailable` would falsely imply the source broke.
 */
export interface NormalizedEarthquakeFeed {
  events: NormalizedEarthquake[];
  /** Events in the feed before regional filtering, for transparency. */
  totalInFeed: number;
  /** Events dropped because they were structurally invalid. */
  rejectedCount: number;
  /** USGS `metadata.generated`, ISO-8601 — when the feed was generated. */
  feedGeneratedAt: string | null;

  source: SourceMetadata;
  status: SourceStatus;
  fetchedAt: string | null;
  error: SourceError | null;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Injection points so adapters can be tested without a network. */
export interface AdapterDeps {
  fetchImpl?: typeof fetch;
  /** Current time; injectable so freshness is deterministic under test. */
  now?: () => Date;
  /** Connectivity probe; injectable for the same reason. */
  isOnline?: () => boolean;
}

// =====================================================================
// OFFICIAL WARNINGS
// =====================================================================

/**
 * Why an official-warning source cannot be read by this application.
 *
 * These are factual statements about the source's access model, discovered by
 * inspecting the live response, not placeholder copy. Each is recorded so the
 * UI can explain WHY an official warning is absent instead of implying that no
 * warning exists.
 */
export type WarningAccessBlocker =
  /** The response carries no `Access-Control-Allow-Origin` the app may use. */
  | 'cors-denied'
  /** The response allows CORS only for an origin this app is not served from. */
  | 'cors-origin-restricted'
  /** Reachable and CORS-permitted, but the body is HTML with no parseable data. */
  | 'no-machine-readable-feed'
  /** The endpoint requires a credential or service-role call we do not hold. */
  | 'requires-authentication';

/** The official agencies whose bulletins this platform would consume. */
export type OfficialWarningAuthority = 'IMD' | 'INCOIS' | 'USGS';

/**
 * One official warning product's availability.
 *
 * IMPORTANT: `active` is tri-state on purpose.
 *   - `true`  — we read the source and it reports an active warning.
 *   - `false` — we read the source and it reports NO active warning.
 *   - `null`  — we could NOT read the source, so we do not know.
 *
 * Collapsing `null` into `false` is the single most dangerous failure this
 * application could make: it would display "no official warning" while a real
 * hazard bulletin was in force and we simply could not fetch it.
 */
export interface OfficialWarningStatus {
  authority: OfficialWarningAuthority;
  /** Stable key for the specific product (e.g. `INCOIS_TSUNAMI`). */
  productId: string;
  label: string;
  /** The exact URL inspected. */
  url: string;
  /** Null only when we genuinely read the source and it was clear. */
  active: boolean | null;
  /** ISO-8601 issue time published by the authority, when known. */
  issuedAt: string | null;
  validFrom: string | null;
  validUntil: string | null;
  /** Verbatim headline text from the authority, when one was published. */
  headline: string | null;
  /** Geographic scope exactly as the authority stated it. */
  affectedArea: string | null;
  /** When this reading was taken. */
  retrievedAt: string | null;
  /** Freshness of the reading itself. */
  status: SourceStatus;
  /** Set when we could not establish `active`. */
  blocker: WarningAccessBlocker | null;
  /** Exact reason, recorded verbatim for the provenance panel. */
  blockerDetail: string | null;
  /** HTTP status observed when the blocker was determined. */
  httpStatus: number | null;
  /** Response content type observed, used to justify `no-machine-readable-feed`. */
  contentType: string | null;
}

/**
 * Full provenance for any value shown to an operator.
 *
 * `limitations` is required (it may be an empty array) so no value can be
 * displayed without someone having stated what it does not tell us.
 */
export interface Provenance {
  sourceId: SourceId;
  sourceName: string;
  /** Clickable link to the exact resource that was read. */
  url: string;
  authority: OfficialWarningAuthority | 'Open-Meteo';
  /** Time the authority published the underlying observation/forecast. */
  issuedAt: string | null;
  validFrom: string | null;
  validUntil: string | null;
  /** Time this application fetched it. */
  retrievedAt: string | null;
  status: SourceStatus;
  /** Names of the exact fields consumed to produce the displayed value. */
  fieldsUsed: string[];
  /** Stated honestly: what this reading cannot tell us. */
  limitations: string[];
}

// =====================================================================
// DATA QUALITY
// =====================================================================

/**
 * How much the data can support.
 *
 * This is EVIDENCE-based, never a confidence percentage. It is derived from
 * the source's own timestamps, the freshness window, and the count of records
 * or fields that failed validation.
 */
export type DataQualityState =
  | 'CURRENT'
  | 'STALE'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

/** Evidence behind a quality verdict. Every field is a real observation. */
export interface DataQualityEvidence {
  state: DataQualityState;
  /** GOOD / LIMITED / INSUFFICIENT — derived from `state`, never invented. */
  assessment: 'GOOD' | 'LIMITED' | 'INSUFFICIENT';
  /** Human-readable reasons, each traceable to a concrete measurement. */
  reasons: string[];
  sourceStatus: SourceStatus;
  /** Age of the reading at evaluation time, ms. Null when never fetched. */
  ageMs: number | null;
  /** Records that failed validation in the last successful read. */
  rejectedRecords: number;
  /** Expected fields that were absent from the payload. */
  missingFields: string[];
}