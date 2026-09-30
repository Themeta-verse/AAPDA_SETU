/**
 * Notification engine.
 *
 * Two problems this solves, both of which a naive implementation gets wrong:
 *
 *  1. REPEATED NOTIFICATIONS. The monitoring loop polls every few minutes. A
 *     hazard that persists across ten polls must produce ONE notification, not
 *     ten. Deduplication is keyed on an EVENT KEY derived from the source
 *     identity plus the condition, not on time.
 *
 *  2. FALSE CERTAINTY. A notification is only generated from a rule that
 *     actually fired against observed data. No rule here can fire on "no data".
 *     In particular, `TSUNAMA_UNKNOWN` is deliberately NOT a notification:
 *     repeating "we don't know" every cycle trains users to ignore alerts.
 *     Instead, unknown state is surfaced in the data-quality panel.
 *
 * Persistence uses localStorage so an acknowledged alert stays acknowledged
 * across reloads. Failure to persist is non-fatal: notifications still work for
 * the session and the UI says persistence is unavailable.
 */

import type { SourceStatus } from '@/integrations/adapters/types';
import type { CoastalRiskState, CoastalRiskTransition, TriggeredRule } from './types';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export type NotificationRuleId =
  | 'RISK_ESCALATED'
  | 'OFFICIAL_WARNING_ACTIVE'
  | 'TSUNAMA_FLAG_SET'
  | 'MAJOR_EARTHQUAKE'
  | 'FORECAST_DETERIORATION'
  | 'SOURCE_UNAVAILABLE';

export interface BayWatchNotification {
  /** Stable id derived from the event key. */
  id: string;
  /**
   * Identity of the underlying real-world event.
   *
   * Two polls of the same condition produce the SAME key, which is what makes
   * deduplication work across the polling cycle.
   */
  eventKey: string;
  rule: NotificationRuleId;
  severity: NotificationSeverity;
  title: string;
  /** Assembled strictly from observed values. Never a template with blanks. */
  detail: string;
  createdAt: string;
  acknowledgedAt: string | null;
  source: string;
  /** Risk state at the moment the notification was raised. */
  riskState: CoastalRiskState | null;
  /** Rule ids from the risk engine that produced it, when applicable. */
  triggeredRuleIds: string[];
  /** Optional link to the triggering event or official source. */
  link: string | null;
}

export type NotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

export interface NotificationEngineState {
  notifications: BayWatchNotification[];
  permission: NotificationPermissionState;
  /** True when localStorage could not be used. */
  persistenceUnavailable: boolean;
  unacknowledgedCount: number;
}

const STORAGE_KEY = 'baywatch.notifications.v1';
const MAX_STORED = 50;

/**
 * Event keys.
 *
 * These deliberately include the VALUE that caused the alert, so a hazard that
 * persists at the same level does not re-notify, but a genuinely different
 * hazard does. The risk-state escalation key includes both states for the same
 * reason: normal -> elevated once, but elevated -> high later.
 */
export function buildEventKey(parts: {
  rule: NotificationRuleId;
  discriminator: string;
  detail?: string;
}): string {
  const base = `${parts.rule}:${parts.discriminator}`;
  return parts.detail ? `${base}:${parts.detail}` : base;
}

