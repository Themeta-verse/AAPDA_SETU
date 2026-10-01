import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildEventKey,
  dedupeNotifications,
  acknowledgeNotification,
  acknowledgeAll,
  loadNotifications,
  saveNotifications,
  evaluateNotificationRules,
  readNotificationPermission,
  requestNotificationPermission,
  showBrowserNotification,
  type BayWatchNotification,
  type NotificationEvaluationInput,
  type NotificationStorageLike,
} from './engine';

/**
 * Behavioral tests for the notification engine.
 *
 * The two properties that matter most and are easiest to get wrong:
 *  - DEDUPLICATION across polling cycles (a hazard persisting for 10 polls
 *    must yield 1 notification, not 10).
 *  - TRI-STATE TSUNAMI (an unknown flag must never raise an alert, and must
 *    never be reported as "no tsunami").
 */

function input(overrides: Partial<NotificationEvaluationInput> = {}): NotificationEvaluationInput {
  return {
    riskState: 'nominal',
    previousRiskState: null,
    officialWarningActive: null,
    tsunamiStatus: null,
    tsunamiAuthoritative: false,
    maxMagnitude: null,
    earthquakeUrl: null,
    worstForecastState: 'nominal',
    worstForecastHours: null,
    anySourceUnavailable: false,
    sourceStatus: 'live',
    evaluatedAt: '2026-09-30T12:00:00.000Z',
    ...overrides,
  };
}

const memoryStorage = (): NotificationStorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

// =====================================================================
// RULE EVALUATION
// =====================================================================

describe('notification rules', () => {
  it('raises nothing for calm, complete data', () => {
    const candidates = evaluateNotificationRules(input());
    expect(candidates).toEqual([]);
  });

  it('raises RISK_ESCALATED on a genuine upward transition', () => {
    const candidates = evaluateNotificationRules(
      input({ riskState: 'elevated', previousRiskState: 'watch' })
    );
    expect(candidates.map((c) => c.rule)).toContain('RISK_ESCALATED');
  });

  it('does not raise RISK_ESCALATED on a de-escalation', () => {
    const candidates = evaluateNotificationRules(
      input({ riskState: 'watch', previousRiskState: 'high' })
    );
    expect(candidates.map((c) => c.rule)).not.toContain('RISK_ESCALATED');
  });

  it('does not raise RISK_ESCALATED on the first evaluation', () => {
    const candidates = evaluateNotificationRules(input({ riskState: 'high', previousRiskState: null }));
    expect(candidates.map((c) => c.rule)).not.toContain('RISK_ESCALATED');
  });

  it('raises OFFICIAL_WARNING_ACTIVE only when positively true', () => {
    const yes = evaluateNotificationRules(input({ officialWarningActive: true }));
    expect(yes.map((c) => c.rule)).toContain('OFFICIAL_WARNING_ACTIVE');

    // UNKNOWN must not be treated as "no warning" NOR as "warning active".
    const unknown = evaluateNotificationRules(input({ officialWarningActive: null }));
    expect(unknown.map((c) => c.rule)).not.toContain('OFFICIAL_WARNING_ACTIVE');

    const no = evaluateNotificationRules(input({ officialWarningActive: false }));
    expect(no.map((c) => c.rule)).not.toContain('OFFICIAL_WARNING_ACTIVE');
  });
});

// =====================================================================
// TSUNAMI TRI-STATE
// =====================================================================

