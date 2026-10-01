import type { SourceStatus } from './types';

/**
 * FRESHNESS POLICY — the single definition of how old a source may be before
 * the UI stops calling it live.
 *
 * The policy is intentionally expressed once, here, and consumed by every
 * adapter and every component. Rationale:
 *
 *  - LIVE_MAX_AGE_MS matches the marine refresh interval (5 min). A payload
 *    younger than one refresh cycle is by definition current.
 *  - STALE_MAX_AGE_MS is the point at which a value stops being useful for an
 *    evacuation decision. Beyond it we report `unavailable` rather than
 *    letting an hour-old wave height read as a current measurement.
 *  - `offline` is reserved for a known-offline browser so the UI can explain
 *    *why* data stopped rather than implying the source failed.
 *
 * Age is measured from `fetchedAt` (when we parsed the body), not from
 * `observedAt` (when the source measured it), because the source timestamp is
 * in the source's timezone and is not a freshness signal we control.
 */
export const LIVE_MAX_AGE_MS = 5 * 60 * 1000;
export const STALE_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Resolve the freshness state of one source reading.
 *
 * @param fetchedAt   ISO timestamp of when the payload was parsed, or null.
 * @param hasData     Whether any usable value survived validation.
 * @param now         Current time (injectable).
 * @param isOnline    Browser connectivity (injectable).
 */
export function resolveFreshness(
  fetchedAt: string | null,
  hasData: boolean,
  now: Date,
  isOnline: boolean
): SourceStatus {
  if (!hasData || !fetchedAt) {
    return isOnline ? 'unavailable' : 'offline';
  }

  const parsed = new Date(fetchedAt).getTime();
  if (Number.isNaN(parsed)) return 'unavailable';

  const age = now.getTime() - parsed;
  // A payload stamped in the future is a clock skew, not fresh data.
  if (age < 0) return 'live';

  if (age <= LIVE_MAX_AGE_MS) return 'live';
  if (age <= STALE_MAX_AGE_MS) return 'stale';
  return 'unavailable';
}

/**
 * How often the shared observation store re-derives freshness.
 *
 * Freshness must age over time even when no new request is made, otherwise a
 * reading would stay labelled LIVE forever until the next poll. This is a UI
 * re-evaluation cadence, not a network cadence.
 */
export const FRESHNESS_TICK_MS = 15 * 1000;

/**
 * True while a source is rate-limiting us and further requests should be held.
 *
 * Open-Meteo answers HTTP 429 without a `Retry-After` header, so we apply a
 * short fixed cooldown. This prevents turning a transient limit into a
 * self-sustaining ban by retrying on every poll tick. It is NOT a retry loop:
 * after the cooldown the normal poll interval resumes.
 */
export const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;