function stableId(eventKey: string): string {
  // FNV-1a. Deterministic, dependency-free, and stable across reloads so a
  // re-raised key maps to the same record.
  let hash = 0x811c9dc5;
  for (let i = 0; i < eventKey.length; i += 1) {
    hash ^= eventKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `ntf_${hash.toString(36)}_${eventKey.length.toString(36)}`;
}

/**
 * A candidate notification produced by a rule.
 * Returned before deduplication so the decision is testable in isolation.
 */
export interface NotificationCandidate {
  rule: NotificationRuleId;
  severity: NotificationSeverity;
  title: string;
  detail: string;
  eventKey: string;
  source: string;
  link?: string | null;
  riskState?: CoastalRiskState | null;
  triggeredRuleIds?: string[];
}

export interface NotificationEvaluationInput {
  riskState: CoastalRiskState;
  previousRiskState: CoastalRiskState | null;
  officialWarningActive: boolean | null;
  tsunamiStatus: boolean | null;
  tsunamiAuthoritative: boolean;
  maxMagnitude: number | null;
  earthquakeUrl: string | null;
  /** Worst hazard state across the next `forecastHorizonHours`. */
  worstForecastState: 'nominal' | 'elevated' | 'high' | 'severe' | 'insufficient-data';
  worstForecastHours: number | null;
  /** True when at least one required source is unavailable. */
  anySourceUnavailable: boolean;
  sourceStatus: SourceStatus;
  evaluatedAt: string;
}

/**
 * Apply the rules that can raise a notification.
 *
 * Returns candidates only — deduplication is applied by the caller so that the
 * "would this fire?" question is separable from the "have we seen it?" one.
 */
export function evaluateNotificationRules(
  input: NotificationEvaluationInput
): NotificationCandidate[] {
  const candidates: NotificationCandidate[] = [];

  // RISK_ESCALATED — only on an actual upward transition.
  if (input.previousRiskState !== null) {
    const order: CoastalRiskState[] = ['nominal', 'watch', 'elevated', 'high', 'severe'];
    const before = order.indexOf(input.previousRiskState);
    const after = order.indexOf(input.riskState);

    if (before >= 0 && after > before) {
      candidates.push({
        rule: 'RISK_ESCALATED',
        severity: input.riskState === 'high' || input.riskState === 'severe' ? 'critical' : 'warning',
        title: `Coastal risk increased to ${input.riskState}`,
        detail: `Risk moved from ${input.previousRiskState} to ${input.riskState} at ${input.evaluatedAt}.`,
        eventKey: buildEventKey({
          rule: 'RISK_ESCALATED',
          discriminator: `${input.previousRiskState}->${input.riskState}`,
        }),
        source: 'BayWatch risk engine',
        riskState: input.riskState,
      });
    }
  }

  // OFFICIAL_WARNING_ACTIVE — tri-state respected: only when positively true.
  if (input.officialWarningActive === true) {
    candidates.push({
      rule: 'OFFICIAL_WARNING_ACTIVE',
      severity: 'critical',
      title: 'Official warning active',
      detail: 'An IMD or INCOIS bulletin is reported as active by the official source.',
      eventKey: buildEventKey({ rule: 'OFFICIAL_WARNING_ACTIVE', discriminator: 'any' }),
      source: 'IMD / INCOIS',
      riskState: input.riskState,
    });
  }

  // TSUNAMA_FLAG_SET — ONLY on a positive, authoritative flag.
  // `false` and `null` both produce nothing. An unknown flag is not an alert.
  if (input.tsunamiStatus === true && input.tsunamiAuthoritative) {
    candidates.push({
      rule: 'TSUNAMA_FLAG_SET',
      severity: 'critical',
      title: 'Tsunami flag present',
      detail:
        'A regional earthquake carries a tsunami flag from an official source. This is a ' +
        'reported flag, not a BayWatch prediction.',
      eventKey: buildEventKey({ rule: 'TSUNAMA_FLAG_SET', discriminator: 'regional' }),
      source: 'USGS / INCOIS',
      riskState: input.riskState,
    });
  }

  // MAJOR_EARTHQUAKE — a real, located USGS event. Reports shaking, NOT tsunami.
  if (input.maxMagnitude !== null && input.maxMagnitude >= 6.0) {
    candidates.push({
      rule: 'MAJOR_EARTHQUAKE',
      severity: 'warning',
      title: `Magnitude ${input.maxMagnitude} earthquake recorded`,
      detail: `USGS recorded a magnitude ${input.maxMagnitude} event. This reports seismic activity only.`,
      eventKey: buildEventKey({
        rule: 'MAJOR_EARTHQUAKE',
        discriminator: `m${input.maxMagnitude}`,
      }),
      source: 'USGS',
      link: input.earthquakeUrl,
      riskState: input.riskState,
    });
  }

  // FORECAST_DETERIORATION — a real worsening within the published horizon.
  if (input.worstForecastState === 'severe' || input.worstForecastState === 'high') {
    candidates.push({
      rule: 'FORECAST_DETERIORATION',
      severity: input.worstForecastState === 'severe' ? 'critical' : 'warning',
      title: 'Forecast deterioration',
      detail: input.worstForecastHours !== null
        ? `Published forecast reaches ${input.worstForecastState} hazard conditions in ${input.worstForecastHours} hour(s).`
        : `Published forecast reaches ${input.worstForecastState} hazard conditions.`,
      eventKey: buildEventKey({
        rule: 'FORECAST_DETERIORATION',
        discriminator: input.worstForecastState,
      }),
      source: 'Open-Meteo',
      riskState: input.riskState,
    });
  }

  return candidates;
}

/**
 * Add candidates that have not been seen before.
 *
 * An existing notification with the same event key is returned untouched, so
 * `acknowledgedAt` is preserved and `createdAt` keeps pointing at the first
 * time the condition was observed — not the most recent poll.
 */
export function dedupeNotifications(
  existing: readonly BayWatchNotification[],
  candidates: readonly NotificationCandidate[],
  createdAt: string
): BayWatchNotification[] {
  const byEventKey = new Map(existing.map((n) => [n.eventKey, n]));
  const added: BayWatchNotification[] = [];

  for (const candidate of candidates) {
    if (byEventKey.has(candidate.eventKey)) continue;
    const notification: BayWatchNotification = {
      id: stableId(candidate.eventKey),
      eventKey: candidate.eventKey,
      rule: candidate.rule,
      severity: candidate.severity,
      title: candidate.title,
      detail: candidate.detail,
      createdAt,
      acknowledgedAt: null,
      source: candidate.source,
      riskState: candidate.riskState ?? null,
      triggeredRuleIds: candidate.triggeredRuleIds ?? [],
      link: candidate.link ?? null,
    };
    byEventKey.set(candidate.eventKey, notification);
    added.push(notification);
  }

  return [...existing, ...added].slice(-MAX_STORED);
}

/** Mark one notification acknowledged. Returns a new array; no-op if unknown. */
export function acknowledgeNotification(
  notifications: readonly BayWatchNotification[],
  id: string,
  at: string
): BayWatchNotification[] {
  let changed = false;
  const next = notifications.map((n) => {
    if (n.id !== id || n.acknowledgedAt !== null) return n;
    changed = true;
    return { ...n, acknowledgedAt: at };
  });
  return changed ? next : [...notifications];
}

export function acknowledgeAll(
  notifications: readonly BayWatchNotification[],
  at: string
): BayWatchNotification[] {
  return notifications.map((n) =>
    n.acknowledgedAt === null ? { ...n, acknowledgedAt: at } : n
  );
}

// =====================================================================
// PERSISTENCE
// =====================================================================

export interface NotificationStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): NotificationStorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__baywatch_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    // Private-browsing or blocked storage. Non-fatal.
    return null;
  }
}

