import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  listResources,
  listResourceAllocations,
  listResourceAuditLogs,
  listResourceIncidentCompatibility,
  createResource,
  createResourceAllocation,
  updateResourceAllocation,
  deleteResource,
  deleteResourceAllocation,
  computeRuleBasedRecommendations,
  normalizeResourceRow,
  normalizeAllocationRow,
  normalizeAuditLogRow,
  normalizeCompatibilityRow,
  isResourceType,
  isResourceStatus,
  isAllocationStatus,
  RESOURCE_TYPES,
  RESOURCE_STATUSES,
  ALLOCATION_STATUSES,
  type Resource,
  type ResourceAllocation,
  type ResourceIncidentCompatibility,
  type ResourceDeps,
} from './resources';
import type { Incident } from './incidents';

type Row = Record<string, unknown>;

function makeResourceRow(overrides: Row = {}): Row {
  return {
    id: 'res-1111-1111-1111',
    resource_type: 'water_pump',
    name: 'BMC High-Capacity Dewatering Pump 1',
    status: 'available',
    quantity: 2,
    available_quantity: 2,
    zone_id: 'zone-mumbai-kwest-1111',
    latitude: 19.0988,
    longitude: 72.8267,
    capacity: null,
    metadata: {},
    created_at: '2026-10-01T00:00:00.000Z',
    created_by: 'user-admin-1',
    ...overrides,
  };
}

