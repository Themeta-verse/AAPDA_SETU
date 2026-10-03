import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { ResourceCommandCenter } from './ResourceCommandCenter';
import { clearSchemaAvailabilityCache } from '@/integrations/supabase/resources';

type Row = Record<string, unknown>;

function makeResourceRow(overrides: Row = {}): Row {
  return {
    id: 'res-pump-1',
    resource_type: 'water_pump',
    name: 'BMC Ward K-West High-Capacity Dewatering Pump 1',
    status: 'available',
    quantity: 2,
    available_quantity: 2,
    zone_id: 'zone-mumbai-kwest',
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
    zone_id: 'zone-mumbai-kwest',
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
  onDeleteResource?: (id: string) => void;
  onDeleteAllocation?: (id: string) => void;
  schemaAvailable?: boolean;
} = {}) {
  const store: Record<string, Row[]> = {
    resources: [...(options.resources ?? [])],
    resource_allocations: [...(options.allocations ?? [])],
    resource_audit_logs: [...(options.auditLogs ?? [])],
    resource_incident_compatibility: [...(options.compatibilities ?? [])],
    incident_reports: [...(options.incidents ?? [])],
  };

  const schemaAvailable = options.schemaAvailable !== false;
  const queries: { table: string; select?: string; orderCol?: string; limitN?: number }[] = [];

  const client = {
    _queries: queries,
    from: (table: string) => {
      let currentFilter: { col: string; val: unknown } | null = null;
      let selectColumns: string | null = null;

      const builder = {
        select: (cols?: string) => {
          selectColumns = cols ?? '*';
          return builder;
        },
        eq: (col: string, val: unknown) => {
          currentFilter = { col, val };
          return builder;
        },
        order: (col?: string) => {
          queries.push({ table, select: selectColumns ?? '*', orderCol: col });
          // Schema check: select('id').limit(1) on resources table
          if (table === 'resources' && selectColumns === 'id') {
            if (schemaAvailable) {
              return Promise.resolve({ data: store.resources.slice(0, 1).map(r => ({ id: r.id })), error: null });
            } else {
              return Promise.resolve({ data: null, error: { message: "Could not find the table 'public.resources' in the schema cache", code: 'PGRST204' } });
            }
          }
          if (!schemaAvailable && (table === 'resources' || table.startsWith('resource_'))) {
            return Promise.resolve({ data: null, error: { message: `Could not find the table 'public.${table}' in the schema cache`, code: 'PGRST204' } });
          }
          return Promise.resolve({ data: store[table] || [], error: null });
        },
        limit: (n: number) => {
          queries.push({ table, select: selectColumns ?? '*', limitN: n });
          // Schema check: select('id').limit(1) on resources table
          if (table === 'resources' && selectColumns === 'id') {
            if (schemaAvailable) {
              return Promise.resolve({ data: store.resources.slice(0, n).map(r => ({ id: r.id })), error: null });
            } else {
              return Promise.resolve({ data: null, error: { message: "Could not find the table 'public.resources' in the schema cache", code: 'PGRST204' } });
            }
          }
          if (!schemaAvailable && (table === 'resources' || table.startsWith('resource_'))) {
            return Promise.resolve({ data: null, error: { message: `Could not find the table 'public.${table}' in the schema cache`, code: 'PGRST204' } });
          }
          return Promise.resolve({ data: (store[table] || []).slice(0, n), error: null });
        },
        single: () => {
          const list = store[table] || [];
          const found = currentFilter
            ? list.find((item: Row) => item[currentFilter!.col] === currentFilter!.val)
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
            then: (resolve: (arg: unknown) => void) => resolve({ data: row, error: null }),
          };
        },
        update: (values: Row) => ({
          eq: (col: string, val: unknown) => {
            const list = store[table] || [];
            const row = list.find((item: Row) => item[col] === val);
            if (row) Object.assign(row, values);
            return Promise.resolve({ data: row, error: null });
          },
        }),
        delete: () => ({
          eq: (col: string, val: unknown) => {
            if (table === 'resources' && options.onDeleteResource) {
              options.onDeleteResource(String(val));
            }
            if (table === 'resource_allocations' && options.onDeleteAllocation) {
              options.onDeleteAllocation(String(val));
            }
            if (store[table]) {
              store[table] = store[table].filter((item: Row) => item[col] !== val);
            }
            return Promise.resolve({ data: null, error: null });
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

function adminUser() {
  return {
    id: 'user-admin',
    app_metadata: { role: 'admin' },
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
  clearSchemaAvailabilityCache();
});

describe('ResourceCommandCenter Component', () => {
  it('renders restricted access notice for citizen user (citizen → restricted)', async () => {
    const comp: Row = {
      id: 'comp-1',
      resource_type: 'water_pump',
      incident_type: 'flooding',
      priority: 1,
      notes: 'Ward dewatering pump',
    };
    const inc: Row = {
      id: 'inc-1',
      user_id: 'u1',
      type: 'flooding',
      description: 'Waterlogging at SV Road',
      latitude: 19.0988,
      longitude: 72.8267,
      created_at: '2026-10-01T00:00:00.000Z',
    };

    render(
      <ResourceCommandCenter
        language="en"
        user={citizenUser()}
        client={fakeClient({
          resources: [makeResourceRow()],
          incidents: [inc],
          compatibilities: [comp],
        })}
      />
    );

    // Citizen should see restricted notice and urban title
    expect(await screen.findByTestId('resource-role-notice')).toBeInTheDocument();
    expect(screen.getByText('Operational Access Required')).toBeInTheDocument();
    expect(screen.getByText('Urban Resource Command Center')).toBeInTheDocument();

    // Citizen should NOT see operational header badge
    expect(screen.queryByTestId('operational-role-badge')).not.toBeInTheDocument();

    // Citizen should NOT see Register Resource or Allocate Resource buttons
    expect(screen.queryByText('Register Resource')).not.toBeInTheDocument();
    expect(screen.queryByText('Allocate Resource')).not.toBeInTheDocument();

    // In recommendations tab, citizen should see suggestions but NO operational approve/reject buttons
    const recTab = await screen.findByRole('tab', { name: /Suggested Allocations/i });
    fireEvent.click(recTab);
    expect(await screen.findByTestId('recommendation-list')).toBeInTheDocument();
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.queryByText('Reject')).not.toBeInTheDocument();
  });

  it('renders operational controls for responder user (responder → operational access)', async () => {
    render(
      <ResourceCommandCenter
        language="en"
        user={responderUser()}
        client={fakeClient({ resources: [makeResourceRow()] })}
      />
    );

    // Operational badge indicates RESPONDER
    const badge = await screen.findByTestId('operational-role-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('OPERATIONAL ACCESS · responder');

    // Operational actions are available
    expect(await screen.findByText('Register Resource')).toBeInTheDocument();
    expect(screen.getByText('Allocate Resource')).toBeInTheDocument();
    expect(screen.getByText('Allocate')).toBeInTheDocument();
    expect(screen.queryByTestId('resource-role-notice')).not.toBeInTheDocument();

    // Responder does NOT have admin delete permissions
    expect(screen.queryByTestId('delete-resource-res-pump-1')).not.toBeInTheDocument();
  });

  it('renders full operational and administrative access for admin user (admin → full operational access)', async () => {
    const res = makeResourceRow({ id: 'res-pump-1' });
    const alloc = makeAllocationRow({ id: 'alloc-1' });

    render(
      <ResourceCommandCenter
        language="en"
        user={adminUser()}
        client={fakeClient({
          resources: [res],
          allocations: [alloc],
        })}
      />
    );

    // Operational badge indicates ADMIN
    const badge = await screen.findByTestId('operational-role-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('OPERATIONAL ACCESS · admin');

    // Full operational controls
    expect(await screen.findByText('Register Resource')).toBeInTheDocument();
    expect(screen.getByText('Allocate Resource')).toBeInTheDocument();
    expect(screen.queryByTestId('resource-role-notice')).not.toBeInTheDocument();

    // Admin has delete resource capability in inventory table
    expect(await screen.findByTestId('delete-resource-res-pump-1')).toBeInTheDocument();

    // Admin has delete allocation capability in allocations table
    const allocTab = await screen.findByRole('tab', { name: /Live Deployments & Allocations/i });
    fireEvent.click(allocTab);
    expect(await screen.findByTestId('delete-allocation-alloc-1')).toBeInTheDocument();
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

  it('renders recommendations tab with explainable rule-based allocations and urban ward context', async () => {
    const res = makeResourceRow({
      id: 'pump-1',
      resource_type: 'water_pump',
      name: 'BMC Ward K-West Dewatering Unit',
      available_quantity: 1,
      status: 'available',
    });
    const incident: Row = {
      id: 'inc-flood-1',
      user_id: 'citizen-1',
      type: 'flooding',
      description: 'Severe waterlogging at SV Road and Link Road Junction',
      latitude: 19.0988,
      longitude: 72.8267,
      created_at: '2026-10-01T00:00:00.000Z',
    };
    const comp: Row = {
      id: 'comp-1',
      resource_type: 'water_pump',
      incident_type: 'flooding',
      priority: 1,
      notes: 'Primary municipal pump for flood water removal',
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
    expect(screen.getByText(/BMC Ward K-West Dewatering Unit/)).toBeInTheDocument();
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

  it('renders isolated query error notice with retry button when database tables return error or 404, without 404 query spam', async () => {
    const client = fakeClient({ schemaAvailable: false });
    render(
      <ResourceCommandCenter
        language="en"
        user={responderUser()}
        client={client}
      />
    );

    // Notice renders cleanly
    expect(await screen.findByTestId('resource-query-error-notice')).toBeInTheDocument();
    const errorNotice = screen.getByTestId('resource-query-error-notice');
    expect(errorNotice.textContent).toContain('Resource Management Not Configured');
    expect(errorNotice.textContent).toContain('resource management backend tables are not present');

    // Truthful unavailable state: KPIs are 0
    const kpiSection = screen.getByTestId('resource-kpis');
    expect(kpiSection).toBeInTheDocument();
    // Empty inventory state is rendered
    expect(screen.getByTestId('empty-resources')).toBeInTheDocument();

    // Verify ZERO resource requests for created_at or allocated_at were executed
    const subqueries = client._queries.filter(
      (q) =>
        (q.table === 'resources' || q.table.startsWith('resource_')) &&
        (q.orderCol === 'created_at' || q.orderCol === 'allocated_at')
    );
    expect(subqueries).toHaveLength(0);

    // Initial probe queries: exactly one probe select('id').limit(1)
    const probeQueriesInitial = client._queries.filter(
      (q) => q.table === 'resources' && q.select === 'id' && q.limitN === 1
    );
    expect(probeQueriesInitial).toHaveLength(1);

    // Click Retry
    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryBtn);

    // Wait for retry to finish
    await waitFor(() => {
      expect(retryBtn).not.toBeDisabled();
    });

    // Still in graceful unavailable state
    expect(screen.getByTestId('resource-query-error-notice')).toBeInTheDocument();

    // Still ZERO resource requests for created_at or allocated_at
    const subqueriesAfterRetry = client._queries.filter(
      (q) =>
        (q.table === 'resources' || q.table.startsWith('resource_')) &&
        (q.orderCol === 'created_at' || q.orderCol === 'allocated_at')
    );
    expect(subqueriesAfterRetry).toHaveLength(0);

    // Exactly ONE fresh probe was executed for Retry (total 2)
    const probeQueriesTotal = client._queries.filter(
      (q) => q.table === 'resources' && q.select === 'id' && q.limitN === 1
    );
    expect(probeQueriesTotal).toHaveLength(2);
  });
});
