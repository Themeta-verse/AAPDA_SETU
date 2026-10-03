import { describe, it, expect, vi } from 'vitest';
import {
  verifyIncidentReport,
  rejectIncidentReport,
  resolveIncidentReport,
  fetchIncidentAuditLogs,
  normalizeIncidentRow,
  type Incident,
  type IncidentDeps,
} from './incidents';

function fakeWorkflowClient() {
  const auditLogs: Record<string, unknown>[] = [];
  const incidents = new Map<string, Record<string, unknown>>();

  return {
    auditLogs,
    incidents,
    client: {
      from: (table: string) => {
        if (table === 'incident_reports') {
          return {
            select: () => ({
              order: () => Promise.resolve({ data: Array.from(incidents.values()), error: null }),
            }),
            insert: (val: Record<string, unknown>) => {
              if (typeof val.id === 'string') {
                incidents.set(val.id, { ...val });
              }
              return Promise.resolve({ data: val, error: null });
            },
            update: (values: Record<string, unknown>) => ({
              eq: (_col: string, val: unknown) => {
                const key = String(val);
                const existing = incidents.get(key) || {};
                incidents.set(key, { ...existing, ...values });
                return Promise.resolve({ data: null, error: null });
              },
            }),
          };
        }
        if (table === 'incident_audit_logs') {
          return {
            insert: (val: Record<string, unknown>) => {
              const record = { id: `audit-${Date.now()}`, ...val, created_at: new Date().toISOString() };
              auditLogs.push(record);
              return Promise.resolve({ data: record, error: null });
            },
            select: () => ({
              order: () => Promise.resolve({ data: [...auditLogs], error: null }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ error: null }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://storage/signed' }, error: null }),
        }),
      },
    } as unknown as IncidentDeps['client'],
  };
}

describe('Incident Operational Response Workflow', () => {
  it('normalizes evidence status deterministically: SUFFICIENT vs PARTIAL vs INSUFFICIENT', () => {
    // 1. Photo + Coordinates + Description -> SUFFICIENT
    const rowSufficient = {
      id: 'inc-1',
      user_id: 'user-1',
      type: 'flooding',
      description: 'Water entering shopfront',
      photo_url: 'user-1/flood.jpg',
      latitude: 19.1000,
      longitude: 72.8300,
      status: 'unverified',
      created_at: '2026-10-01T12:00:00.000Z',
    };
    const incSufficient = normalizeIncidentRow(rowSufficient)!;
    expect(incSufficient.evidenceStatus).toBe('SUFFICIENT');

    // 2. Photo but no coordinates -> PARTIAL
    const rowPartial = {
      id: 'inc-2',
      user_id: 'user-1',
      type: 'flooding',
      description: 'Water everywhere',
      photo_url: 'user-1/flood.jpg',
      latitude: null,
      longitude: null,
      status: 'unverified',
      created_at: '2026-10-01T12:00:00.000Z',
    };
    const incPartial = normalizeIncidentRow(rowPartial)!;
    expect(incPartial.evidenceStatus).toBe('PARTIAL');

    // 3. No photo, no coordinates, no description -> INSUFFICIENT
    const rowInsufficient = {
      id: 'inc-3',
      user_id: 'user-1',
      type: 'flooding',
      description: '',
      photo_url: null,
      latitude: null,
      longitude: null,
      status: 'unverified',
      created_at: '2026-10-01T12:00:00.000Z',
    };
    const incInsufficient = normalizeIncidentRow(rowInsufficient)!;
    expect(incInsufficient.evidenceStatus).toBe('INSUFFICIENT');
  });

  it('transitions report state from unverified to verified with audit entry', async () => {
    const fake = fakeWorkflowClient();
    fake.incidents.set('inc-10', {
      id: 'inc-10',
      type: 'flooding',
      status: 'unverified',
      description: 'Water at ankle level',
    });

    const deps: IncidentDeps = { client: fake.client, now: () => new Date('2026-10-01T12:30:00.000Z') };

    const result = await verifyIncidentReport(deps, {
      incidentId: 'inc-10',
      verifiedBy: 'resp-user-1',
      notes: 'Photo and coordinates verified against GIS baseline',
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();

    // Check updated incident
    const updated = fake.incidents.get('inc-10');
    expect(updated.status).toBe('verified');
    expect(updated.verified_by).toBe('resp-user-1');
    expect(updated.verified_at).toBe('2026-10-01T12:30:00.000Z');

    // Check audit entry
    expect(fake.auditLogs.length).toBe(1);
    expect(fake.auditLogs[0].action).toBe('verify');
    expect(fake.auditLogs[0].incident_id).toBe('inc-10');
    expect(fake.auditLogs[0].performed_by).toBe('resp-user-1');
    expect(fake.auditLogs[0].previous_status).toBe('unverified');
    expect(fake.auditLogs[0].new_status).toBe('verified');
  });

  it('rejects incident while preserving original evidence', async () => {
    const fake = fakeWorkflowClient();
    fake.incidents.set('inc-20', {
      id: 'inc-20',
      type: 'flooding',
      status: 'unverified',
      description: 'Fake report or wrong location',
      photo_url: 'user-9/photo.jpg',
      latitude: 19.1000,
      longitude: 72.8300,
    });

    const deps: IncidentDeps = { client: fake.client };

    const result = await rejectIncidentReport(deps, {
      incidentId: 'inc-20',
      rejectedBy: 'resp-user-1',
      reason: 'No waterlogging found upon patrol inspection',
    });

    expect(result.ok).toBe(true);

    const updated = fake.incidents.get('inc-20');
    expect(updated.status).toBe('rejected');
    expect(updated.rejection_reason).toBe('No waterlogging found upon patrol inspection');
    // Original photo and description are NEVER deleted or overwritten
    expect(updated.photo_url).toBe('user-9/photo.jpg');
    expect(updated.description).toBe('Fake report or wrong location');

    expect(fake.auditLogs.some(a => a.action === 'reject' && a.incident_id === 'inc-20')).toBe(true);
  });

  it('resolves verified incident after response completion', async () => {
    const fake = fakeWorkflowClient();
    fake.incidents.set('inc-30', {
      id: 'inc-30',
      type: 'flooding',
      status: 'verified',
    });

    const deps: IncidentDeps = { client: fake.client, now: () => new Date('2026-10-01T14:00:00.000Z') };

    const result = await resolveIncidentReport(deps, {
      incidentId: 'inc-30',
      resolvedBy: 'resp-user-1',
      notes: 'Water cleared by dewatering pump unit 1',
    });

    expect(result.ok).toBe(true);
    const updated = fake.incidents.get('inc-30');
    expect(updated.status).toBe('resolved');
    expect(updated.resolved_by).toBe('resp-user-1');
    expect(updated.resolution_notes).toContain('dewatering pump');

    // Fetch audit trail
    const auditRes = await fetchIncidentAuditLogs(deps, 'inc-30');
    expect(auditRes.logs.length).toBe(1);
    expect(auditRes.logs[0].action).toBe('resolve');
    expect(auditRes.logs[0].newStatus).toBe('resolved');
  });

  it('refuses operational updates when offline without claiming success', async () => {
    const fake = fakeWorkflowClient();
    const deps: IncidentDeps = {
      client: fake.client,
      isOnline: () => false,
    };

    // Simulate offline
    vi.stubGlobal('navigator', { onLine: false });

    const result = await verifyIncidentReport(deps, {
      incidentId: 'inc-10',
      verifiedBy: 'resp-user-1',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('network');

    vi.unstubAllGlobals();
  });
});
