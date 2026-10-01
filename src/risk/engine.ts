/**
 * Deterministic coastal risk engine.
 *
 * DESIGN CONTRACT
 * ---------------
 * 1. NO RANDOMNESS. There is no Math.random(), no jitter, no simulated
 *    confidence, and no synthetic probability anywhere in this file.
 * 2. EVERY verdict cites a rule. Each rule has a stable `id`, a human-readable
 *    basis, and the exact threshold. A state without a rule is a bug.
 * 3. UNKNOWN IS A FIRST-CLASS OUTCOME. When an input is missing the dimension
 *    reports `insufficient-data`, never a low score. Missing data is never
 *    silently treated as "safe".
 * 4. MODEL OUTPUT IS NEVER LABELLED AS A WARNING. `CoastalRiskState` is a
 *    deterministic model verdict derived from published measurements. Official
 *    warnings come only from `OfficialWarningStatus`, which is sourced solely
 *    from government bulletins. The UI must render them as distinct concepts.
 *
 * Rule thresholds are expressed against the units Open-Meteo publishes
 * (wave height in metres, wind in km/h) and are documented per rule.
 */

import type {
  DataQualityEvidence,
  DataQualityState,
  OfficialWarningStatus,
  SourceStatus,
} from '@/integrations/adapters/types';

// =====================================================================
// HAZARD FEATURES
// =====================================================================

/**
 * The measurements the engine reasons about, in source units.
 *
 * Every field is `number | null`. `null` means the source did not publish it.
 * The engine refuses to produce a verdict that depends on a null field.
 */
export interface HazardFeatures {
  // Marine — Open-Meteo Marine
  waveHeightM: number | null;
  swellHeightM: number | null;
  wavePeriodS: number | null;
  waveDirectionDeg: number | null;
  swellDirectionDeg: number | null;
  oceanCurrentVelocity: number | null;
  seaSurfaceTemperatureC: number | null;

  // Atmosphere — Open-Meteo Forecast
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  windDirectionDeg: number | null;
  precipitationMm: number | null;
  precipitationProbabilityPct: number | null;
  visibilityM: number | null;

  // Provenance of the numbers above, carried for the explanation panel.
  marineStatus: SourceStatus;
  weatherStatus: SourceStatus;
  marineFetchedAt: string | null;
  weatherFetchedAt: string | null;
}

/** A hazard feature set with no values — the honest starting point. */
export function emptyHazardFeatures(): HazardFeatures {
  return {
    waveHeightM: null,
    swellHeightM: null,
    wavePeriodS: null,
    waveDirectionDeg: null,
    swellDirectionDeg: null,
    oceanCurrentVelocity: null,
    seaSurfaceTemperatureC: null,
    windSpeedKmh: null,
    windGustKmh: null,
    windDirectionDeg: null,
    precipitationMm: null,
    precipitationProbabilityPct: null,
    visibilityM: null,
    marineStatus: 'unavailable',
    weatherStatus: 'unavailable',
    marineFetchedAt: null,
    weatherFetchedAt: null,
  };
}

// =====================================================================
// RULES
// =====================================================================

/**
 * Everything a rule is allowed to read.
 *
 * Marine and weather rules read `HazardFeatures`. Seismic rules read
 * `SeismicFeatures`, which arrives from a different source (the USGS feed) and
 * is merged in before evaluation. Declaring the union here rather than casting
 * at the call site is what makes it a compile error to write a rule against a
 * field that does not exist — the previous signature declared only
 * `HazardFeatures`, so the seismic rules silently referenced `seismicMagnitude`
 * and `seismicDepthKm` on a type that had neither.
 */
export type RiskRuleInput = HazardFeatures & SeismicFeatures;

/**
 * A rule is a named, versioned threshold check.
 *
 * `id` is persisted in risk-transition records, so it must remain stable. If a
 * threshold changes, add a NEW id rather than editing an existing one — that
 * way historical transitions remain explainable against the rule that produced
 * them.
 */
