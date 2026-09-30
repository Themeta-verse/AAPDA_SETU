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
  | 'usgs-earthquakes';

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