/**
 * Load persisted notifications.
 *
 * Malformed stored data is discarded rather than trusted — a corrupt entry
 * must not be able to suppress a real notification.
 */
export function loadNotifications(
  storage: NotificationStorageLike | null = defaultStorage()
): { notifications: BayWatchNotification[]; persistenceUnavailable: boolean } {
  if (!storage) return { notifications: [], persistenceUnavailable: true };

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { notifications: [], persistenceUnavailable: false };

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { notifications: [], persistenceUnavailable: false };

    const valid = parsed.filter(
      (n): n is BayWatchNotification =>
        typeof n === 'object' &&
        n !== null &&
        typeof (n as BayWatchNotification).eventKey === 'string' &&
        typeof (n as BayWatchNotification).id === 'string'
    );

    return { notifications: valid, persistenceUnavailable: false };
  } catch {
    return { notifications: [], persistenceUnavailable: false };
  }
}

export function saveNotifications(
  notifications: readonly BayWatchNotification[],
  storage: NotificationStorageLike | null = defaultStorage()
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(notifications));
    return true;
  } catch {
    return false;
  }
}

// =====================================================================
// BROWSER NOTIFICATION PERMISSION
// =====================================================================

export function readNotificationPermission(): NotificationPermissionState {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return Notification.permission as NotificationPermissionState;
  } catch {
    return 'unsupported';
  }
}

/**
 * Request permission.
 *
 * Returns the resulting state rather than throwing. A denied permission is a
 * normal outcome the UI must state plainly — the app remains fully functional
 * without OS-level notifications.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return result as NotificationPermissionState;
  } catch {
    return 'denied';
  }
}

/** Show a real browser notification when permitted. Returns whether it showed. */
export function showBrowserNotification(
  notification: BayWatchNotification,
  onClick?: (n: BayWatchNotification) => void
): boolean {
  if (readNotificationPermission() !== 'granted') return false;
  if (typeof Notification === 'undefined') return false;

  try {
    const n = new Notification(notification.title, {
      body: notification.detail,
      tag: notification.eventKey,
      // Severity is conveyed by the tag/requireInteraction, not a fake score.
      requireInteraction: notification.severity === 'critical',
    });
    if (onClick) n.onclick = () => onClick(notification);
    return true;
  } catch {
    return false;
  }
}

export type { CoastalRiskTransition, TriggeredRule };