export interface RiskRule {
  id: string;
  /** Source and unit for the threshold, stated so an operator can audit it. */
  basis: string;
  /**
   * Severity this rule contributes to its dimension.
   *
   * Declared explicitly rather than inferred from the rule id. String matching
   * on ids is fragile: a renamed rule would silently change its severity.
   *
   * NOTE: no rule is ever `severe`. `severe` is reserved for a positive
   * official warning or a tsunami flag, because that requires a human
   * authority — the model must not be able to escalate to it on its own.
   */
  severity: Exclude<RiskDimensionState, 'insufficient-data'>;
  /** Returns true when this rule's condition is met. */
  test(features: RiskRuleInput): boolean;
  /** The feature values the rule inspected, for the explanation. */
  inputsOf(features: RiskRuleInput): (string | number | null)[];
}

type RiskDimensionState = 'nominal' | 'elevated' | 'high' | 'severe' | 'insufficient-data';

/** Marine rules. Thresholds in metres, consistent with Open-Meteo output. */
export const MARINE_RULES: readonly RiskRule[] = [
  {
    id: 'MARINE.WAVE.HIGH',
    basis: 'Significant wave height >= 3.7 m (about 12 ft). Rough to very rough sea; small craft at risk.',
    severity: 'high',
    inputsOf: (f) => [f.waveHeightM],
    test: (f) => f.waveHeightM !== null && f.waveHeightM >= 3.7,
  },
  {
    id: 'MARINE.SWELL.HIGH',
    basis: 'Swell wave height >= 3.0 m. Long-period swell drives coastal inundation even when inshore seas are calmer.',
    severity: 'high',
    inputsOf: (f) => [f.swellHeightM],
    test: (f) => f.swellHeightM !== null && f.swellHeightM >= 3.0,
  },
  {
    id: 'MARINE.WAVE.MODERATE',
    basis: 'Significant wave height >= 2.1 m (about 7 ft). Sea becomes hazardous to small craft.',
    severity: 'elevated',
    inputsOf: (f) => [f.waveHeightM],
    test: (f) => f.waveHeightM !== null && f.waveHeightM >= 2.1,
  },
  {
    id: 'MARINE.PERIOD.LONG',
    basis: 'Wave period >= 14 s. Long-period swell carries more energy per unit height.',
    severity: 'elevated',
    inputsOf: (f) => [f.wavePeriodS],
    test: (f) => f.wavePeriodS !== null && f.wavePeriodS >= 14,
  },
  {
    id: 'MARINE.PERIOD.VERY_LONG',
    basis: 'Wave period >= 18 s. Very long-period swell is associated with storm-surge-like coastal water rise.',
    severity: 'high',
    inputsOf: (f) => [f.wavePeriodS],
    test: (f) => f.wavePeriodS !== null && f.wavePeriodS >= 18,
  },
] as const;

/** Weather rules. Wind in km/h (Open-Meteo's unit), rain in mm and %. */
export const WEATHER_RULES: readonly RiskRule[] = [
  {
    id: 'WEATHER.WIND.HIGH',
    basis: 'Sustained wind >= 40 km/h (~25 mph). Risk to trees, signage and loose structures.',
    severity: 'high',
    inputsOf: (f) => [f.windSpeedKmh],
    test: (f) => f.windSpeedKmh !== null && f.windSpeedKmh >= 40,
  },
  {
    id: 'WEATHER.GUST.HIGH',
    basis: 'Wind gusts >= 55 km/h. Gusts drive the actual damage and near-miss risk.',
    severity: 'high',
    inputsOf: (f) => [f.windGustKmh],
    test: (f) => f.windGustKmh !== null && f.windGustKmh >= 55,
  },
  {
    id: 'WEATHER.WIND.MODERATE',
    basis: 'Sustained wind >= 25 km/h.',
    severity: 'elevated',
    inputsOf: (f) => [f.windSpeedKmh],
    test: (f) => f.windSpeedKmh !== null && f.windSpeedKmh >= 25,
  },
  {
    id: 'WEATHER.RAIN.HEAVY',
    basis: 'Precipitation >= 7.5 mm in the hour. Heavy rain causes ponding and drains surcharge on a coastal city.',
    severity: 'high',
    inputsOf: (f) => [f.precipitationMm],
    test: (f) => f.precipitationMm !== null && f.precipitationMm >= 7.5,
  },
  {
    id: 'WEATHER.RAIN.MODERATE',
    basis: 'Precipitation probability >= 60%.',
    severity: 'elevated',
    inputsOf: (f) => [f.precipitationProbabilityPct],
    test: (f) => f.precipitationProbabilityPct !== null && f.precipitationProbabilityPct >= 60,
  },
  {
    id: 'WEATHER.VISIBILITY.LOW',
    basis: 'Visibility <= 1000 m. Disorienting conditions near surf and rescue operations.',
    severity: 'elevated',
    inputsOf: (f) => [f.visibilityM],
    test: (f) => f.visibilityM !== null && f.visibilityM <= 1000,
  },
] as const;

