/**
 * Build hazard features and forecast points from VERIFIED source payloads.
 *
 * This module only reshapes data that Open-Meteo actually published. It never
 * extrapolates, interpolates, or fills gaps. If the source omitted a value,
 * the corresponding feature is null and the risk engine refuses to reason
 * about it.
 */

import { isRecord, validateField, validateTimestamp } from './validation';
import type {
  AdapterDeps,
  MarineHourlyPoint,
  NormalizedMarine,
  SourceError,
  SourceStatus,
} from './types';
import { emptyHazardFeatures, type HazardFeatures } from '@/risk/engine';

/**
 * Ranges used to reject impossible values.
 *
 * These are sanity bounds, not risk thresholds: they catch null/NaN/negative or
 * impossible readings so they never reach the risk engine as usable data.
 */
export const HAZARD_RANGES = {
  waveHeightM: { min: 0, max: 30 },
  swellHeightM: { min: 0, max: 30 },
  wavePeriodS: { min: 0, max: 40 },
  directionDeg: { min: 0, max: 360 },
  oceanCurrentVelocity: { min: 0, max: 5 },
  seaSurfaceTemperatureC: { min: -5, max: 45 },
  windSpeedKmh: { min: 0, max: 250 },
  windGustKmh: { min: 0, max: 300 },
  precipitationMm: { min: 0, max: 200 },
  precipitationProbabilityPct: { min: 0, max: 100 },
  visibilityM: { min: 0, max: 100000 },
} as const;

/** Fields the engine expects but which may be absent. Recorded for the UI. */
export interface FeatureExtractionResult {
  features: HazardFeatures;
  missingFields: string[];
  rejectedRecords: number;
}

const FEATURE_LABELS: Partial<Record<keyof HazardFeatures, string>> = {
  waveHeightM: 'wave height',
  swellHeightM: 'swell height',
  wavePeriodS: 'wave period',
  waveDirectionDeg: 'wave direction',
  swellDirectionDeg: 'swell direction',
  oceanCurrentVelocity: 'ocean current',
  seaSurfaceTemperatureC: 'sea surface temperature',
  windSpeedKmh: 'wind speed',
  windGustKmh: 'wind gusts',
  windDirectionDeg: 'wind direction',
  precipitationMm: 'precipitation',
  precipitationProbabilityPct: 'precipitation probability',
  visibilityM: 'visibility',
};

/**
 * Extract the current-condition hazard features.
 *
 * Sea-state fields now live on the normalized `NormalizedMarine` reading
 * itself, because the marine URL requests them explicitly. The previous design
 * read swell/current/SST from a separate `marineExtra` channel that the URL
 * never populated, so those features were permanently null while the
 * provenance panel listed them as fields in use.
 *
 * `weatherExtra` remains an optional channel for atmospheric variables that are
 * not part of the current-conditions contract. It is null in production; every
 * field it would supply is also available on the normalized reading.
 */
export function extractHazardFeatures(
  marine: NormalizedMarine,
  marineExtra: Record<string, unknown> | null,
  weatherExtra: Record<string, unknown> | null
): FeatureExtractionResult {
  const features = emptyHazardFeatures();
  const missing: string[] = [];

  const set = (
    key: keyof HazardFeatures,
    value: number | null,
    range: { min: number; max: number }
  ) => {
    if (value === null) {
      missing.push(FEATURE_LABELS[key] ?? key);
      return;
    }
    // `key` is narrowed to the numeric hazard features by the `set` signature,
    // so the write is safe. The cast goes through `unknown` because
    // `HazardFeatures` has no index signature; writing through a typed local
    // avoids loosening the shared interface for one assignment site.
    (features as unknown as Record<string, number | null>)[key] = value;
  };

  // Marine, from the already-normalized reading.
  features.marineStatus = marine.status;
  features.marineFetchedAt = marine.fetchedAt;
  set('waveHeightM', marine.waveHeight, HAZARD_RANGES.waveHeightM);
  set('wavePeriodS', marine.wavePeriod, HAZARD_RANGES.wavePeriodS);
  set('waveDirectionDeg', marine.waveDirection, HAZARD_RANGES.directionDeg);

  // Marine extras. The normalized reading is authoritative; `marineExtra` is
  // consulted only if the field is absent there, so an older caller that still
  // passes raw extras keeps working.
  const extra = isRecord(marineExtra) ? marineExtra : {};
  set(
    'swellHeightM',
    marine.swellHeight ??
      validateField(extra.swell_wave_height, HAZARD_RANGES.swellHeightM),
    HAZARD_RANGES.swellHeightM
  );
  set(
    'swellDirectionDeg',
    marine.swellDirection ??
      validateField(extra.swell_wave_direction, HAZARD_RANGES.directionDeg),
    HAZARD_RANGES.directionDeg
  );
  set(
    'oceanCurrentVelocity',
    marine.oceanCurrentVelocity ??
      validateField(extra.ocean_current_velocity, HAZARD_RANGES.oceanCurrentVelocity),
    HAZARD_RANGES.oceanCurrentVelocity
  );
  set(
    'seaSurfaceTemperatureC',
    marine.seaSurfaceTemperature ??
      validateField(extra.sea_surface_temperature, HAZARD_RANGES.seaSurfaceTemperatureC),
    HAZARD_RANGES.seaSurfaceTemperatureC
  );

  // Atmosphere, from the normalized marine reading's weather fields plus extras.
  const w = isRecord(weatherExtra) ? weatherExtra : {};
  features.weatherStatus = marine.status;
  features.weatherFetchedAt = marine.fetchedAt;
  set('windSpeedKmh', marine.windSpeed ?? validateField(w.wind_speed_10m, HAZARD_RANGES.windSpeedKmh), HAZARD_RANGES.windSpeedKmh);
  set('windDirectionDeg', marine.windDirection ?? validateField(w.wind_direction_10m, HAZARD_RANGES.directionDeg), HAZARD_RANGES.directionDeg);
  set('windGustKmh', validateField(w.wind_gusts_10m, HAZARD_RANGES.windGustKmh), HAZARD_RANGES.windGustKmh);
  set('precipitationMm', validateField(w.precipitation, HAZARD_RANGES.precipitationMm), HAZARD_RANGES.precipitationMm);
  set(
    'precipitationProbabilityPct',
    marine.rainProbability ?? validateField(w.precipitation_probability, HAZARD_RANGES.precipitationProbabilityPct),
    HAZARD_RANGES.precipitationProbabilityPct
  );
  set('visibilityM', validateField(w.visibility, HAZARD_RANGES.visibilityM), HAZARD_RANGES.visibilityM);

  return { features, missingFields: missing, rejectedRecords: 0 };
}