describe('tsunami notifications are strictly authoritative', () => {
  it('raises TSUNAMA_FLAG_SET on an authoritative true flag', () => {
    const candidates = evaluateNotificationRules(
      input({ tsunamiStatus: true, tsunamiAuthoritative: true })
    );
    expect(candidates.map((c) => c.rule)).toContain('TSUNAMA_FLAG_SET');
  });

  it('raises nothing for an authoritative FALSE flag', () => {
    // A published "not a tsunami" is good news, not an alert.
    const candidates = evaluateNotificationRules(
      input({ tsunamiStatus: false, tsunamiAuthoritative: true })
    );
    expect(candidates.map((c) => c.rule)).not.toContain('TSUNAMA_FLAG_SET');
  });

  it('raises nothing when tsunami status is UNKNOWN', () => {
    const candidates = evaluateNotificationRules(
      input({ tsunamiStatus: null, tsunamiAuthoritative: false })
    );
    expect(candidates.map((c) => c.rule)).not.toContain('TSUNAMA_FLAG_SET');
  });

  it('never infers a tsunami flag from magnitude', () => {
    // Magnitude 8.5 with no authoritative flag must produce nothing.
    const candidates = evaluateNotificationRules(
      input({
        maxMagnitude: 8.5,
        tsunamiStatus: null,
        tsunamiAuthoritative: false,
      })
    );
    const ids = candidates.map((c) => c.rule);
    expect(ids).not.toContain('TSUNAMA_FLAG_SET');
    // It may still report the seismic event itself.
    expect(ids).toContain('MAJOR_EARTHQUAKE');
  });

  it('describes the earthquake without claiming a tsunami', () => {
    const candidates = evaluateNotificationRules(input({ maxMagnitude: 7.1 }));
    const quake = candidates.find((c) => c.rule === 'MAJOR_EARTHQUAKE')!;
    expect(quake.detail).toContain('seismic activity only');
    expect(quake.detail.toLowerCase()).not.toContain('tsunami will');
  });
});

// =====================================================================
// FORECAST
// =====================================================================

describe('forecast notifications', () => {
  it('raises on a high forecast horizon', () => {
    const candidates = evaluateNotificationRules(
      input({ worstForecastState: 'high', worstForecastHours: 6 })
    );
    expect(candidates.map((c) => c.rule)).toContain('FORECAST_DETERIORATION');
  });

  it('raises nothing for a nominal forecast', () => {
    const candidates = evaluateNotificationRules(input({ worstForecastState: 'nominal' }));
    expect(candidates.map((c) => c.rule)).not.toContain('FORECAST_DETERIORATION');
  });

  it('states the real horizon rather than inventing one', () => {
    const candidates = evaluateNotificationRules(
      input({ worstForecastState: 'high', worstForecastHours: 9 })
    );
    expect(candidates[0].detail).toContain('9 hour');
  });
});

// =====================================================================
// DEDUPLICATION
// =====================================================================

describe('deduplication', () => {
  const candidate = (key: string) => ({
    rule: 'RISK_ESCALATED' as const,
    severity: 'warning' as const,
    title: 't',
    detail: 'd',
    eventKey: key,
    source: 's',
  });

  it('adds a notification the first time an event key appears', () => {
    const next = dedupeNotifications([], [candidate('A')], '2026-09-30T12:00:00Z');
    expect(next).toHaveLength(1);
  });

  it('does not add the same event key twice', () => {
    const first = dedupeNotifications([], [candidate('A')], '2026-09-30T12:00:00Z');
    const second = dedupeNotifications(first, [candidate('A')], '2026-09-30T12:05:00Z');
    expect(second).toHaveLength(1);
  });

  it('produces exactly ONE notification across ten identical polling cycles', () => {
    let notifications: BayWatchNotification[] = [];
    for (let cycle = 0; cycle < 10; cycle += 1) {
      notifications = dedupeNotifications(
        notifications,
        [candidate('RISK_ESCALATED:watch->high')],
        `2026-09-30T12:0${cycle}:00Z`
      );
    }
    expect(notifications).toHaveLength(1);
  });

  it('does not flap when risk oscillates watch -> unknown -> watch', () => {
    // This is the exact pattern that made the old event stream useless:
    // "watch -> unknown", "unknown -> watch", "watch -> unknown", forever.
    // A persistent condition must not re-notify as the state wobbles around it.
    const flapping: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      flapping.push(i % 2 === 0 ? 'RISK_ESCALATED:nominal->watch' : 'RISK_ESCALATED:unknown->watch');
    }

    let notifications: BayWatchNotification[] = [];
    flapping.forEach((key, index) => {
      notifications = dedupeNotifications(notifications, [candidate(key)], `2026-09-30T12:${index}:00Z`);
    });

    // One notification per distinct real transition, not one per poll.
    expect(notifications).toHaveLength(2);
  });

  it('does not notify on a transition out of and back into unknown', () => {
    // Returning to a known state is not an escalation, so nothing is raised.
    const candidates = evaluateNotificationRules({
      ...input(),
      riskState: 'unknown',
      previousRiskState: 'watch',
    });
    expect(candidates.map((c) => c.rule)).not.toContain('RISK_ESCALATED');
  });

  it('preserves createdAt from the FIRST observation, not the latest poll', () => {    const first = dedupeNotifications([], [candidate('A')], '2026-09-30T12:00:00Z');
    const second = dedupeNotifications(first, [candidate('A')], '2026-09-30T12:09:00Z');
    expect(second[0].createdAt).toBe('2026-09-30T12:00:00Z');
  });

  it('preserves acknowledgement across a re-raised event key', () => {
    const first = dedupeNotifications([], [candidate('A')], '2026-09-30T12:00:00Z');
    const acked = acknowledgeNotification(first, first[0].id, '2026-09-30T12:01:00Z');
    const again = dedupeNotifications(acked, [candidate('A')], '2026-09-30T12:05:00Z');

    expect(again).toHaveLength(1);
    expect(again[0].acknowledgedAt).toBe('2026-09-30T12:01:00Z');
  });

  it('adds a new notification when the event key genuinely differs', () => {
    const first = dedupeNotifications([], [candidate('A')], '2026-09-30T12:00:00Z');
    const second = dedupeNotifications(first, [candidate('B')], '2026-09-30T12:05:00Z');
    expect(second).toHaveLength(2);
  });

  it('deduplicates when several candidates share one key', () => {
    const next = dedupeNotifications([], [candidate('A'), candidate('A')], '2026-09-30T12:00:00Z');
    expect(next).toHaveLength(1);
  });
});