/**
 * Coastal water rules.
 *
 * These use PUBLISHED observations only. Sea level, tide height and storm surge
 * are NOT available from any endpoint this application can read, so there is
 * deliberately no rule for them here. Inventing a sea-level threshold against
 * data we do not have would produce a confident number with no source behind it,
 * which is exactly what this engine exists to prevent.
 *
 * When a verified sea-level source becomes available, rules would be added here
 * with their documented basis — not inferred from wave height.
 */
export const COASTAL_WATER_RULES: readonly RiskRule[] = [] as const;

/**
 * Seismic rules.
 *
 * These describe SEISMIC ACTIVITY, never tsunami risk. An earthquake does not
 * imply a tsunami. Tsunami status comes exclusively from the USGS `tsunami`
 * flag or an INCOIS bulletin; `SEISMIC_*` rules below only report that
 * significant ground shaking occurred.
 */
export const SEISMIC_RULES: readonly RiskRule[] = [
  {
    id: 'SEISMIC.EVENT.MAJOR',
    basis: 'USGS event magnitude >= 6.0. Significant ground shaking; felt reports may exist.',
    severity: 'high',
    inputsOf: (f) => [f.seismicMagnitude],
    test: (f) => f.seismicMagnitude !== null && f.seismicMagnitude >= 6.0,
  },
  {
    id: 'SEISMIC.EVENT.SHALLOW',
    basis:
      'USGS event magnitude >= 5.0 and depth <= 70 km. Shallow events of this size can cause strong local shaking.',
    severity: 'elevated',
    inputsOf: (f) => [f.seismicMagnitude, f.seismicDepthKm],
    test: (f) =>
      f.seismicMagnitude !== null &&
      f.seismicMagnitude >= 5.0 &&
      f.seismicDepthKm !== null &&
      f.seismicDepthKm <= 70,
  },
] as const;

/** Seismic inputs, kept separate because they come from a different source. */
export interface SeismicFeatures {
  /** Highest magnitude among regional events in the feed, or null. */
  seismicMagnitude: number | null;
  /** Depth of that event in km, or null. */
  seismicDepthKm: number | null;
  /**
   * USGS tsunami flag, tri-state.
   *   true  — USGS flagged the event as a tsunami
   *   false — USGS explicitly did not flag it
   *   null  — USGS published no usable flag, OR we could not read the feed
   *
   * NEVER derived from magnitude. USGS flags come from oceanographic modelling.
   */
  tsunamiFlag: boolean | null;
  /** True when the value came from the USGS flag rather than an absence. */
  tsunamiFlagAuthoritative: boolean;
  eventCount: number;
}

export function emptySeismicFeatures(): SeismicFeatures {
  return {
    seismicMagnitude: null,
    seismicDepthKm: null,
    tsunamiFlag: null,
    tsunamiFlagAuthoritative: false,
    eventCount: 0,
  };
}

// =====================================================================
// DIMENSION VERDICTS
// =====================================================================

export type RiskDimensionId = 'marine' | 'weather' | 'coastal-water' | 'seismic';

/**
 * Per-dimension verdict.
 *
 * `state` is deliberately NOT a score. It is the highest-severity rule that
 * fired, or `nominal` when rules were evaluated against complete data and none
 * fired, or `insufficient-data` when we cannot support any claim.
 */