function makeAllocationRow(overrides: Row = {}): Row {
  return {
    id: 'alloc-1111-1111-1111',
    resource_id: 'res-1111-1111-1111',
    incident_id: 'inc-1111-1111-1111',
    zone_id: 'zone-mumbai-kwest-1111',
    quantity: 1,
    status: 'pending',
    allocated_by: 'user-responder-1',
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

interface FakeClientOptions {
  resources?: Row[];
  allocations?: Row[];
  auditLogs?: Row[];
  compatibilities?: Row[];
  error?: { message: string; code?: string } | null;
}

function fakeClient(options: FakeClientOptions = {}) {
  const store: Record<string, Row[]> = {
    resources: [...(options.resources ?? [])],
    resource_allocations: [...(options.allocations ?? [])],
    resource_audit_logs: [...(options.auditLogs ?? [])],
    resource_incident_compatibility: [...(options.compatibilities ?? [])],
  };

  const calls = {
    updates: [] as { table: string; values: Row; filterCol: string; filterVal: unknown }[],
    inserts: [] as { table: string; values: Row }[],
  };

  const client = {
    from: (table: string) => {
      let currentFilter: { col: string; val: unknown } | null = null;
      let selectedCols = '*';

      const queryBuilder = {
        select: (cols: string = '*') => {
          selectedCols = cols;
          return queryBuilder;
        },
        eq: (col: string, val: unknown) => {
          currentFilter = { col, val };
          return queryBuilder;
        },
        order: (_col: string, _opts: { ascending: boolean }) => {
          if (options.error) {
            return Promise.resolve({ data: null, error: options.error });
          }
          const data = store[table] || [];
          return Promise.resolve({ data, error: null });
        },
        limit: (n: number) => {
          const data = store[table] || [];
          return Promise.resolve({ data: data.slice(0, n), error: null });
        },
        single: () => {
          if (options.error) {
            return Promise.resolve({ data: null, error: options.error });
          }
          const list = store[table] || [];
          const found = currentFilter
            ? list.find((item: Row) => item[currentFilter!.col] === currentFilter!.val)
            : list[0];
          if (!found) {
            return Promise.resolve({ data: null, error: { message: 'Row not found', code: 'PGRST116' } });
          }
          return Promise.resolve({ data: found, error: null });
        },
        insert: (values: Row) => {
          calls.inserts.push({ table, values });
          const insertedRow = { id: `generated-${Date.now()}`, ...values };
          if (!options.error && store[table]) {
            store[table].push(insertedRow);
          }
          return {
            select: () => ({
              single: () => Promise.resolve({
                data: options.error ? null : insertedRow,
                error: options.error ?? null,
              }),
            }),
            then: (resolve: (arg: unknown) => void) => resolve({
              data: options.error ? null : insertedRow,
              error: options.error ?? null,
            }),
          };
        },
        update: (values: Row) => {
          return {
            eq: (col: string, val: unknown) => {
              calls.updates.push({ table, values, filterCol: col, filterVal: val });
              if (options.error) {
                return Promise.resolve({ data: null, error: options.error });
              }
              const list = store[table] || [];
              const row = list.find((item: Row) => item[col] === val);
              if (row) {
                Object.assign(row, values);
              }
              return Promise.resolve({ data: row, error: null });
            },
          };
        },
        delete: () => {
          return {
            eq: (col: string, val: unknown) => {
              if (options.error) {
                return Promise.resolve({ data: null, error: options.error });
              }
              const list = store[table] || [];
              store[table] = list.filter((item: Row) => item[col] !== val);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };

      return queryBuilder;
    },
  };

  return { client, store, calls };
}

function deps(client: unknown, isOnline = true): ResourceDeps {
  return {
    client: client as unknown as ResourceDeps['client'],
    isOnline: () => isOnline,
    now: () => new Date('2026-10-01T12:00:00.000Z'),
  };
}

describe('1. Resource Status Handling', () => {
  it('recognizes all supported resource operational statuses', () => {
    expect(RESOURCE_STATUSES).toEqual([
      'available',
      'allocated',
      'deployed',
      'maintenance',
      'unavailable',
    ]);
    expect(isResourceStatus('available')).toBe(true);
    expect(isResourceStatus('allocated')).toBe(true);
    expect(isResourceStatus('deployed')).toBe(true);
    expect(isResourceStatus('maintenance')).toBe(true);
    expect(isResourceStatus('unavailable')).toBe(true);
    expect(isResourceStatus('destroyed')).toBe(false);
  });

  it('normalizes valid resource rows correctly', () => {
    const row = makeResourceRow();
    const res = normalizeResourceRow(row);
    expect(res).not.toBeNull();
    expect(res?.status).toBe('available');
    expect(res?.availableQuantity).toBe(2);
    expect(res?.quantity).toBe(2);
  });

  it('rejects rows with unrecognized resource types', () => {
    const row = makeResourceRow({ resource_type: 'unknown_spaceship' });
    expect(normalizeResourceRow(row)).toBeNull();
  });
});

describe('2. Allocation Quantity Validation', () => {
  it('rejects allocation when requested quantity is <= 0', async () => {
    const { client } = fakeClient({ resources: [makeResourceRow()] });
    const result = await createResourceAllocation(deps(client), {
      resourceId: 'res-1111-1111-1111',
      incidentId: 'inc-1',
      zoneId: null,
      quantity: 0,
      allocatedBy: 'user-1',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('malformed');
    expect(result.error?.message).toContain('greater than zero');
  });
});

describe('3. Cannot Allocate Unavailable Resource', () => {
  it('blocks allocation when resource status is unavailable or maintenance', async () => {
    const unavailableRes = makeResourceRow({ status: 'unavailable', available_quantity: 2 });
    const { client } = fakeClient({ resources: [unavailableRes] });

    const result = await createResourceAllocation(deps(client), {
      resourceId: 'res-1111-1111-1111',
      incidentId: 'inc-1',
      zoneId: null,
      quantity: 1,
      allocatedBy: 'user-1',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('malformed');
    expect(result.error?.message).toContain('UNAVAILABLE state');
  });

  it('blocks allocation when resource status is maintenance', async () => {
    const maintenanceRes = makeResourceRow({ status: 'maintenance', available_quantity: 2 });
    const { client } = fakeClient({ resources: [maintenanceRes] });

    const result = await createResourceAllocation(deps(client), {
      resourceId: 'res-1111-1111-1111',
      incidentId: 'inc-1',
      zoneId: null,
      quantity: 1,
      allocatedBy: 'user-1',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('malformed');
    expect(result.error?.message).toContain('MAINTENANCE state');
  });
});

describe('4. Cannot Allocate More than Available Quantity', () => {
  it('fails with clear error if requested quantity exceeds available quantity', async () => {
    const resRow = makeResourceRow({ available_quantity: 1, quantity: 2 });
    const { client } = fakeClient({ resources: [resRow] });

    const result = await createResourceAllocation(deps(client), {
      resourceId: 'res-1111-1111-1111',
      incidentId: 'inc-1',
      zoneId: null,
      quantity: 3,
      allocatedBy: 'user-1',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('malformed');
    expect(result.error?.message).toContain('Insufficient available quantity');
    expect(result.error?.message).toContain('Requested: 3, Available: 1');
  });
});

describe('5. Allocation Updates Persisted State', () => {
  it('decrements available quantity on resource and sets status to allocated when exhausted', async () => {
    const resRow = makeResourceRow({ available_quantity: 2, quantity: 2 });
    const { client, calls, store } = fakeClient({ resources: [resRow] });

    const result = await createResourceAllocation(deps(client), {
      resourceId: 'res-1111-1111-1111',
      incidentId: 'inc-1',
      zoneId: null,
      quantity: 2,
      allocatedBy: 'user-1',
    });

    expect(result.ok).toBe(true);
    expect(result.allocationId).toBeDefined();

    // Verify resources table update was called
    const updateCall = calls.updates.find((u) => u.table === 'resources');
    expect(updateCall).toBeDefined();
    expect(updateCall?.values.available_quantity).toBe(0);
    expect(updateCall?.values.status).toBe('allocated');

    // Verify audit log entry was inserted
    const auditCall = calls.inserts.find((i) => i.table === 'resource_audit_logs');
    expect(auditCall).toBeDefined();
    expect(auditCall?.values.action).toBe('allocated');
  });

  it('restores available quantity when an allocation is released or rejected', async () => {
    const resRow = makeResourceRow({ available_quantity: 0, status: 'allocated', quantity: 2 });
    const allocRow = makeAllocationRow({ quantity: 2, status: 'approved' });
    const { client, calls } = fakeClient({
      resources: [resRow],
      allocations: [allocRow],
    });

    const result = await updateResourceAllocation(deps(client), {
      allocationId: 'alloc-1111-1111-1111',
      status: 'released',
    });

    expect(result.ok).toBe(true);

    const updateCall = calls.updates.find((u) => u.table === 'resources');
    expect(updateCall).toBeDefined();
    expect(updateCall?.values.available_quantity).toBe(2);
    expect(updateCall?.values.status).toBe('available');
  });
});

describe('6 & 7. Authorization & Role Security', () => {
  it('classifies 42501 Postgres error as permission-denied', async () => {
    const { client } = fakeClient({
      error: { message: 'permission denied for table resources', code: '42501' },
    });

    const listResult = await listResources(deps(client));
    expect(listResult.error?.kind).toBe('permission-denied');
  });

  it('classifies general DB error as database', async () => {
    const { client } = fakeClient({
      error: { message: 'connection timeout', code: '08006' },
    });

    const listResult = await listResources(deps(client));
    expect(listResult.error?.kind).toBe('database');
  });

  it('rejects unauthorized resource creation when RLS policy denies it (unauthorized mutation → rejected)', async () => {
    const { client } = fakeClient({
      error: { message: 'new row violates row-level security policy for table "resources"', code: '42501' },
    });

    const result = await createResource(deps(client), {
      name: 'Unauthorized Pump',
      resourceType: 'water_pump',
      quantity: 1,
      zoneId: null,
      latitude: null,
      longitude: null,
      capacity: null,
      createdBy: 'citizen-user',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('permission-denied');
  });

  it('rejects unauthorized resource allocation when RLS policy denies it (unauthorized mutation → rejected)', async () => {
    const { client } = fakeClient({
      resources: [makeResourceRow()],
      error: { message: 'new row violates row-level security policy for table "resource_allocations"', code: '42501' },
    });

    const result = await createResourceAllocation(deps(client), {
      resourceId: 'res-1111-1111-1111',
      incidentId: 'inc-1',
      zoneId: null,
      quantity: 1,
      allocatedBy: 'citizen-user',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('permission-denied');
  });

  it('rejects unauthorized resource deletion when RLS policy denies it (unauthorized mutation → rejected)', async () => {
    const { client } = fakeClient({
      error: { message: 'violates row-level security policy for table "resources"', code: '42501' },
    });

    const result = await deleteResource(deps(client), 'res-1111-1111-1111');
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('permission-denied');
  });

  it('rejects unauthorized allocation deletion when RLS policy denies it (unauthorized mutation → rejected)', async () => {
    const { client } = fakeClient({
      error: { message: 'violates row-level security policy for table "resource_allocations"', code: '42501' },
    });

    const result = await deleteResourceAllocation(deps(client), 'alloc-1111-1111-1111');
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('permission-denied');
  });

  it('successfully deletes resource when authorized as admin', async () => {
    const { client, store } = fakeClient({
      resources: [makeResourceRow({ id: 'res-admin-del' })],
    });

    const result = await deleteResource(deps(client), 'res-admin-del');
    expect(result.ok).toBe(true);
    expect(store.resources.find((r) => r.id === 'res-admin-del')).toBeUndefined();
  });

  it('successfully deletes allocation when authorized as admin', async () => {
    const { client, store } = fakeClient({
      allocations: [makeAllocationRow({ id: 'alloc-admin-del' })],
    });

    const result = await deleteResourceAllocation(deps(client), 'alloc-admin-del');
    expect(result.ok).toBe(true);
    expect(store.resource_allocations.find((a) => a.id === 'alloc-admin-del')).toBeUndefined();
  });
});

describe('8 & 9. Deterministic Recommendation Compatibility Logic', () => {
  const incidents: Incident[] = [
    {
      id: 'inc-flood-1',
      reporterId: 'citizen-1',
      type: 'flooding',
      rawType: 'flooding',
      description: 'Severe street flooding up to waist height',
      photoPath: null,
      latitude: 19.0988,
      longitude: 72.8267,
      hasCoordinates: true,
      createdAt: '2026-10-01T00:00:00.000Z',
      malformed: false,
    },
  ];

  const compatibilities: ResourceIncidentCompatibility[] = [
    {
      id: 'comp-1',
      resourceType: 'water_pump',
      incidentType: 'flooding',
      priority: 1,
      notes: 'Primary flood water pump',
    },
    {
      id: 'comp-2',
      resourceType: 'boat',
      incidentType: 'flooding',
      priority: 2,
      notes: 'Evacuation boat',
    },
  ];

  it('produces explainable rule-based recommendation when compatible resource is available', () => {
    const resources: Resource[] = [
      normalizeResourceRow(
        makeResourceRow({
          id: 'pump-1',
          name: 'BMC Flood Pump 1',
          resource_type: 'water_pump',
          available_quantity: 2,
          status: 'available',
        })
      )!,
    ];

    const recs = computeRuleBasedRecommendations({
      incidents,
      resources,
      compatibilities,
      allocations: [],
      zones: [{ id: 'zone-mumbai-kwest-1111', name: 'Ward K-West Risk Zone' }],
    });

    expect(recs.length).toBe(1);
    expect(recs[0].resourceId).toBe('pump-1');
    expect(recs[0].priority).toBe(1);
    expect(recs[0].reason).toContain('Primary flood water pump');
    expect(recs[0].reason).toContain('Rule priority 1');
  });

  it('never produces fake recommendation when no compatible resource exists in inventory', () => {
    const resources: Resource[] = [
      normalizeResourceRow(
        makeResourceRow({
          id: 'truck-1',
          name: 'Fire Truck',
          resource_type: 'emergency_vehicle', // Not in flood compatibility
          available_quantity: 2,
          status: 'available',
        })
      )!,
    ];

    const recs = computeRuleBasedRecommendations({
      incidents,
      resources,
      compatibilities,
      allocations: [],
    });

    // Honest empty recommendation: no compatible resource
    expect(recs.length).toBe(0);
  });
});

describe('10. Offline Mutation is Blocked', () => {
  it('blocks createResourceAllocation when offline without issuing network query', async () => {
    const { client, calls } = fakeClient({ resources: [makeResourceRow()] });
    const result = await createResourceAllocation(deps(client, false), {
      resourceId: 'res-1111-1111-1111',
      incidentId: 'inc-1',
      zoneId: null,
      quantity: 1,
      allocatedBy: 'user-1',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('network');
    expect(result.error?.message).toContain('offline');
    expect(calls.inserts.length).toBe(0);
  });

  it('blocks updateResourceAllocation when offline', async () => {
    const { client, calls } = fakeClient({ allocations: [makeAllocationRow()] });
    const result = await updateResourceAllocation(deps(client, false), {
      allocationId: 'alloc-1111-1111-1111',
      status: 'deployed',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('network');
    expect(calls.updates.length).toBe(0);
  });
});

describe('11. Empty Resource State', () => {
  it('returns empty array and honest empty result when database has 0 resources', async () => {
    const { client } = fakeClient({ resources: [] });
    const result = await listResources(deps(client));

    expect(result.error).toBeNull();
    expect(result.resources).toEqual([]);
    expect(result.fetchedAt).toBeDefined();
  });
});

describe('12. Static Assertions on Migration SQL', () => {
  const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');
  const migrationSql = readFileSync(
    resolve(MIGRATIONS_DIR, '20261001120000_resource_command_center.sql'),
    'utf8'
  );
  const normalize = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
  const flat = normalize(migrationSql);

  it('uses public.is_responder() STABLE function instead of flawed auth.jwt() role check', () => {
    expect(flat).toContain('public.is_responder()');
    expect(flat).not.toContain("auth.jwt() ->> 'role'");
  });

  it('enables Row Level Security on resources, allocations, and audit logs', () => {
    expect(flat).toContain('ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY');
    expect(flat).toContain('ALTER TABLE public.resource_allocations ENABLE ROW LEVEL SECURITY');
    expect(flat).toContain('ALTER TABLE public.resource_audit_logs ENABLE ROW LEVEL SECURITY');
  });

  it('creates check constraints to guarantee positive quantities', () => {
    expect(flat).toContain('chk_resources_quantity CHECK (quantity >= 0)');
    expect(flat).toContain('chk_resources_avail_quantity CHECK (available_quantity >= 0 AND available_quantity <= quantity)');
    expect(flat).toContain('chk_allocations_quantity CHECK (quantity > 0)');
  });
});
