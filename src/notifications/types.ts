/**
 * Shared types for the risk engine, event stream and notification engine.
 */

import type {
  OfficialWarningStatus,
  Provenance,
  SourceStatus,
} from '@/integrations/adapters/types';

export type {
  OfficialWarningStatus,
  Provenance,
  SourceStatus,
} from '@/integrations/adapters/types';

export type { CoastalRiskState, TriggeredRule, RiskDimensionId } from '../risk/engine';

/** One immutable, persisted risk transition. */
export interface CoastalRiskTransition {
  id: string;
  previousState: string;
  newState: string;
  at: string;
  /** Rules responsible for the new state. */
  ruleIds: string[];
  triggeringInputs: {
    label: string;
    previous: number | string | null;
    current: number | string | null;
  }[];
  source: string;
}

/**
 * An entry in the BayWatch event stream.
 *
 * Every event corresponds to a real system action — a state transition, a user
 * action, or a real data arrival. There is no code path that creates an event
 * because a component rendered, because a poll ran, or because a clock ticked.
 * `src/events/transitions.ts` owns that guarantee for polled state.
 */
export type BayWatchEventKind =
  | 'source-recovered'
  | 'source-failed'
  | 'source-unavailable'
  | 'earthquake-received'
  | 'incident-received'
  | 'forecast-changed'
  | 'risk-changed'
  | 'official-warning-detected'
  | 'official-warning-cleared'
  | 'official-warning-unknown'
  | 'tsunami-flag-set'
  | 'tsunami-flag-cleared'
  | 'notification-generated'
  | 'notification-acknowledged'
  | 'voice-generated'
  | 'voice-failed'
  | 'manual-refresh'
  | 'gps-granted'
  | 'gps-denied'
  | 'gps-lost'
  | 'destination-selected'
  | 'route-calculated'
  | 'route-failed'
  | 'went-offline'
  | 'came-online';

export interface BayWatchEvent {
  /** Deterministic id derived from kind + timestamp + discriminator. */
  id: string;
  kind: BayWatchEventKind;
  /** ISO-8601 when this action occurred. */
  at: string;
  /** Short factual description assembled from observed values. */
  summary: string;
  /** Which source or subsystem produced the event. */
  source: string;
  /** Optional link to the official source or triggering record. */
  link: string | null;
  /** Structured payload so the UI can offer real drill-down. */
  data: Record<string, string | number | boolean | null>;
}

let eventCounter = 0;

/**
 * Build an event.
 *
 * `data` must contain only observed values. The caller is responsible for that
 * contract; this function does not invent or default any field.
 */
export function buildEvent(args: {
  kind: BayWatchEventKind;
  at: string;
  summary: string;
  source: string;
  link?: string | null;
  data?: Record<string, string | number | boolean | null>;
}): BayWatchEvent {
  eventCounter += 1;
  return {
    id: `evt_${args.at.replace(/[^0-9]/g, '')}_${args.kind}_${eventCounter}`,
    kind: args.kind,
    at: args.at,
    summary: args.summary,
    source: args.source,
    link: args.link ?? null,
    data: args.data ?? {},
  };
}

/**
 * Deduplicate events by a caller-supplied key.
 *
 * Used when the same real-world event is observed on consecutive polls — for
 * example the same earthquake appearing in two successive USGS reads. The
 * FIRST observation is kept, because that is when the event actually happened.
 */
export function dedupeEvents(
  existing: readonly BayWatchEvent[],
  incoming: readonly BayWatchEvent[],
  keyOf: (event: BayWatchEvent) => string
): BayWatchEvent[] {
  const seen = new Set(existing.map(keyOf));
  const fresh = incoming.filter((event) => {
    const key = keyOf(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...existing, ...fresh];
}