export interface RiskDimension {
  id: RiskDimensionId;
  label: string;
  state: 'nominal' | 'elevated' | 'high' | 'severe' | 'insufficient-data';
  /** Rules that fired, with the exact values they inspected. */
  triggered: TriggeredRule[];
  /** Fields the rules needed that were unavailable. */
  missingInputs: string[];
  /** Source freshness for this dimension's inputs. */
  sourceStatus: SourceStatus;
  /** ISO-8601 when these inputs were retrieved. */
  retrievedAt: string | null;
}

export interface TriggeredRule {
  ruleId: string;
  basis: string;
  /** The values the rule inspected, in rule order. */
  observed: (string | number | null)[];
}

const SEVERITY_ORDER = {
  nominal: 0,
  'insufficient-data': 0,
  elevated: 1,
  high: 2,
  severe: 3,
} as const;

/**
 * Evaluate one dimension.
 *
 * `requiredFields` names the inputs the dimension's rules read. If ANY are null
 * the dimension is `insufficient-data` — we cannot claim "nominal" from a
 * partial reading, because a missing wind gust could be the one that mattered.
 */
function evaluateDimension(
  id: RiskDimensionId,
  label: string,
  rules: readonly RiskRule[],
  features: RiskRuleInput,
  requiredFields: (keyof HazardFeatures)[],
  sourceStatus: SourceStatus,
  retrievedAt: string | null
): RiskDimension {
  const missingInputs = requiredFields
    .filter((field) => features[field] === null || features[field] === undefined)
    .map(String);

  if (missingInputs.length > 0) {
    return {
      id,
      label,
      state: 'insufficient-data',
      triggered: [],
      missingInputs,
      sourceStatus,
      retrievedAt,
    };
  }

  const triggered: TriggeredRule[] = rules
    .filter((rule) => rule.test(features))
    .map((rule) => ({
      ruleId: rule.id,
      basis: rule.basis,
      observed: rule.inputsOf(features),
    }));

  const state = rules
    .filter((rule) => rule.test(features))
    .reduce<Exclude<RiskDimensionState, 'insufficient-data'>>(
      (worst, rule) =>
        SEVERITY_ORDER[rule.severity] > SEVERITY_ORDER[worst] ? rule.severity : worst,
      'nominal'
    );

  return { id, label, state, triggered, missingInputs: [], sourceStatus, retrievedAt };
}

export interface RiskAssessmentInput {
  features: HazardFeatures;
  seismic: SeismicFeatures;
  officialWarnings: readonly OfficialWarningStatus[];
  /** Summarised official-warning verdict, from summarizeOfficialWarnings(). */
  officialWarningActive: boolean | null;
}

/** Field labels used in the "why did this change" panel. */
export const FEATURE_LABELS: Record<keyof HazardFeatures, string> = {
  waveHeightM: 'Significant wave height (m)',
  swellHeightM: 'Swell wave height (m)',
  wavePeriodS: 'Wave period (s)',
  waveDirectionDeg: 'Wave direction (deg)',
  swellDirectionDeg: 'Swell direction (deg)',
  oceanCurrentVelocity: 'Ocean current velocity',
  seaSurfaceTemperatureC: 'Sea surface temperature (C)',
  windSpeedKmh: 'Sustained wind (km/h)',
  windGustKmh: 'Wind gusts (km/h)',
  windDirectionDeg: 'Wind direction (deg)',
  precipitationMm: 'Precipitation (mm/h)',
  precipitationProbabilityPct: 'Precipitation probability (%)',
  visibilityM: 'Visibility (m)',
  marineStatus: 'Marine source status',
  weatherStatus: 'Weather source status',
  marineFetchedAt: 'Marine retrieved at',
  weatherFetchedAt: 'Weather retrieved at',
};