// =====================================================================
// EVENT KEYS
// =====================================================================

describe('event keys', () => {
  it('produces the same key for the same inputs', () => {
    const a = buildEventKey({ rule: 'RISK_ESCALATED', discriminator: 'watch->high' });
    const b = buildEventKey({ rule: 'RISK_ESCALATED', discriminator: 'watch->high' });
    expect(a).toBe(b);
  });

  it('distinguishes different transitions', () => {
    const a = buildEventKey({ rule: 'RISK_ESCALATED', discriminator: 'watch->high' });
    const b = buildEventKey({ rule: 'RISK_ESCALATED', discriminator: 'high->severe' });
    expect(a).not.toBe(b);
  });

  it('distinguishes different rules', () => {
    const a = buildEventKey({ rule: 'RISK_ESCALATED', discriminator: 'x' });
    const b = buildEventKey({ rule: 'MAJOR_EARTHQUAKE', discriminator: 'x' });
    expect(a).not.toBe(b);
  });
});

// =====================================================================
// ACKNOWLEDGEMENT
// =====================================================================

describe('acknowledgement', () => {
  const withOne = (): BayWatchNotification[] =>
    dedupeNotifications(
      [],
      [
        {
          rule: 'RISK_ESCALATED',
          severity: 'warning',
          title: 't',
          detail: 'd',
          eventKey: 'A',
          source: 's',
        },
      ],
      '2026-09-30T12:00:00Z'
    );

  it('records an acknowledgement time', () => {
    const acked = acknowledgeNotification(withOne(), withOne()[0].id, '2026-09-30T12:10:00Z');
    expect(acked[0].acknowledgedAt).toBe('2026-09-30T12:10:00Z');
  });

  it('is idempotent — acknowledging twice keeps the first time', () => {
    const first = acknowledgeNotification(withOne(), withOne()[0].id, '2026-09-30T12:10:00Z');
    const second = acknowledgeNotification(first, first[0].id, '2026-09-30T13:00:00Z');
    expect(second[0].acknowledgedAt).toBe('2026-09-30T12:10:00Z');
  });

  it('ignores an unknown id', () => {
    const before = withOne();
    const after = acknowledgeNotification(before, 'nonexistent', '2026-09-30T12:10:00Z');
    expect(after).toHaveLength(1);
    expect(after[0].acknowledgedAt).toBeNull();
  });

  it('acknowledges every notification at once', () => {
    const many = dedupeNotifications(
      [],
      [
        { rule: 'RISK_ESCALATED', severity: 'warning', title: 'a', detail: 'd', eventKey: 'A', source: 's' },
        { rule: 'MAJOR_EARTHQUAKE', severity: 'warning', title: 'b', detail: 'd', eventKey: 'B', source: 's' },
      ],
      '2026-09-30T12:00:00Z'
    );
    const acked = acknowledgeAll(many, '2026-09-30T12:30:00Z');
    expect(acked.every((n) => n.acknowledgedAt !== null)).toBe(true);
  });
});

// =====================================================================
// PERSISTENCE
// =====================================================================

