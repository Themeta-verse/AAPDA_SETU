/**
 * A single process-wide event bus for action events.
 *
 * WHY THIS EXISTS
 * ---------------
 * Polled-state events are derived in `useCoastalIntelligence` from real
 * transitions. Action events — the user allowing location access, a route being
 * calculated, a voice alert being produced, a manual refresh — originate in
 * components that have no business owning an event stream of their own.
 *
 * Rather than give each component a parallel log (which is how a stream ends up
 * split across three places and none of them authoritative), they publish here
 * and the one owner of the stream folds them in. There is exactly ONE event
 * stream in this application.
 *
 * This module holds no domain logic. It only carries events that already
 * describe something that genuinely happened.
 */

import type { BayWatchEvent, BayWatchEventKind } from '@/notifications/types';
import { buildEvent } from '@/notifications/types';

export interface ActionEventInput {
  kind: BayWatchEventKind;
  summary: string;
  source: string;
  link?: string | null;
  data?: Record<string, string | number | boolean | null>;
  /** ISO-8601. Defaults to now; injectable for tests. */
  at?: string;
}

type Listener = (event: BayWatchEvent) => void;

const listeners = new Set<Listener>();

/** Publish a real action event to the single stream. */
export function publishActionEvent(input: ActionEventInput): BayWatchEvent {
  const event = buildEvent({
    kind: input.kind,
    at: input.at ?? new Date().toISOString(),
    summary: input.summary,
    source: input.source,
    link: input.link ?? null,
    data: input.data ?? {},
  });
  for (const listener of listeners) listener(event);
  return event;
}

/** Subscribe to action events. Returns an unsubscribe function. */
export function subscribeToActionEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: drop every subscriber and any queued state. */
export function resetActionEventsForTests(): void {
  listeners.clear();
}