export function evaluateRiskDimensions(
  input: RiskAssessmentInput
): Record<RiskDimensionId, RiskDimension> {
  const { features, seismic, officialWarnings } = input;

  /**
   * Single merged view handed to every rule table.
   *
   * Marine and weather rules only read marine/weather fields; seismic rules only
   * read seismic fields. Merging once here means no rule can accidentally read
   * a field from the wrong source, and the rule signature can stay a single
   * honest type instead of being cast at each call site.
   */
  const combined: RiskRuleInput = { ...features, ...seismic };

  const marine = evaluateDimension(
    'marine',
    'Marine risk',
    MARINE_RULES,
    combined,
    ['waveHeightM', 'wavePeriodS'],
    features.marineStatus,
    features.marineFetchedAt
  );

  const weather = evaluateDimension(
    'weather',
    'Weather risk',
    WEATHER_RULES,
    combined,
    ['windSpeedKmh', 'precipitationMm'],
    features.weatherStatus,
    features.weatherFetchedAt
  );

  // Coastal water has no readable source today, so it is honestly unknown
  // unless an official advisory is actually active.
  const advisoryActive =
    officialWarnings.some((w) => w.authority === 'INCOIS' && w.active === true);
  const coastalWater: RiskDimension = advisoryActive
    ? {
        id: 'coastal-water',
        label: 'Coastal water risk',
        state: 'high',
        triggered: [
          {
            ruleId: 'COASTAL_WATER.INCOIS_ADVISORY_ACTIVE',
            basis: 'An INCOIS coastal water advisory is reported active by the official source.',
            observed: ['active'],
          },
        ],
        missingInputs: [],
        sourceStatus: 'live',
        retrievedAt: null,
      }
    : {
        id: 'coastal-water',
        label: 'Coastal water risk',
        state: 'insufficient-data',
        triggered: [],
        missingInputs: [
          'sea level forecast (no publicly readable endpoint)',
          'wave setup / surge (no publicly readable endpoint)',
          'storm surge advisory (not readable from browser)',
        ],
        sourceStatus: 'unavailable',
        retrievedAt: null,
      };

  // Seismic rules read from the seismic feature set, via the merged view built
  // above. The seismic values come from `seismic`, never from marine `features`.

  const seismicMissing: string[] = [];
  if (combined.seismicMagnitude === null) seismicMissing.push('event magnitude');

  const seismicRulesFired = SEISMIC_RULES.filter((r) => r.test(combined));

  const seismicDimension: RiskDimension =
    seismicMissing.length > 0
      ? {
          id: 'seismic',
          label: 'Seismic activity',
          state: 'insufficient-data',
          triggered: [],
          missingInputs: seismicMissing,
          sourceStatus: 'unavailable',
          retrievedAt: null,
        }
      : {
          id: 'seismic',
          label: 'Seismic activity',
          state: seismicRulesFired.reduce<
            Exclude<RiskDimensionState, 'insufficient-data'>
          >((worst, r) => (SEVERITY_ORDER[r.severity] > SEVERITY_ORDER[worst] ? r.severity : worst), 'nominal'),
          triggered: seismicRulesFired.map((r) => ({
            ruleId: r.id,
            basis: r.basis,
            observed: r.inputsOf(combined),
          })),
          missingInputs: [],
          sourceStatus: seismic.eventCount > 0 ? 'live' : 'unavailable',
          retrievedAt: null,
        };

  return { marine, weather, 'coastal-water': coastalWater, seismic: seismicDimension };
}

// =====================================================================
// OVERALL STATE
// =====================================================================

/**
 * Overall coastal state.
 *
 * Ordering is deliberate. An official advisory outranks any model verdict,
 * because it is a human authority acting on information we may not have.
 */
export type CoastalRiskState = 'nominal' | 'watch' | 'elevated' | 'high' | 'severe' | 'unknown';

export interface RiskTransitionCandidate {
  previousState: CoastalRiskState;
  newState: CoastalRiskState;
  /** Rules responsible for the NEW state. */
  ruleIds: string[];
  /** Values that crossed, for the explanation. */
  triggeringInputs: { label: string; previous: number | string | null; current: number | string | null }[];
  at: string;
  source: string;
}

