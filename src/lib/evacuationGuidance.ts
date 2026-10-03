import type { CoastalRiskAssessment } from '@/risk/engine';

/**
 * Risk-aware evacuation guidance, as a pure function of the canonical
 * assessment.
 *
 * DETERMINISTIC RULE — no invented triggers:
 *
 *   evacuate:  state is severe/high, OR an official warning is active, OR an
 *              authoritative tsunami flag is present
 *   prepare:   state is elevated/watch
 *   normal:    state is nominal with no active official warning
 *   unknown:   state is unknown, or the verdict cannot be established
 *
 * Pure (no React, no network) so the rule is directly testable and identical
 * everywhere it is shown. The UI in `EvacuationMap` renders `title`/`detail`
 * verbatim, so what is tested here is what the operator reads.
 */

export type EvacuationGuidanceMode = 'evacuate' | 'prepare' | 'normal' | 'unknown' | 'unavailable';

export interface EvacuationGuidance {
  mode: EvacuationGuidanceMode;
  title: string;
  detail: string;
  /** The observed facts that produced this mode. Shown, not hidden. */
  triggers: string[];
}

export function evacuationGuidanceFor(
  assessment: CoastalRiskAssessment | null
): EvacuationGuidance {
  if (!assessment) {
    return {
      mode: 'unavailable',
      title: 'Risk state unavailable here',
      detail:
        'This panel cannot read the coastal assessment, so it offers navigation only — no evacuation recommendation.',
      triggers: [],
    };
  }

  const warningActive = assessment.officialWarningActive === true;
  const tsunami =
    assessment.tsunamiStatus === true && assessment.tsunamiAuthoritative === true;
  const triggers: string[] = [];
  if (assessment.state === 'severe' || assessment.state === 'high') {
    triggers.push(`AAPDA SETU risk state is ${assessment.state}`);
  }
  if (warningActive) triggers.push('an official IMD/INCOIS warning is active');
  if (tsunami) triggers.push('an authoritative tsunami flag is present');

  if (triggers.length > 0) {
    return {
      mode: 'evacuate',
      title: 'Evacuation guidance',
      detail:
        `Consider moving to a candidate facility now: ${triggers.join('; ')}. ` +
        'Pick the nearest destination and follow its road route. Confirm with your ward office or NDMA before travelling.',
      triggers,
    };
  }

  if (assessment.state === 'elevated' || assessment.state === 'watch') {
    return {
      mode: 'prepare',
      title: 'Be prepared to move',
      detail: `AAPDA SETU risk state is ${assessment.state}. No evacuation is indicated, but identify a destination while conditions are calm.`,
      triggers: [`AAPDA SETU risk state is ${assessment.state}`],
    };
  }

  if (assessment.state === 'nominal' && assessment.officialWarningActive === false) {
    return {
      mode: 'normal',
      title: 'Normal navigation',
      detail:
        'No monitored threshold is crossed and readable bulletins report no active warning. Destinations are for orientation only.',
      triggers: [],
    };
  }

  return {
    mode: 'unknown',
    title: 'Risk unknown — check official sources',
    detail:
      'The current risk could not be established (a required source is unreadable). This panel offers navigation only. Do not treat the absence of a recommendation as an all-clear.',
    triggers: [],
  };
}