describe('persistence', () => {
  it('round-trips notifications through storage', () => {
    const storage = memoryStorage();
    const notifications = dedupeNotifications(
      [],
      [{ rule: 'RISK_ESCALATED', severity: 'warning', title: 't', detail: 'd', eventKey: 'A', source: 's' }],
      '2026-09-30T12:00:00Z'
    );

    expect(saveNotifications(notifications, storage)).toBe(true);
    const loaded = loadNotifications(storage);
    expect(loaded.notifications).toHaveLength(1);
    expect(loaded.notifications[0].eventKey).toBe('A');
  });

  it('reports persistence as unavailable when storage is blocked', () => {
    const loaded = loadNotifications(null);
    expect(loaded.persistenceUnavailable).toBe(true);
    expect(loaded.notifications).toEqual([]);
  });

  it('discards malformed stored data rather than trusting it', () => {
    const storage = memoryStorage();
    storage.setItem('baywatch.notifications.v1', '{not json');
    expect(loadNotifications(storage).notifications).toEqual([]);
  });

  it('discards entries that lack an identity', () => {
    const storage = memoryStorage();
    storage.setItem(
      'baywatch.notifications.v1',
      JSON.stringify([{ nope: true }, { id: 'a', eventKey: 'b' }])
    );
    const loaded = loadNotifications(storage);
    expect(loaded.notifications).toHaveLength(1);
    expect(loaded.notifications[0].eventKey).toBe('b');
  });

  it('survives a storage write failure without throwing', () => {
    const failing: NotificationStorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => undefined,
    };
    expect(saveNotifications([], failing)).toBe(false);
  });
});

// =====================================================================
// PERMISSION
// =====================================================================

describe('browser notification permission', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unsupported when the Notification API is absent', () => {
    vi.stubGlobal('Notification', undefined);
    expect(readNotificationPermission()).toBe('unsupported');
  });

  it('returns the current browser permission', () => {
    vi.stubGlobal('Notification', { permission: 'granted' });
    expect(readNotificationPermission()).toBe('granted');
    vi.stubGlobal('Notification', { permission: 'denied' });
    expect(readNotificationPermission()).toBe('denied');
    vi.stubGlobal('Notification', { permission: 'default' });
    expect(readNotificationPermission()).toBe('default');
  });

  it('resolves to the granted result after a request', async () => {
    vi.stubGlobal('Notification', {
      permission: 'granted',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    });
    await expect(requestNotificationPermission()).resolves.toBe('granted');
  });

  it('treats a denied permission as a normal resolved outcome', async () => {
    vi.stubGlobal('Notification', {
      permission: 'denied',
      requestPermission: vi.fn().mockResolvedValue('denied'),
    });
    await expect(requestNotificationPermission()).resolves.toBe('denied');
  });

  it('does not throw when requestPermission rejects', async () => {
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: vi.fn().mockRejectedValue(new Error('blocked')),
    });
    await expect(requestNotificationPermission()).resolves.toBe('denied');
  });

  it('refuses to show a browser notification without permission', () => {
    vi.stubGlobal('Notification', { permission: 'denied' });
    const notification = {
      id: 'x',
      eventKey: 'A',
      rule: 'RISK_ESCALATED' as const,
      severity: 'warning' as const,
      title: 't',
      detail: 'd',
      createdAt: '2026-09-30T12:00:00Z',
      acknowledgedAt: null,
      source: 's',
      riskState: 'high' as const,
      triggeredRuleIds: [],
      link: null,
    };
    expect(showBrowserNotification(notification)).toBe(false);
  });

  it('shows a real notification when granted', () => {
    const created: unknown[] = [];
    class FakeNotification {
      constructor(title: string, opts?: unknown) {
        created.push({ title, opts });
      }
      onclick: (() => void) | null = null;
    }
    vi.stubGlobal('Notification', Object.assign(FakeNotification, { permission: 'granted' }));

    const shown = showBrowserNotification({
      id: 'x',
      eventKey: 'A',
      rule: 'RISK_ESCALATED',
      severity: 'critical',
      title: 'BayWatch alert',
      detail: 'detail',
      createdAt: '2026-09-30T12:00:00Z',
      acknowledgedAt: null,
      source: 's',
      riskState: 'severe',
      triggeredRuleIds: [],
      link: null,
    });

    expect(shown).toBe(true);
    expect(created).toHaveLength(1);
  });
});