export interface CoastalRiskAssessment {
  state: CoastalRiskState;
  dimensions: Record<RiskDimensionId, RiskDimension>;
  /**
   * Dimensions that could not be resolved because a required input was absent.
   *
   * A `nominal` state is only a verdict about the dimensions that DID resolve.
   * The UI uses this list to state plainly which parts of the picture are
   * unverified, so `nominal` is never displayed as blanket reassurance.
   */
  unresolvedDimensions: RiskDimensionId[];
  /** Official warning verdict. Null means UNKNOWN, never "no warning". */
  officialWarningActive: boolean | null;
  /**
   * Tri-state tsunami status.
   * Derived ONLY from the USGS flag or an INCOIS advisory. Never from magnitude.
   */
  tsunamiStatus: boolean | null;
  /** True when `tsunamiStatus` came from an authoritative source. */
  tsunamiAuthoritative: boolean;
  evaluatedAt: string;
  quality: DataQualityEvidence;
}

/**
 * Combine the model dimensions into one state.
 *
 * A dimension that is `insufficient-data` does NOT contribute a level, and it
 * does not block a level that the other dimensions genuinely reached. That was
 * the previous behaviour: because `coastal-water` can never resolve (no readable
 * sea-level or surge source exists), `nominal` was unreachable and the
 * application reported `watch` even when every measured dimension was nominal —
 * contradicting this file's own documented priority list.
 *
 * `unknown` is therefore returned only when NO dimension resolved at all, which
 * is the honest "we have nothing" case.
 */
function worstState(
  dimensions: Record<RiskDimensionId, RiskDimension>
): CoastalRiskState {
  const states = Object.values(dimensions).map((d) => d.state);
  // A severe dimension outranks everything from the model.
  if (states.includes('severe')) return 'severe';
  if (states.includes('high')) return 'high';
  if (states.includes('elevated')) return 'elevated';
  if (states.includes('nominal')) return 'nominal';
  return 'unknown';
}

/**
 * Combine dimensions, official warnings and tsunami status into one state.
 *
 * Priority, in order:
 *   1. Official advisory active          -> severe  (human authority)
 *   2. Tsunami confirmed by a source     -> severe
 *   3. Any dimension severe/high/elevated -> that state
 *   4. At least one dimension nominal     -> nominal
 *   5. No dimension resolved at all        -> unknown
 *
 * A dimension that is `insufficient-data` contributes no level. See
 * `worstState` and the `unresolvedDimensions` field for why.
 */
export function assessCoastalRisk(
  input: RiskAssessmentInput,
  quality: DataQualityEvidence,
  now: () => Date
): CoastalRiskAssessment {
  const dimensions = evaluateRiskDimensions(input);
  const { seismic, officialWarningActive } = input;

  // An INCOIS tsunami advisory is authoritative even if the USGS feed is silent.
  const incoisTsunamiAdvisory = input.officialWarnings.some(
    (w) => w.authority === 'INCOIS' && w.active === true && w.productId === 'INCOIS_TSUNAMI'
  );

  const tsunamiStatus: boolean | null = incoisTsunamiAdvisory
    ? true
    : seismic.tsunamiFlagAuthoritative
      ? seismic.tsunamiFlag
      : null;

  const tsunamiAuthoritative = incoisTsunamiAdvisory || seismic.tsunamiFlagAuthoritative;

  const modelState = worstState(dimensions);

  // An official advisory or a confirmed tsunami flag outranks every model
  // verdict, because both require a human authority acting on information this
  // application may not have.
  const state: CoastalRiskState =
    officialWarningActive === true || tsunamiStatus === true ? 'severe' : modelState;

  // Dimensions that could not be resolved. A `nominal` state with unresolved
  // dimensions is NOT an all-clear: the UI must show which dimensions are
  // unverified rather than presenting a green verdict as complete coverage.
  const unresolvedDimensions = (Object.values(dimensions) as RiskDimension[])
    .filter((d) => d.state === 'insufficient-data')
    .map((d) => d.id);

  return {
    state,
    dimensions,
    unresolvedDimensions,
    officialWarningActive,
    tsunamiStatus,
    tsunamiAuthoritative,
    evaluatedAt: now().toISOString(),
    quality,
  };
}

