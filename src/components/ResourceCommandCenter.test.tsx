import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { ResourceCommandCenter } from './ResourceCommandCenter';

type Row = Record<string, unknown>;

function makeResourceRow(overrides: Row = {}): Row {
  return {
    id: 'res-pump-1',
    resource_type: 'water_pump',
    name: 'BMC High-Capacity Dewatering Pump 1',
    status: 'available',
    quantity: 2,
    available_quantity: 2,
    zone_id: 'zone-juhu-1',
    latitude: 19.0988,
    longitude: 72.8267,
    capacity: null,
    metadata: {},
    created_at: '2026-10-01T00:00:00.000Z',
    created_by: 'user-admin',
    ...overrides,
  };
}

function makeAllocationRow(overrides: Row = {}): Row {
  return {
    id: 'alloc-1',
    resource_id: 'res-pump-1',
    incident_id: 'inc-1',
    zone_id: 'zone-juhu-1',
    quantity: 1,
    status: 'pending',
    allocated_by: 'user-responder',
    approved_by: null,
    deployed_by: null,
    allocated_at: '2026-10-01T01:00:00.000Z',
    approved_at: null,
    deployed_at: null,
    completed_at: null,
    released_at: null,
    rejection_reason: null,
    metadata: {},
    ...overrides,
  };
}

function fakeClient(options: {
  resources?: Row[];
  allocations?: Row[];
  auditLogs?: Row[];
  compatibilities?: Row[];
  incidents?: Row[];
} = {}) {
  const store: Record<string, Row[]> = {
    resources: [...(options.resources ?? [])],
    resource_allocations: [...(options.allocations ?? [])],
    resource_audit_logs: [...(options.auditLogs ?? [])],
    resource_incident_compatibility: [...(options.compatibilities ?? [])],
    incident_reports: [...(options.incidents ?? [])],
  };

  const client = {
    from: (table: string) => {
      let currentFilter: { col: string; val: unknown } | null = null;

      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          currentFilter = { col, val };
          return builder;
        },
        order: () => Promise.resolve({ data: store[table] || [], error: null }),
        limit: (n: number) => Promise.resolve({ data: (store[table] || []).slice(0, n), error: null }),
        single: () => {
          const list = store[table] || [];
          const found = currentFilter
            ? list.find((item: any) => item[currentFilter!.col] === currentFilter!.val)
            : list[0];
          return Promise.resolve({ data: found || null, error: found ? null : { message: 'Not found' } });
        },
        insert: (values: Row) => {
          const row = { id: `gen-${Date.now()}`, ...values };
          if (store[table]) store[table].push(row);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: row, error: null }),
            }),
            then: (resolve: any) => resolve({ data: row, error: null }),
          };
        },
        update: (values: Row) => ({
          eq: (col: string, val: unknown) => {
            const list = store[table] || [];
            const row = list.find((item: any) => item[col] === val);
            if (row) Object.assign(row, values);
            return Promise.resolve({ data: row, error: null });
          },
        }),
      };
      return builder;
    },
  };
  return client;
}

function responderUser() {
  return {
    id: 'user-resp',
    app_metadata: { role: 'responder' },
    user_metadata: {},
  } as unknown as User;
}

function citizenUser() {
  return {
    id: 'user-cit',
    app_metadata: { role: 'citizen' },
    user_metadata: {},
  } as unknown as User;
}

beforeEach(() => {
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
});

describe('ResourceCommandCenter Component', () => {
  it('renders restricted access notice for citizen user', async () => {
    render(
      <ResourceCommandCenter
        language="en"
        user={citizenUser()}
        client={fakeClient({ resources: [makeResourceRow()] })}
      />
    );

    expect(await screen.findByTestId('resource-role-notice')).toBeInTheDocument();
    expect(screen.getByText('Operational Access Required')).toBeInTheDocument();
    // Citizen should NOT see Register Resource button
    expect(screen.queryByText('Register Resource')).not.toBeInTheDocument();
  });

  it('renders operational controls for responder user', async () => {
    render(
      <ResourceCommandCenter
        language="en"
        user={responderUser()}
        client={fakeClient({ resources: [makeResourceRow()] })}
      />
    );

    expect(await screen.findByText('Register Resource')).toBeInTheDocument();
    expect(screen.getByText('Allocate Resource')).toBeInTheDocument();
    expect(screen.queryByTestId('resource-role-notice')).not.toBeInTheDocument();
  });

  it('displays honest empty state when no resources are registered in database', async () => {
    render(
      <ResourceCommandCenter
        language="en"
        user={responderUser()}
        client={fakeClient({ resources: [] })}
      />
    );

    expect(await screen.findByTestId('empty-resources')).toBeInTheDocument();
    expect(screen.getByText('No resource inventory is available')).toBeInTheDocument();
  });

  it('calculates and displays real KPI counts from database state', async () => {
    const res1 = makeResourceRow({ id: 'r1', quantity: 2, available_quantity: 2, status: 'available' });
    const res2 = makeResourceRow({ id: 'r2', quantity: 1, available_quantity: 0, status: 'deployed' });
    const res3 = makeResourceRow({ id: 'r3', quantity: 1, available_quantity: 0, status: 'maintenance' });

    render(
      <ResourceCommandCenter
        language="en"
        user={responderUser()}
        client={fakeClient({ resources: [res1, res2, res3] })}
      />
    );

    const kpiSection = await screen.findByTestId('resource-kpis');
    expect(kpiSection).toBeInTheDocument();

    // Total resources: 2 + 1 + 1 = 4
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders recommendations tab with explainable rule-based allocations', async () => {
    const res = makeResourceRow({
      id: 'pump-1',
      resource_type: 'water_pump',
      name: 'BMC Flood Dewatering Pump',
      available_quantity: 1,
      status: 'available',
    });
    const incident: Row = {
      id: 'inc-flood-1',
      user_id: 'citizen-1',
      type: 'flooding',
      description: 'Severe flood at Juhu Tara Road',
      latitude: 19.0988,
      longitude: 72.8267,
      created_at: '2026-10-01T00:00:00.000Z',
    };
    const comp: Row = {
      id: 'comp-1',
      resource_type: 'water_pump',
      incident_type: 'flooding',
      priority: 1,
      notes: 'Primary pump for flood water removal',
    };

    render(
      <ResourceCommandCenter
        language="en"
        user={responderUser()}
        client={fakeClient({
          resources: [res],
          incidents: [incident],
          compatibilities: [comp],
        })}
      />
    );

    // Click recommendations tab
    const tab = await screen.findByRole('tab', { name: /Suggested Allocations/i });
    fireEvent.click(tab);

    expect(await screen.findByTestId('recommendation-list')).toBeInTheDocument();
    expect(screen.getByText(/BMC Flood Dewatering Pump/)).toBeInTheDocument();
    expect(screen.getByText(/Priority 1 Suggestion/i)).toBeInTheDocument();
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('shows offline warning badge when connection is offline', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });

    render(
      <ResourceCommandCenter
        language="en"
        user={responderUser()}
        client={fakeClient({ resources: [makeResourceRow()] })}
      />
    );

    expect(await screen.findByText(/Connection Offline/i)).toBeInTheDocument();
  });
});