// =====================================================================
// FORECAST TIMELINE
// =====================================================================

/**
 * One hourly forecast point.
 *
 * Built ONLY from timestamps the source actually published. The list is never
 * padded, extrapolated, or extended past the source's horizon.
 */
export interface ForecastPoint {
  /** Local wall-clock time exactly as published (e.g. `2026-09-30T20:00`). */
  time: string;
  /** ISO-8601 with the source's UTC offset applied, for ordering. */
  isoTime: string;
  waveHeightM: number | null;
  swellHeightM: number | null;
  wavePeriodS: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  precipitationMm: number | null;
  precipitationProbabilityPct: number | null;
  visibilityM: number | null;
  /**
   * Hazard state for this hour, evaluated by the risk engine's SHARED rule
   * table via `evaluateForecastHour`.
   *
   * `severe` is deliberately absent from this union: it is reserved for an
   * official authority or a confirmed tsunami flag, neither of which is a
   * per-hour model output. The previous local implementation could return
   * `severe` for a 3.7 m wave hour while the same rule was `high` in the
   * engine, so the timeline showed red while the headline showed amber.
   */
  hazardState: 'nominal' | 'elevated' | 'high' | 'insufficient-data';
  /** Rule ids that fired at this point. */
  ruleIds: string[];
  /** Freshness of the source that supplied this point. */
  sourceStatus: SourceStatus;
}

export interface ForecastPayloadLike {
  time?: unknown;
  wave_height?: unknown;
  swell_wave_height?: unknown;
  wave_period?: unknown;
  wind_speed_10m?: unknown;
  wind_gusts_10m?: unknown;
  precipitation?: unknown;
  precipitation_probability?: unknown;
  visibility?: unknown;
}

/** One aligned reading from the source's parallel arrays. */
interface RawPoint {
  /** Source-local timestamp exactly as published, e.g. `2026-10-01T09:00`. */
  time: string;
  /**
   * The same instant as a true UTC ISO-8601 string, corrected by the source's
   * `utc_offset_seconds`. Keeping both lets the UI render the source's own
   * local time while still comparing and sorting instants correctly.
   */
  isoTime: string;
  values: Record<string, number | null>;
}

function at(arr: unknown, i: number): unknown {
  return Array.isArray(arr) ? arr[i] : undefined;
}

/**
 * Parse the source's parallel hourly arrays into aligned points.
 *
 * A time is kept only if it parses; every measurement is independently
 * nullable. Points are never merged or interpolated across missing values.
 */
export function parseForecastPoints(
  payload: ForecastPayloadLike,
  utcOffsetSeconds: number,
  range?: { start?: number; end?: number }
): { points: RawPoint[]; rejected: number } {
  const times = Array.isArray(payload.time) ? payload.time : [];
  const offsetMs = utcOffsetSeconds * 1000;
  const points: RawPoint[] = [];
  let rejected = 0;

  for (let i = 0; i < times.length; i += 1) {
    const time = validateTimestamp(times[i]);
    if (!time) {
      rejected += 1;
      continue;
    }

    const epoch = Date.parse(`${time}:00Z`);
    if (Number.isNaN(epoch)) {
      rejected += 1;
      continue;
    }

    const isoTime = new Date(epoch - offsetMs).toISOString();

    if (range?.start !== undefined && epoch < range.start) continue;
    if (range?.end !== undefined && epoch > range.end) continue;

    points.push({
      time,
      isoTime,
      values: {
        waveHeightM: validateField(at(payload.wave_height, i), HAZARD_RANGES.waveHeightM),
        swellHeightM: validateField(at(payload.swell_wave_height, i), HAZARD_RANGES.swellHeightM),
        wavePeriodS: validateField(at(payload.wave_period, i), HAZARD_RANGES.wavePeriodS),
        windSpeedKmh: validateField(at(payload.wind_speed_10m, i), HAZARD_RANGES.windSpeedKmh),
        windGustKmh: validateField(at(payload.wind_gusts_10m, i), HAZARD_RANGES.windGustKmh),
        precipitationMm: validateField(at(payload.precipitation, i), HAZARD_RANGES.precipitationMm),
        precipitationProbabilityPct: validateField(
          at(payload.precipitation_probability, i),
          HAZARD_RANGES.precipitationProbabilityPct
        ),
        visibilityM: validateField(at(payload.visibility, i), HAZARD_RANGES.visibilityM),
      },
    });
  }

  return { points, rejected };
}

export { MarineHourlyPoint, SourceError, AdapterDeps };