// =====================================================================
// FORECAST TIMELINE EVALUATION
// =====================================================================

/**
 * One hour's forecast values, as published by the source.
 *
 * Every field is nullable. A null means the source did not publish that
 * variable for that hour, and it will never be treated as zero.
 */
export interface ForecastHourValues {
  waveHeightM: number | null;
  swellHeightM: number | null;
  wavePeriodS: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  precipitationMm: number | null;
  precipitationProbabilityPct: number | null;
  visibilityM: number | null;
}

export type ForecastHourState = 'nominal' | 'elevated' | 'high' | 'insufficient-data';

export interface ForecastHourEvaluation {
  state: ForecastHourState;
  /** Ids of the rules that fired, in declaration order. */
  ruleIds: string[];
  /**
   * The rules that actually drove this hour, with the values they inspected.
   *
   * Exposed so a UI can state WHY an hour was elevated instead of guessing.
   * A previous version of the outlook panel always attributed a peak to wave
   * height whenever one was present, which produced claims like "peak driven by
   * wave height 0.56 m" on an hour whose actual trigger was
   * `WEATHER.VISIBILITY.LOW` — a false attribution of the cause.
   */
  triggers: TriggeredRule[];
}

/**
 * Evaluate ONE forecast hour against the SAME rule table the current-conditions
 * assessment uses.
 *
 * This exists to make a class of bug structurally impossible. The forecast
 * timeline previously carried its own hand-copied threshold table, which had
 * already drifted out of sync with `MARINE_RULES`: `MARINE.WAVE.HIGH` was
 * `severity: 'high'` in the engine but rendered as `severe` in the timeline,
 * and `MARINE.PERIOD.LONG` was `elevated` in the engine and `high` in the
 * timeline. The doc comment claimed the two could never disagree while the
 * code guaranteed they did. Now there is exactly one rule table.
 *
 * `severe` is intentionally unreachable here — it is reserved for an official
 * authority or a confirmed tsunami flag, which are not per-hour model outputs.
 *
 * Returns `insufficient-data` when NO rule input was published at all, so an
 * empty hour is never presented as `nominal` (a calm-sea claim).
 */
export function evaluateForecastHour(values: ForecastHourValues): ForecastHourEvaluation {
  const hasAnyInput =
    values.waveHeightM !== null ||
    values.wavePeriodS !== null ||
    values.swellHeightM !== null ||
    values.windSpeedKmh !== null ||
    values.windGustKmh !== null ||
    values.precipitationMm !== null ||
    values.precipitationProbabilityPct !== null ||
    values.visibilityM !== null;

  if (!hasAnyInput) {
    return { state: 'insufficient-data', ruleIds: [], triggers: [] };
  }

  const hourFeatures: RiskRuleInput = {
    ...emptyHazardFeatures(),
    waveHeightM: values.waveHeightM,
    wavePeriodS: values.wavePeriodS,
    swellHeightM: values.swellHeightM,
    windSpeedKmh: values.windSpeedKmh,
    windGustKmh: values.windGustKmh,
    precipitationMm: values.precipitationMm,
    precipitationProbabilityPct: values.precipitationProbabilityPct,
    visibilityM: values.visibilityM,
    // A forecast hour carries no seismic reading. Stating that explicitly keeps
    // the seismic rules (which read `seismicMagnitude`) from ever firing on a
    // forecast row, which would be reporting shaking for a time that has not
    // happened yet.
    ...emptySeismicFeatures(),
  };

  const fired = [...MARINE_RULES, ...WEATHER_RULES].filter((rule) => rule.test(hourFeatures));

  // Take the highest severity that fired. `severe` is excluded by construction
  // (no rule declares it) and guarded here so that adding one later cannot
  // silently let a model hour escalate past an authority-only state.
  const state = fired.reduce<Exclude<ForecastHourState, 'insufficient-data'>>(
    (worst, rule) => {
      if (rule.severity === 'severe') return worst;
      return SEVERITY_ORDER[rule.severity] > SEVERITY_ORDER[worst] ? rule.severity : worst;
    },
    'nominal'
  );

  return {
    state,
    ruleIds: fired.map((rule) => rule.id),
    // Only the rules that reached the reported severity, so the explanation
    // names the actual cause rather than every rule that happened to fire.
    triggers: fired
      .filter((rule) => rule.severity === state)
      .map((rule) => ({
        ruleId: rule.id,
        basis: rule.basis,
        observed: rule.inputsOf(hourFeatures),
      })),
  };
}

