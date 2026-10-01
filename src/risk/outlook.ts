/**
 * Derived 48-hour coastal outlook.
 *
 * ===================================================================
 * WHAT THIS IS, PRECISELY
 * ===================================================================
 *
 * A transparent aggregation. For every published forecast hour it applies the
 * SAME rule table the current-conditions assessment uses
 * (`evaluateForecastHour`), then reports the peak, the direction of travel, and
 * the windows in which the rules fire.
 *
 * Every conclusion is traceable to specific published values through specific
 * named rules. `worstWindow.basis` names the hour, the values that drove it, and
 * the rule ids that fired. If a reader disagrees with the outlook they can check
 * it against the source data without trusting this file.
 *
 * ===================================================================
 * WHAT THIS IS NOT
 * ===================================================================
 *
 * It is not a machine-learning prediction and it is never described as one. It
 * does not extrapolate beyond the published hours, does not smooth values, and
 * does not invent an hour the source did not provide. It contains no fitted
 * coefficients, because there is no model here to fit.
 *
 * It also does not soften or amplify the underlying verdicts. An outlook is
 * exactly as uncertain as the hours it summarises, which is why `confidence` is
 * derived from how much data actually existed and why an outlook built from
 * nothing is `unknown` rather than `nominal`.
 */

import {
  evaluateForecastHour,
  type ForecastHourValues,
  type ForecastHourState,
  type TriggeredRule,
} from '@/risk/engine';

export type OutlookTrend = 'worsening' | 'stable' | 'improving' | 'unknown';

export interface OutlookHour {
  /** ISO-8601 instant of the forecast hour. */
  at: string;
  values: ForecastHourValues;
}

export interface OutlookWindow {
  from: string;
  to: string;
  state: ForecastHourState;
  /** How many consecutive hours reached this state. */
  hours: number;
  /**
   * Why the peak hour reached its state.
   *
   * Present so the projection is auditable rather than merely asserted.
   * `triggers` carries the actual rules that reached the reported severity,
   * together with the values each one inspected, so a UI can state the cause
   * without guessing which variable was responsible.
   */
  basis: {
    at: string;
    ruleIds: string[];
    triggers: TriggeredRule[];
    values: ForecastHourValues;
  } | null;
}

export interface Outlook {
  /** Highest state any hour reached. `null` when nothing was assessable. */
  peakState: ForecastHourState | null;
  peakAt: string | null;
  trend: OutlookTrend;
  /** Contiguous runs at or above `elevated`, worst first. */
  windows: OutlookWindow[];
  hoursAssessed: number;
  hoursExpected: number;
  /** 'complete' | 'partial' | 'none' — how much of the horizon had data. */
  coverage: 'complete' | 'partial' | 'none';
  /** Honest, non-numeric statement of how much to trust this. */
  coverageNote: string;
  limitations: string[];
}

const RANK: Record<ForecastHourState, number> = {
  'insufficient-data': -1,
  nominal: 0,
  elevated: 1,
  high: 2,
};

/** States worth surfacing as a window. Below these it is ordinary conditions. */
const WINDOW_FLOOR: ForecastHourState[] = ['elevated', 'high'];

function isWindow(state: ForecastHourState): boolean {
  return WINDOW_FLOOR.includes(state);
}

/**
 * Build the outlook from published forecast hours.
 *
 * `now` is used only to state the horizon in words; it never filters an hour out
 * of the projection, because the source owns which hours it published.
 */
