/**
 * Transition-based event detection.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The event stream previously recorded one entry per polling cycle. A 10-minute
 * marine poll produced a `source-updated` event every 10 minutes forever, and a
 * 5-minute USGS poll produced an `earthquake-received` event every 5 minutes
 * even when the feed was byte-identical. That is not an event stream, it is a
 * heartbeat log: it buries the handful of entries an operator actually needs.
 *
 * The contract enforced here:
 *
 *   - A render is not an event.
 *   - A poll is not an event.
 *   - An unchanged value is not an event.
 *   - Re-observing the same condition is not a new event.
 *
 * An entry is produced only when a COMPARABLE value actually changes. To keep
 * that meaningful for continuous measurements, values are compared as the set of
 * risk rules they trigger rather than as raw floats, so a wave height drifting
 * from 0.58 m to 0.59 m is correctly silent, while crossing the 2.1 m threshold
 * produces exactly one event.
 *
 * Everything here is a pure function of (previous, next). React is not involved,
 * so the behaviour is directly testable and identical on the server.
 */

import type { CoastalRiskAssessment, RiskDimensionId } from '@/risk/engine';
import type { OfficialWarningStatus, SourceStatus } from '@/integrations/adapters/types';
import type { BayWatchEvent, BayWatchEventKind } from '@/notifications/types';
import { buildEvent } from '@/notifications/types';

/**
 * A comparable projection of everything the event stream watches.
 *
 * Only values that change the OPERATIONAL PICTURE belong here. Anything derived
 * purely for display (selected tab, expanded panel, current clock) must never
 * appear, or it would generate an event on every interaction.
 */
export interface ObservationSnapshot {
  /** Freshness of each polled source. */
  marineStatus: SourceStatus;
  weatherStatus: SourceStatus;
  seismicStatus: SourceStatus;

  /**
   * The rule ids currently firing, per dimension.
   *
   * Comparing rule sets rather than raw numbers is what makes this stable: the
   * snapshot only changes when a documented threshold is actually crossed.
   */
  triggeredRulesByDimension: Record<RiskDimensionId, string[]>;

  /** Canonical overall verdict. */
  riskState: string;
  /** Dimensions that could not be resolved. */
  unresolvedDimensions: string[];

  /** Tri-state official warning verdict. `null` means UNKNOWN, never "none". */
  officialWarningActive: boolean | null;
  /** Which authority/product the verdict came from, when known. */
  officialWarningAuthority: string | null;

  /** Tri-state tsunami status from an authoritative source. */
  tsunamiStatus: boolean | null;

  /** Stable ids of the regional earthquakes currently listed by USGS. */
  earthquakeIds: string[];

  /** Newest marine measurement's rounded wave height, for the summary line. */
  waveHeightM: number | null;
  /** Newest marine measurement's wave period. */
  wavePeriodS: number | null;
  /** Newest weather measurement's wind speed. */
  windSpeedKmh: number | null;
  /** Newest weather measurement's gust. */
  windGustKmh: number | null;
}

/** A snapshot representing "nothing observed yet". */
export function emptyObservationSnapshot(): ObservationSnapshot {
  return {
    marineStatus: 'unavailable',
    weatherStatus: 'unavailable',
    seismicStatus: 'unavailable',
    triggeredRulesByDimension: {
      marine: [],
      weather: [],
      'coastal-water': [],
      seismic: [],
    },
    riskState: 'unknown',
    unresolvedDimensions: [],
    officialWarningActive: null,
    officialWarningAuthority: null,
    tsunamiStatus: null,
    earthquakeIds: [],
    waveHeightM: null,
    wavePeriodS: null,
    windSpeedKmh: null,
    windGustKmh: null,
  };
}

/**
 * Build a snapshot from real application state.
 *
 * The rule sets come straight from the assessment, so an event can always name
 * the documented threshold that caused it.
 */