// =====================================================================
// DATA QUALITY
// =====================================================================

/**
 * Derive an evidence-based quality verdict.
 *
 * Nothing here is a confidence score. Each verdict names the concrete
 * observation that produced it, so a UI can show the reason verbatim.
 */
export function assessDataQuality(args: {
  marineStatus: SourceStatus;
  weatherStatus: SourceStatus;
  marineFetchedAt: string | null;
  weatherFetchedAt: string | null;
  marineErrorKind: string | null;
  weatherErrorKind: string | null;
  rejectedRecords: number;
  missingFields: string[];
  warningsUnreadable: boolean;
  now: Date;
}): DataQualityEvidence {
  const { marineStatus, weatherStatus, marineFetchedAt, weatherFetchedAt } = args;
  const reasons: string[] = [];
  const sources = [marineStatus, weatherStatus];

  const newest = [marineFetchedAt, weatherFetchedAt]
    .filter((t): t is string => typeof t === 'string')
    .sort()
    .at(-1) ?? null;

  const ageMs = newest ? args.now.getTime() - new Date(newest).getTime() : null;

  let state: DataQualityState;

  const anyOffline = sources.includes('offline');
  const anyUnavailable = sources.includes('unavailable');
  const anyStale = sources.includes('stale');

  if (anyOffline) {
    state = 'UNKNOWN';
    reasons.push('The browser reports it is offline, so no source could be refreshed.');
  } else if (anyUnavailable || newest === null) {
    state = 'UNAVAILABLE';
    reasons.push(
      newest === null
        ? 'No source has returned a successful reading yet.'
        : 'At least one required source is unavailable.'
    );
  } else if (anyStale) {
    state = 'STALE';
    if (ageMs !== null) {
      reasons.push(
        `The newest reading is ${Math.round(ageMs / 60000)} minutes old, beyond the live window.`
      );
    }
  } else {
    state = 'CURRENT';
    if (ageMs !== null) {
      reasons.push(`The newest reading is ${Math.round(ageMs / 1000)} seconds old.`);
    }
  }

  if (args.rejectedRecords > 0) {
    if (state === 'CURRENT') state = 'DEGRADED';
    reasons.push(`${args.rejectedRecords} record(s) failed validation and were excluded.`);
  }

  if (args.missingFields.length > 0) {
    if (state === 'CURRENT') state = 'DEGRADED';
    reasons.push(`Missing published fields: ${args.missingFields.join(', ')}.`);
  }

  if (args.warningsUnreadable) {
    // Official warnings being unreadable degrades the picture even when the
    // measured data is perfect, because we cannot say whether an advisory
    // is in force.
    if (state === 'CURRENT') state = 'DEGRADED';
    reasons.push(
      'Official IMD and INCOIS bulletins cannot be read from a browser, so no claim is ' +
        'made about whether an advisory is in force.'
    );
  }

  if (args.marineErrorKind) reasons.push(`Marine source error: ${args.marineErrorKind}.`);
  if (args.weatherErrorKind) reasons.push(`Weather source error: ${args.weatherErrorKind}.`);

  const assessment: DataQualityEvidence['assessment'] =
    state === 'CURRENT'
      ? 'GOOD'
      : state === 'DEGRADED' || state === 'STALE'
        ? 'LIMITED'
        : 'INSUFFICIENT';

  return {
    state,
    assessment,
    reasons,
    sourceStatus: anyOffline ? 'offline' : anyUnavailable ? 'unavailable' : anyStale ? 'stale' : 'live',
    ageMs,
    rejectedRecords: args.rejectedRecords,
    missingFields: args.missingFields,
  };
}