export function buildOutlook(hours: readonly OutlookHour[], horizonHours = 48): Outlook {
  const limitations = [
    'This is a rule-based aggregation of published forecast hours, not a machine-learning prediction.',
    'Every hour is scored with the same thresholds used for current conditions, so the outlook cannot disagree with the headline verdict.',
    'It reflects only what the source published. Hours the source omitted are absent, not assumed calm.',
    'It does not account for official warnings, which override the model entirely and are handled separately.',
    'Model forecast error grows with lead time; the final hours of the horizon are the least reliable.',
  ];

  if (hours.length === 0) {
    return {
      peakState: null,
      peakAt: null,
      trend: 'unknown',
      windows: [],
      hoursAssessed: 0,
      hoursExpected: horizonHours,
      coverage: 'none',
      coverageNote:
        'No forecast hours were published, so no outlook can be projected. This is not an ' +
        'indication of calm conditions.',
      limitations,
    };
  }

  // --- per-hour evaluation ------------------------------------------------
  const evaluated = hours.map((hour) => ({
    at: hour.at,
    values: hour.values,
    evaluation: evaluateForecastHour(hour.values),
  }));

  const assessable = evaluated.filter((e) => e.evaluation.state !== 'insufficient-data');
  const hoursAssessed = assessable.length;

  if (hoursAssessed === 0) {
    return {
      peakState: null,
      peakAt: null,
      trend: 'unknown',
      windows: [],
      hoursAssessed: 0,
      hoursExpected: horizonHours,
      coverage: 'none',
      coverageNote:
        'The forecast published hours, but none contained a value any coastal rule reads, so ' +
        'no outlook could be derived. Conditions are unknown, not calm.',
      limitations,
    };
  }

  // --- peak ---------------------------------------------------------------
  const peak = assessable.reduce((worst, current) =>
    RANK[current.evaluation.state] > RANK[worst.evaluation.state] ? current : worst,
  );

  // --- windows ------------------------------------------------------------
  // Built by walking EVERY hour in time order, including the ones no rule could
  // read. An unassessable hour terminates the current run rather than being
  // filtered out first, because filtering it out would silently bridge the gap
  // and report one long elevated window across a stretch we cannot actually see.
  const ordered = [...evaluated].sort((a, b) => a.at.localeCompare(b.at));
  const windows: OutlookWindow[] = [];

  let run: typeof ordered = [];
  const flush = () => {
    if (run.length === 0) return;
    const worstHour = run.reduce(
      (worst, h) =>
        RANK[h.evaluation.state] > RANK[worst.evaluation.state] ? h : worst,
      run[0],
    );
    windows.push({
      from: run[0].at,
      to: run[run.length - 1].at,
      state: worstHour.evaluation.state,
      hours: run.length,
      basis: {
        at: worstHour.at,
        ruleIds: worstHour.evaluation.ruleIds,
        triggers: worstHour.evaluation.triggers,
        values: worstHour.values,
      },
    });
    run = [];
  };

  for (const hour of ordered) {
    if (isWindow(hour.evaluation.state)) {
      run.push(hour);
    } else {
      // Both an ordinary hour and a data gap end the current window.
      flush();
    }
  }
  flush();

  // Worst window first, so the most important span is at the top.
  windows.sort((a, b) => RANK[b.state] - RANK[a.state] || b.hours - a.hours);

  // --- trend --------------------------------------------------------------
  // Compares the mean rank of the first third of assessable hours with the last
  // third. A simple, stated comparison of published data — not a fitted model.
  let trend: OutlookTrend = 'unknown';
  const orderedAssessable = ordered.filter((h) => h.evaluation.state !== 'insufficient-data');
  const third = Math.max(1, Math.floor(orderedAssessable.length / 3));
  if (orderedAssessable.length >= 3) {
    const mean = (slice: typeof orderedAssessable) =>
      slice.reduce((sum, h) => sum + RANK[h.evaluation.state], 0) / slice.length;
    const early = mean(orderedAssessable.slice(0, third));
    const late = mean(orderedAssessable.slice(-third));
    // A one-rank change is the smallest difference worth calling a trend; below
    // that the honest description is that it is not moving.
    if (late - early >= 1) trend = 'worsening';
    else if (early - late >= 1) trend = 'improving';
    else trend = 'stable';
  } else {
    trend = 'unknown';
  }

  // --- coverage -----------------------------------------------------------
  const coverage: Outlook['coverage'] =
    hoursAssessed >= horizonHours * 0.75 ? 'complete' : hoursAssessed > 0 ? 'partial' : 'none';

  const coverageNote =
    coverage === 'complete'
      ? `All ${hoursAssessed} of ${horizonHours} forecast hours carried usable data.`
      : `${hoursAssessed} of ${horizonHours} forecast hours carried usable data. The rest were ` +
        'not published, so the outlook is built from a partial horizon and gaps are shown as ' +
        'neither safe nor unsafe.';

  return {
    peakState: peak.evaluation.state,
    peakAt: peak.at,
    trend,
    windows,
    hoursAssessed,
    hoursExpected: horizonHours,
    coverage,
    coverageNote,
    limitations,
  };
}

/** Plain-language summary. Never claims more certainty than `coverage` allows. */
export function describeOutlook(outlook: Outlook): string {
  if (outlook.coverage === 'none' || outlook.peakState === null) {
    return 'Outlook unknown — insufficient forecast data to project conditions.';
  }

  const peakWord =
    outlook.peakState === 'high'
      ? 'high'
      : outlook.peakState === 'elevated'
        ? 'elevated'
        : 'nominal';
  const trendWord =
    outlook.trend === 'worsening'
      ? 'and worsening toward the end of the horizon'
      : outlook.trend === 'improving'
        ? 'and easing toward the end of the horizon'
        : outlook.trend === 'stable'
          ? 'and broadly steady across the horizon'
          : '';

  const windowNote =
    outlook.windows.length > 0
      ? ` ${outlook.windows.length} elevated window${outlook.windows.length === 1 ? '' : 's'} identified.`
      : ' No hour in the horizon crosses the elevated threshold.';

  return `Projected peak is ${peakWord} ${trendWord}.${windowNote} ${outlook.coverageNote}`;
}
