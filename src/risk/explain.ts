/**
 * "Why did this change?" — explanations and risk-transition tracking.
 *
 * Every sentence this module produces is assembled from values that were
 * actually observed in application state. There is no template that can invent
 * a measurement: if a value is null the explanation says it is unavailable,
 * because that is what null means.
 *
 * An explanation is never a generated narrative. It is a deterministic
 * rendering of (previous feature values -> current feature values, plus the
 * rule that fired).
 */

import type { OfficialWarningStatus, Provenance } from '@/integrations/adapters/types';
import {
  FEATURE_LABELS,
  type CoastalRiskAssessment,
  type CoastalRiskState,
  type HazardFeatures,
  type RiskDimension,
  type RiskDimensionId,
  type RiskTransitionCandidate,
} from './engine';

export type ExplanationKind =
  | 'escalation'
  | 'de-escalation'
  | 'unchanged'
  | 'initial'
  | 'insufficient-data'
  | 'official-warning';

export interface FeatureChange {
  /** Stable feature key. */
  key: keyof HazardFeatures;
  label: string;
  previous: number | string | null;
  current: number | string | null;
  /** How the value moved, derived by comparison only. */
  direction: 'up' | 'down' | 'same' | 'unknown';
  unitHint?: string;
}

export interface RiskExplanation {
  kind: ExplanationKind;
  /** One-line verdict, e.g. "Marine risk increased." */
  headline: string;
  previousState: CoastalRiskState;
  newState: CoastalRiskState;
  /** Field-by-field movement that supports the change. */
  observedChanges: FeatureChange[];
  /** Rule ids that fired, with the documented basis. */
  rules: { ruleId: string; basis: string; observed: (string | number | null)[] }[];
  /** Exactly what the official-warning sources reported, including unknowns. */
  officialWarning: {
    active: boolean | null;
    summary: string;
    perProduct: {
      productId: string;
      label: string;
      active: boolean | null;
      blockerDetail: string | null;
      url: string;
    }[];
  };
  tsunami: {
    status: boolean | null;
    authoritative: boolean;
    summary: string;
  };
  quality: { state: string; assessment: string; reasons: string[] };
  /** When the engine evaluated this. ISO-8601. */
  evaluatedAt: string;
  /** The sources that fed this explanation. */
  sources: Provenance[];
}

const STATE_LABELS: Record<CoastalRiskState, string> = {
  nominal: 'Nominal',
  watch: 'Watch',
  elevated: 'Elevated',
  high: 'High',
  severe: 'Severe',
  unknown: 'Unknown',
};

/** Rank used to detect escalation vs de-escalation. `unknown` is unordered. */
const STATE_RANK: Record<CoastalRiskState, number | null> = {
  nominal: 0,
  watch: 1,
  elevated: 2,
  high: 3,
  severe: 4,
  unknown: null,
};

export function formatState(state: CoastalRiskState): string {
  return STATE_LABELS[state];
}

function directionOf(
  previous: number | string | null,
  current: number | string | null
): FeatureChange['direction'] {
  if (typeof previous === 'number' && typeof current === 'number') {
    if (current > previous) return 'up';
    if (current < previous) return 'down';
    return 'same';
  }
  if (previous === null && current !== null) return 'unknown';
  if (previous !== null && current === null) return 'unknown';
  return 'same';
}

const UNIT_HINTS: Partial<Record<keyof HazardFeatures, string>> = {
  waveHeightM: 'm',
  swellHeightM: 'm',
  wavePeriodS: 's',
  windSpeedKmh: 'km/h',
  windGustKmh: 'km/h',
  precipitationMm: 'mm/h',
  precipitationProbabilityPct: '%',
  visibilityM: 'm',
  waveDirectionDeg: 'deg',
  windDirectionDeg: 'deg',
  swellDirectionDeg: 'deg',
  seaSurfaceTemperatureC: 'C',
};

/**
 * Compute the field-level movement between two readings.
 *
 * Only features present in EITHER reading are reported, so the panel never
 * lists a field that never changed and never had a value.
 */
export function computeFeatureChanges(
  previous: HazardFeatures | null,
  current: HazardFeatures
): FeatureChange[] {
  const keys = new Set<keyof HazardFeatures>([
    ...Object.keys(current) as (keyof HazardFeatures)[],
    ...(previous ? (Object.keys(previous) as (keyof HazardFeatures)[]) : []),
  ]);

  const changes: FeatureChange[] = [];

  for (const key of keys) {
    // Status and retrieval stamps are provenance, not hazard movement.
    if (
      key === 'marineStatus' ||
      key === 'weatherStatus' ||
      key === 'marineFetchedAt' ||
      key === 'weatherFetchedAt'
    ) {
      continue;
    }

    const before = previous ? previous[key] : null;
    const after = current[key];

    // Unchanged between two known values, or absent from both: not a change.
    if (before === after && before !== null) continue;
    if (before === null && after === null) continue;

    changes.push({
      key,
      label: FEATURE_LABELS[key],
      previous: before,
      current: after,
      direction: previous === null ? 'unknown' : directionOf(before, after),
      unitHint: UNIT_HINTS[key],
    });
  }

  return changes;
}

/**
 * Build the explanation for a risk state.
 *
 * `previousFeatures` is null on the first evaluation, which yields an
 * `initial` explanation: the state, its basis, and an explicit note that no
 * prior reading exists to compare against.
 */