export function snapshotFromState(args: {
  assessment: CoastalRiskAssessment;
  marineStatus: SourceStatus;
  weatherStatus: SourceStatus;
  seismicStatus: SourceStatus;
  officialWarningAuthority: string | null;
  earthquakeIds: string[];
  waveHeightM: number | null;
  wavePeriodS: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
}): ObservationSnapshot {
  const { assessment } = args;
  const triggered = {} as Record<RiskDimensionId, string[]>;
  for (const [id, dimension] of Object.entries(assessment.dimensions)) {
    triggered[id as RiskDimensionId] = dimension.triggered.map((t) => t.ruleId).sort();
  }
  return {
    marineStatus: args.marineStatus,
    weatherStatus: args.weatherStatus,
    seismicStatus: args.seismicStatus,
    triggeredRulesByDimension: triggered,
    riskState: assessment.state,
    unresolvedDimensions: assessment.unresolvedDimensions ?? [],
    officialWarningActive: assessment.officialWarningActive,
    officialWarningAuthority: args.officialWarningAuthority,
    tsunamiStatus: assessment.tsunamiStatus,
    earthquakeIds: [...args.earthquakeIds].sort(),
    waveHeightM: args.waveHeightM,
    wavePeriodS: args.wavePeriodS,
    windSpeedKmh: args.windSpeedKmh,
    windGustKmh: args.windGustKmh,
  };
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

const DIMENSION_LABEL: Record<RiskDimensionId, string> = {
  marine: 'Marine conditions',
  weather: 'Weather conditions',
  'coastal-water': 'Coastal water',
  seismic: 'Seismic activity',
};

/** One real, state-changing occurrence. */
interface ObservationChange {
  kind: BayWatchEventKind;
  summary: string;
  source: string;
  data: Record<string, string | number | boolean | null>;
  link?: string | null;
}

function fmt(value: number | null, unit: string, digits = 2): string {
  return value === null || value === null || !Number.isFinite(value) ? 'unavailable' : `${value.toFixed(digits)}${unit}`;
}

/**
 * Diff two snapshots and describe what genuinely changed.
 *
 * Returns an empty array when nothing observable changed, which is the common
 * case and must stay silent.
 */
export function diffSnapshots(
  previous: ObservationSnapshot,
  next: ObservationSnapshot
): ObservationChange[] {
  const changes: ObservationChange[] = [];
  const firstObservation = previous.earthquakeIds.length === 0 && previous.riskState === 'unknown';

  // --- source availability -------------------------------------------
  // Availability is a genuine transition: a source becoming unavailable, or
  // recovering, changes what the whole application is allowed to claim.
  if (!firstObservation) {
    for (const [key, label] of [
      ['marine', 'Open-Meteo Marine'],
      ['weather', 'Open-Meteo Forecast'],
      ['seismic', 'USGS Earthquake Hazards Program'],
    ] as const) {
      const before = previous[`${key}Status` as keyof ObservationSnapshot] as SourceStatus;
      const after = next[`${key}Status` as keyof ObservationSnapshot] as SourceStatus;
      if (before === after) continue;

      const recovered = before !== 'live' && after === 'live';
      const lost = before === 'live' && after !== 'live';
      if (!recovered && !lost) continue;

      changes.push({
        kind: lost ? 'source-failed' : 'source-recovered',
        summary: recovered
          ? `${label} recovered (${after})`
          : `${label} became ${after}`,
        source: label,
        data: { source: key, from: before, to: after },
      });
    }
  }

  // --- threshold crossings --------------------------------------------
  // The operative signal: a documented risk rule started or stopped firing.
  for (const id of Object.keys(next.triggeredRulesByDimension) as RiskDimensionId[]) {
    const before = previous.triggeredRulesByDimension[id] ?? [];
    const after = next.triggeredRulesByDimension[id] ?? [];
    if (sameArray(before, after)) continue;

    const started = after.filter((r) => !before.includes(r));
    const stopped = before.filter((r) => !after.includes(r));
    const parts: string[] = [];
    if (started.length) parts.push(`threshold crossed: ${started.join(', ')}`);
    if (stopped.length) parts.push(`threshold cleared: ${stopped.join(', ')}`);

    changes.push({
      kind: 'forecast-changed',
      summary: `${DIMENSION_LABEL[id]} — ${parts.join('; ')}`,
      source: 'BayWatch risk engine',
      data: {
        dimension: id,
        started: started.join(',') || null,
        stopped: stopped.join(',') || null,
        waveHeightM: next.waveHeightM,
        wavePeriodS: next.wavePeriodS,
        windSpeedKmh: next.windSpeedKmh,
        windGustKmh: next.windGustKmh,
      },
    });
  }

  // --- risk state ------------------------------------------------------
  if (!firstObservation && previous.riskState !== next.riskState) {
    changes.push({
      kind: 'risk-changed',
      summary: `Coastal risk ${previous.riskState} → ${next.riskState}`,
      source: 'BayWatch risk engine',
      data: { from: previous.riskState, to: next.riskState },
    });
  }

  // --- official warning ------------------------------------------------
  if (!firstObservation && previous.officialWarningActive !== next.officialWarningActive) {
    if (next.officialWarningActive === true) {
      changes.push({
        kind: 'official-warning-detected',
        summary: `Official warning reported active by ${next.officialWarningAuthority ?? 'an authority'}`,
        source: next.officialWarningAuthority ?? 'IMD / INCOIS',
        data: { active: true, authority: next.officialWarningAuthority },
      });
    } else if (next.officialWarningActive === false) {
      changes.push({
        kind: 'official-warning-cleared',
        summary: 'Readable official bulletins report no active warning',
        source: next.officialWarningAuthority ?? 'IMD / INCOIS',
        data: { active: false, authority: next.officialWarningAuthority },
      });
    } else {
      changes.push({
        kind: 'official-warning-unknown',
        summary: 'Official warning status is no longer verifiable from this client',
        source: 'IMD / INCOIS',
        data: { active: null },
      });
    }
  }

  // --- tsunami flag ----------------------------------------------------
  if (!firstObservation && previous.tsunamiStatus !== next.tsunamiStatus) {
    if (next.tsunamiStatus === true) {
      changes.push({
        kind: 'tsunami-flag-set',
        summary: 'An authoritative source reports a tsunami flag for a regional event',
        source: 'USGS / INCOIS',
        data: { tsunami: true },
      });
    } else {
      changes.push({
        kind: 'tsunami-flag-cleared',
        summary: 'No tsunami flag is currently reported for regional events',
        source: 'USGS / INCOIS',
        data: { tsunami: false },
      });
    }
  }

  // --- seismic events --------------------------------------------------
  // Only ids we have not seen before. Re-seeing the same earthquake on the next
  // poll is not a new earthquake.
  const seenBefore = new Set(previous.earthquakeIds);
  const fresh = next.earthquakeIds.filter((id) => !seenBefore.has(id));
  if (fresh.length > 0) {
    changes.push({
      kind: 'earthquake-received',
      summary:
        fresh.length === 1
          ? 'New regional earthquake listed by USGS'
          : `${fresh.length} new regional earthquakes listed by USGS`,
      source: 'USGS',
      link: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      data: { newEvents: fresh.length, eventIds: fresh.join(',') },
    });
  }

  return changes;
}

/**
 * Fold a transition list into the event stream.
 *
 * Newest-first, capped, and deduplicated by `kind` + `data` so that an
 * identical transition cannot be recorded twice even if the same change is
 * observed again after an intermediate reload.
 */
export function mergeEvents(
  existing: readonly BayWatchEvent[],
  changes: readonly ObservationChange[],
  at: string
): BayWatchEvent[] {
  if (changes.length === 0) return [...existing];

  const built = changes.map((change) =>
    buildEvent({
      kind: change.kind,
      at,
      summary: change.summary,
      source: change.source,
      link: change.link ?? null,
      data: change.data,
    })
  );

  const seen = new Set(existing.map(eventIdentity));
  const fresh = built.filter((event) => !seen.has(eventIdentity(event)));

  // Deduplicate within this batch too: two changes of the same kind with the
  // same payload are one event, not two.
  const batchSeen = new Set<string>();
  const unique = fresh.filter((event) => {
    const key = eventIdentity(event);
    if (batchSeen.has(key)) return false;
    batchSeen.add(key);
    return true;
  });

  return [...unique.reverse(), ...existing].slice(0, MAX_EVENTS);
}

/**
 * Identity used for deduplication: kind plus the distinguishing payload, with
 * the timestamp deliberately EXCLUDED.
 *
 * Excluding the timestamp is the point. It means "this exact transition" is
 * recognised across polls, so a source that flaps unavailable/available cannot
 * spam the stream, while a genuinely new occurrence with different values still
 * produces a new entry.
 */
function eventIdentity(event: BayWatchEvent): string {
  const payload = Object.keys(event.data)
    .sort()
    .map((k) => `${k}=${String(event.data[k])}`)
    .join('|');
  return `${event.kind}::${payload}`;
}

export const MAX_EVENTS = 120;