export function buildRiskExplanation(args: {
  assessment: CoastalRiskAssessment;
  previousFeatures: HazardFeatures | null;
  currentFeatures: HazardFeatures;
  previousState: CoastalRiskState | null;
  officialWarnings: readonly OfficialWarningStatus[];
  sources: Provenance[];
}): RiskExplanation {
  const {
    assessment,
    previousFeatures,
    currentFeatures,
    previousState,
    officialWarnings,
    sources,
  } = args;
  const { state, dimensions, officialWarningActive, tsunamiStatus, tsunamiAuthoritative, quality, evaluatedAt } =
    assessment;

  const observedChanges = computeFeatureChanges(previousFeatures, currentFeatures);

  const rules = Object.values(dimensions).flatMap((d: RiskDimension) =>
    d.triggered.map((t) => ({
      ruleId: t.ruleId,
      basis: t.basis,
      observed: t.observed,
    }))
  );

  const changedDimensions = Object.values(dimensions).filter(
    (d) => d.state === 'insufficient-data'
  );

  let kind: ExplanationKind;
  let headline: string;

  if (previousState === null) {
    kind = 'initial';
    headline = `Coastal state assessed as ${formatState(state)}.`;
  } else if (previousState === state) {
    kind = 'unchanged';
    headline = `Coastal state remains ${formatState(state)}.`;
  } else {
    const before = STATE_RANK[previousState];
    const after = STATE_RANK[state];
    // unknown is not on the scale; treat any move into or out of it as
    // an information change rather than a severity change.
    if (before === null || after === null) {
      kind = 'insufficient-data';
      headline =
        previousState === 'unknown'
          ? `Coastal state is now ${formatState(state)}; data availability changed.`
          : `Coastal state is now ${formatState(state)}; some required data is unavailable.`;
    } else if (after > before) {
      kind = 'escalation';
      headline = `Coastal risk increased from ${formatState(previousState)} to ${formatState(state)}.`;
    } else {
      kind = 'de-escalation';
      headline = `Coastal risk decreased from ${formatState(previousState)} to ${formatState(state)}.`;
    }
  }

  if (officialWarningActive === true) {
    kind = 'official-warning';
    headline = `An official warning is active. Coastal state is ${formatState(state)}.`;
  }

  return {
    kind,
    headline,
    previousState: previousState ?? 'unknown',
    newState: state,
    observedChanges,
    rules,
    officialWarning: {
      active: officialWarningActive,
      summary: describeWarningSummary(officialWarnings),
      perProduct: officialWarnings.map((w) => ({
        productId: w.productId,
        label: w.label,
        active: w.active,
        blockerDetail: w.blockerDetail,
        url: w.url,
      })),
    },
    tsunami: {
      status: tsunamiStatus,
      authoritative: tsunamiAuthoritative,
      summary: describeTsunami(tsunamiStatus, tsunamiAuthoritative),
    },
    quality: { state: quality.state, assessment: quality.assessment, reasons: quality.reasons },
    evaluatedAt,
    sources,
  };
}

/**
 * Describe the official-warning situation truthfully.
 *
 * Distinguishes three cases that must never be conflated:
 *   none active / an advisory IS active / we could not determine it.
 */
function describeWarningSummary(warnings: readonly OfficialWarningStatus[]): string {
  if (warnings.length === 0) return 'No official warning products are configured.';

  const active = warnings.filter((w) => w.active === true);
  if (active.length > 0) {
    return `Active: ${active.map((a) => a.label).join('; ')}.`;
  }

  const unknown = warnings.filter((w) => w.active === null);
  if (unknown.length > 0) {
    return (
      `UNKNOWN. ${unknown.length} of ${warnings.length} official bulletin(s) could not be ` +
      'read from this browser, so no claim can be made that no warning is in force.'
    );
  }

  return 'All configured bulletins were read and report no active warning.';
}

/**
 * Describe tsunami status without ever implying a prediction.
 *
 * null means the USGS flag was absent/unreadable AND no INCOIS advisory was
 * readable — explicitly "unknown", never "no tsunami".
 */
function describeTsunami(status: boolean | null, authoritative: boolean): string {
  if (status === true) {
    return authoritative
      ? 'An official or USGS tsunami flag is present for a recent regional event.'
      : 'Tsunami flag reported.';
  }
  if (status === false) {
    return authoritative
      ? 'USGS published an explicit non-tsunami flag for the regional event. This is not a tsunami prediction.'
      : 'Not flagged.';
  }
  return (
    'UNKNOWN. No readable source published a tsunami flag for the regional events. ' +
    'This is not an all-clear.'
  );
}

/**
 * Detect a state transition between two evaluations.
 *
 * Returns null when nothing changed, so a polling loop that calls this every
 * cycle produces exactly one transition record per real change — this is what
 * makes notification deduplication possible.
 */
export function detectTransition(args: {
  previousState: CoastalRiskState | null;
  previousFeatures: HazardFeatures | null;
  currentFeatures: HazardFeatures;
  assessment: CoastalRiskAssessment;
  at: string;
  source: string;
}): RiskTransitionCandidate | null {
  const { previousState, previousFeatures, currentFeatures, assessment, at, source } = args;

  if (previousState === null) return null;
  if (previousState === assessment.state) return null;

  const changes = computeFeatureChanges(previousFeatures, currentFeatures);

  return {
    previousState,
    newState: assessment.state,
    ruleIds: Object.values(assessment.dimensions).flatMap((d) =>
      d.triggered.map((t) => t.ruleId)
    ),
    triggeringInputs: changes.map((c) => ({
      label: c.label,
      previous: c.previous,
      current: c.current,
    })),
    at,
    source,
  };
}

export { STATE_RANK };
