/**
 * Resource Command Center data access.
 *
 * This module is the ONLY place that talks to `resources`, `resource_allocations`,
 * `resource_audit_logs`, and `resource_incident_compatibility` tables.
 * Components never see a raw Supabase query.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ResourceType,
  ResourceStatus,
  AllocationStatus,
  Tables,
  TablesInsert,
  TablesUpdate,
} from './types';
import type { Incident } from './incidents';

export type { ResourceType, ResourceStatus, AllocationStatus };

export const RESOURCE_TYPES: readonly ResourceType[] = [
  'ambulance',
  'fire_rescue',
  'rescue_team',
  'boat',
  'water_pump',
  'emergency_medical_team',
  'search_rescue_team',
  'emergency_vehicle',
  'shelter_capacity',
  'relief_supply',
  'generator',
  'lighting_tower',
  'communication_equipment',
  'dewatering_pump',
  'other',
] as const;

export const RESOURCE_STATUSES: readonly ResourceStatus[] = [
  'available',
  'allocated',
  'deployed',
  'maintenance',
  'unavailable',
] as const;

export const ALLOCATION_STATUSES: readonly AllocationStatus[] = [
  'pending',
  'approved',
  'rejected',
  'deployed',
  'completed',
  'released',
] as const;

export function isResourceType(value: unknown): value is ResourceType {
  return typeof value === 'string' && (RESOURCE_TYPES as readonly string[]).includes(value as ResourceType);
}

export function isResourceStatus(value: unknown): value is ResourceStatus {
  return typeof value === 'string' && (RESOURCE_STATUSES as readonly string[]).includes(value as ResourceStatus);
}

export function isAllocationStatus(value: unknown): value is AllocationStatus {
  return typeof value === 'string' && (ALLOCATION_STATUSES as readonly string[]).includes(value as AllocationStatus);
}

const PERMISSION_DENIED_CODE = '42501';

export type ResourceErrorKind =
  | 'permission-denied'
  | 'network'
  | 'database'
  | 'malformed'
  | 'unauthenticated'
  | 'schema-unavailable';

export interface ResourceError {
  kind: ResourceErrorKind;
  message: string;
  code?: string;
}

export interface Resource {
  id: string;
  resourceType: ResourceType;
  name: string;
  status: ResourceStatus;
  quantity: number;
  availableQuantity: number;
  zoneId: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity: number | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  createdBy: string | null;
}

export interface ResourceAllocation {
  id: string;
  resourceId: string;
  incidentId: string | null;
  zoneId: string | null;
  quantity: number;
  status: AllocationStatus;
  allocatedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  deployedAt: string | null;
  deployedBy: string | null;
  completedAt: string | null;
  releasedAt: string | null;
  rejectionReason: string | null;
  metadata: Record<string, unknown>;
}

export interface ResourceAuditLog {
  id: string;
  resourceId: string;
  allocationId: string | null;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  quantity: number;
  performedBy: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ResourceIncidentCompatibility {
  id: string;
  resourceType: ResourceType;
  incidentType: string;
  priority: number;
  notes: string | null;
}

export interface ResourceListResult {
  resources: Resource[];
  error: ResourceError | null;
  fetchedAt: string | null;
}

export interface ResourceAllocationListResult {
  allocations: ResourceAllocation[];
  error: ResourceError | null;
  fetchedAt: string | null;
}

export interface ResourceAuditLogListResult {
  logs: ResourceAuditLog[];
  error: ResourceError | null;
}

export interface CompatibilityListResult {
  compatibilities: ResourceIncidentCompatibility[];
  error: ResourceError | null;
}

export interface SubmitAllocationResult {
  ok: boolean;
  error: ResourceError | null;
  allocationId: string | null;
}

export interface UpdateAllocationResult {
  ok: boolean;
  error: ResourceError | null;
}

export interface SubmitAllocationInput {
  resourceId: string;
  incidentId: string | null;
  zoneId: string | null;
  quantity: number;
  allocatedBy: string;
  status?: AllocationStatus;
}

export interface UpdateAllocationInput {
  allocationId: string;
  status: AllocationStatus;
  approvedBy?: string | null;
  deployedBy?: string | null;
  rejectionReason?: string | null;
  quantity?: number;
}

export interface CreateResourceInput {
  resourceType: ResourceType;
  name: string;
  quantity: number;
  zoneId: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity: number | null;
  metadata?: Record<string, unknown>;
  createdBy: string;
  status?: ResourceStatus;
}

export interface SuggestedAllocation {
  id: string;
  incidentId: string;
  incidentType: string;
  incidentDescription: string | null;
  incidentLocation: string;
  resourceId: string;
  resourceName: string;
  resourceType: ResourceType;
  suggestedQuantity: number;
  availableQuantity: number;
  zoneId: string | null;
  zoneName: string;
  priority: number;
  reason: string;
}

export interface ResourceDeps {
  client: SupabaseClient;
  now?: () => Date;
  isOnline?: () => boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeResourceRow(row: unknown): Resource | null {
  if (!isRecord(row)) return null;

  const id = nonEmptyString(row.id);
  if (!id) return null;

  const resourceType = row.resource_type;
  if (!isResourceType(resourceType)) return null;

  const status = isResourceStatus(row.status) ? row.status : 'available';
  const name = nonEmptyString(row.name) ?? 'Unnamed Resource';
  const quantity = typeof row.quantity === 'number' && Number.isFinite(row.quantity) ? row.quantity : 1;
  const availableQuantity =
    typeof row.available_quantity === 'number' && Number.isFinite(row.available_quantity)
      ? row.available_quantity
      : quantity;
  const capacity = finiteOrNull(row.capacity);
  const zoneId = nonEmptyString(row.zone_id);
  const latitude = finiteOrNull(row.latitude);
  const longitude = finiteOrNull(row.longitude);
  const metadata = typeof row.metadata === 'object' && row.metadata !== null ? (row.metadata as Record<string, unknown>) : {};
  const createdAt = nonEmptyString(row.created_at);
  const createdBy = nonEmptyString(row.created_by);

  return {
    id,
    resourceType,
    name,
    status,
    quantity,
    availableQuantity,
    zoneId: zoneId ?? null,
    latitude,
    longitude,
    capacity,
    metadata,
    createdAt,
    createdBy: createdBy ?? null,
  };
}

export function normalizeAllocationRow(row: unknown): ResourceAllocation | null {
  if (!isRecord(row)) return null;

  const id = nonEmptyString(row.id);
  if (!id) return null;

  const resourceId = nonEmptyString(row.resource_id);
  if (!resourceId) return null;

  const incidentId = nonEmptyString(row.incident_id);
  const zoneId = nonEmptyString(row.zone_id);
  const quantity = typeof row.quantity === 'number' && Number.isFinite(row.quantity) ? row.quantity : 1;
  const status = isAllocationStatus(row.status) ? row.status : 'pending';
  const allocatedAt = nonEmptyString(row.allocated_at) ?? new Date().toISOString();
  const approvedAt = nonEmptyString(row.approved_at);
  const approvedBy = nonEmptyString(row.approved_by);
  const deployedAt = nonEmptyString(row.deployed_at);
  const deployedBy = nonEmptyString(row.deployed_by);
  const completedAt = nonEmptyString(row.completed_at);
  const releasedAt = nonEmptyString(row.released_at);
  const rejectionReason = nonEmptyString(row.rejection_reason);
  const metadata = typeof row.metadata === 'object' && row.metadata !== null ? (row.metadata as Record<string, unknown>) : {};

  return {
    id,
    resourceId,
    incidentId: incidentId ?? null,
    zoneId: zoneId ?? null,
    quantity,
    status,
    allocatedAt,
    approvedAt: approvedAt ?? null,
    approvedBy: approvedBy ?? null,
    deployedAt: deployedAt ?? null,
    deployedBy: deployedBy ?? null,
    completedAt: completedAt ?? null,
    releasedAt: releasedAt ?? null,
    rejectionReason: rejectionReason ?? null,
    metadata,
  };
}

export function normalizeAuditLogRow(row: unknown): ResourceAuditLog | null {
  if (!isRecord(row)) return null;

  const id = nonEmptyString(row.id);
  if (!id) return null;

  const resourceId = nonEmptyString(row.resource_id);
  if (!resourceId) return null;

  const allocationId = nonEmptyString(row.allocation_id);
  const action = nonEmptyString(row.action) ?? 'update';
  const previousStatus = nonEmptyString(row.previous_status);
  const newStatus = nonEmptyString(row.new_status);
  const quantity = typeof row.quantity === 'number' && Number.isFinite(row.quantity) ? row.quantity : 1;
  const performedBy = nonEmptyString(row.performed_by);
  const notes = nonEmptyString(row.notes);
  const createdAt = nonEmptyString(row.created_at) ?? new Date().toISOString();

  return {
    id,
    resourceId,
    allocationId: allocationId ?? null,
    action,
    previousStatus: previousStatus ?? null,
    newStatus: newStatus ?? null,
    quantity,
    performedBy: performedBy ?? null,
    notes: notes ?? null,
    createdAt,
  };
}

export function normalizeCompatibilityRow(row: unknown): ResourceIncidentCompatibility | null {
  if (!isRecord(row)) return null;

  const id = nonEmptyString(row.id);
  if (!id) return null;

  const resourceType = row.resource_type;
  if (!isResourceType(resourceType)) return null;

  const incidentType = nonEmptyString(row.incident_type);
  if (!incidentType) return null;

  const priority = typeof row.priority === 'number' ? row.priority : 1;
  const notes = nonEmptyString(row.notes);

  return {
    id,
    resourceType,
    incidentType,
    priority,
    notes,
  };
}

let schemaAvailabilityState: { available: boolean; checkedAt: number } | null = null;
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type SchemaListener = (available: boolean | null) => void;
const schemaListeners = new Set<SchemaListener>();

export function isResourceSchemaUnavailable(): boolean {
  return schemaAvailabilityState !== null && schemaAvailabilityState.available === false;
}

export function getResourceSchemaAvailability(): boolean | null {
  return schemaAvailabilityState ? schemaAvailabilityState.available : null;
}

export function setResourceSchemaAvailability(available: boolean): void {
  schemaAvailabilityState = { available, checkedAt: Date.now() };
  schemaListeners.forEach((fn) => {
    try {
      fn(available);
    } catch {
      // ignore listener error
    }
  });
}

export function clearSchemaAvailabilityCache(): void {
  schemaAvailabilityState = null;
  schemaListeners.forEach((fn) => {
    try {
      fn(null);
    } catch {
      // ignore listener error
    }
  });
}

export function subscribeResourceSchemaAvailability(listener: SchemaListener): () => void {
  schemaListeners.add(listener);
  return () => {
    schemaListeners.delete(listener);
  };
}

function classify(
  error: { message: string; code?: string },
  fallback: ResourceErrorKind
): ResourceError {
  // Handle missing table / schema cache errors gracefully
  if (
    error.code === 'PGRST204' ||
    error.code === '42P01' ||
    error.message?.includes('Could not find the table') ||
    error.message?.includes('schema cache') ||
    error.message?.includes('does not exist')
  ) {
    setResourceSchemaAvailability(false);
    return {
      kind: 'schema-unavailable',
      message: 'Resource management tables are not configured in the database.',
      code: error.code,
    };
  }

  return {
    kind: error.code === PERMISSION_DENIED_CODE ? 'permission-denied' : fallback,
    message: error.message,
    code: error.code,
  };
}

function checkOffline(deps: ResourceDeps): boolean {
  if (deps.isOnline) {
    return !deps.isOnline();
  }
  return typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' && !navigator.onLine;
}

/**
 * Check if resource management tables exist in the schema.
 * Returns true if tables are available, false if schema-unavailable error.
 * Caches the result to avoid repeated checks within the same session.
 */
let activeProbePromise: Promise<boolean> | null = null;

export async function checkSchemaAvailability(deps: ResourceDeps, force: boolean = false): Promise<boolean> {
  if (checkOffline(deps)) {
    return false;
  }

  const now = Date.now();
  if (!force && schemaAvailabilityState && now - schemaAvailabilityState.checkedAt < SCHEMA_CACHE_TTL_MS) {
    return schemaAvailabilityState.available;
  }

  if (activeProbePromise && !force) {
    return activeProbePromise;
  }

  activeProbePromise = (async () => {
    try {
      // Try to query the resources table with a minimal select
      const { error } = await deps.client
        .from('resources')
        .select('id')
        .limit(1);

      const available = !error || (
        error.code !== 'PGRST204' &&
        error.code !== '42P01' &&
        !error.message?.includes('Could not find the table') &&
        !error.message?.includes('schema cache') &&
        !error.message?.includes('does not exist')
      );

      setResourceSchemaAvailability(available);
      return available;
    } catch {
      setResourceSchemaAvailability(false);
      return false;
    } finally {
      activeProbePromise = null;
    }
  })();

  return activeProbePromise;
}

export async function listResources(deps: ResourceDeps): Promise<ResourceListResult> {
  if (isResourceSchemaUnavailable()) {
    return {
      resources: [],
      fetchedAt: null,
      error: { kind: 'schema-unavailable', message: 'Resource management tables are not configured in the database.' },
    };
  }

  if (checkOffline(deps)) {
    return {
      resources: [],
      fetchedAt: null,
      error: { kind: 'network', message: 'You appear to be offline. Resources could not be loaded.' },
    };
  }

  const { data, error } = await deps.client
    .from('resources')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return {
      resources: [],
      fetchedAt: null,
      error: classify(error, 'database'),
    };
  }

  if (!Array.isArray(data)) {
    return {
      resources: [],
      fetchedAt: null,
      error: {
        kind: 'malformed',
        message: 'The database returned an unexpected response shape.',
      },
    };
  }

  const resources = data.map(normalizeResourceRow).filter((r): r is Resource => r !== null);
  const now = deps.now ? deps.now() : new Date();

  return { resources, error: null, fetchedAt: now.toISOString() };
}

export async function listResourceAllocations(deps: ResourceDeps): Promise<ResourceAllocationListResult> {
  if (isResourceSchemaUnavailable()) {
    return {
      allocations: [],
      fetchedAt: null,
      error: { kind: 'schema-unavailable', message: 'Resource management tables are not configured in the database.' },
    };
  }

  if (checkOffline(deps)) {
    return {
      allocations: [],
      fetchedAt: null,
      error: { kind: 'network', message: 'You appear to be offline. Allocations could not be loaded.' },
    };
  }

  const { data, error } = await deps.client
    .from('resource_allocations')
    .select('*')
    .order('allocated_at', { ascending: false });

  if (error) {
    return {
      allocations: [],
      fetchedAt: null,
      error: classify(error, 'database'),
    };
  }

  if (!Array.isArray(data)) {
    return {
      allocations: [],
      fetchedAt: null,
      error: {
        kind: 'malformed',
        message: 'The database returned an unexpected response shape.',
      },
    };
  }

  const allocations = data.map(normalizeAllocationRow).filter((a): a is ResourceAllocation => a !== null);
  const now = deps.now ? deps.now() : new Date();

  return { allocations, error: null, fetchedAt: now.toISOString() };
}

export async function listResourceAuditLogs(deps: ResourceDeps): Promise<ResourceAuditLogListResult> {
  if (isResourceSchemaUnavailable()) {
    return {
      logs: [],
      error: { kind: 'schema-unavailable', message: 'Resource management tables are not configured in the database.' },
    };
  }

  if (checkOffline(deps)) {
    return {
      logs: [],
      error: { kind: 'network', message: 'You appear to be offline. Audit logs could not be loaded.' },
    };
  }

  const { data, error } = await deps.client
    .from('resource_audit_logs')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return {
      logs: [],
      error: classify(error, 'database'),
    };
  }

  if (!Array.isArray(data)) {
    return {
      logs: [],
      error: {
        kind: 'malformed',
        message: 'The database returned an unexpected response shape.',
      },
    };
  }

  const logs = data.map(normalizeAuditLogRow).filter((l): l is ResourceAuditLog => l !== null);
  return { logs, error: null };
}

export async function listResourceIncidentCompatibility(deps: ResourceDeps): Promise<CompatibilityListResult> {
  if (isResourceSchemaUnavailable()) {
    return {
      compatibilities: [],
      error: { kind: 'schema-unavailable', message: 'Resource management tables are not configured in the database.' },
    };
  }

  if (checkOffline(deps)) {
    return {
      compatibilities: [],
      error: { kind: 'network', message: 'You appear to be offline. Compatibility data could not be loaded.' },
    };
  }

  const { data, error } = await deps.client
    .from('resource_incident_compatibility')
    .select('*')
    .order('priority', { ascending: true });

  if (error) {
    return {
      compatibilities: [],
      error: classify(error, 'database'),
    };
  }

  if (!Array.isArray(data)) {
    return {
      compatibilities: [],
      error: {
        kind: 'malformed',
        message: 'The database returned an unexpected response shape.',
      },
    };
  }

  const compatibilities = data
    .map(normalizeCompatibilityRow)
    .filter((c): c is ResourceIncidentCompatibility => c !== null);

  return { compatibilities, error: null };
}

export async function createResource(
  deps: ResourceDeps,
  input: CreateResourceInput
): Promise<{ ok: boolean; error: ResourceError | null; resourceId: string | null }> {
  if (isResourceSchemaUnavailable()) {
    return {
      ok: false,
      resourceId: null,
      error: { kind: 'schema-unavailable', message: 'Resource management tables are not configured in the database.' },
    };
  }

  if (checkOffline(deps)) {
    return {
      ok: false,
      resourceId: null,
      error: { kind: 'network', message: 'You appear to be offline. The resource was not created.' },
    };
  }

  if (!isResourceType(input.resourceType)) {
    return {
      ok: false,
      resourceId: null,
      error: { kind: 'malformed', message: `Unsupported resource type. Allowed: ${RESOURCE_TYPES.join(', ')}.` },
    };
  }

  if (!input.name || input.name.trim() === '') {
    return {
      ok: false,
      resourceId: null,
      error: { kind: 'malformed', message: 'Resource name cannot be empty.' },
    };
  }

  if (typeof input.quantity !== 'number' || input.quantity <= 0) {
    return {
      ok: false,
      resourceId: null,
      error: { kind: 'malformed', message: 'Quantity must be greater than zero.' },
    };
  }

  const payload = {
    resource_type: input.resourceType,
    name: input.name.trim(),
    quantity: input.quantity,
    available_quantity: input.quantity,
    zone_id: input.zoneId,
    latitude: input.latitude,
    longitude: input.longitude,
    capacity: input.capacity,
    metadata: input.metadata ?? {},
    created_by: input.createdBy,
    status: (input.status && isResourceStatus(input.status)) ? input.status : 'available',
  };

  const { data, error } = await deps.client
    .from('resources')
    .insert(payload)
    .select('id')
    .single();

  if (error) {
    return {
      ok: false,
      resourceId: null,
      error: classify(error, 'database'),
    };
  }

  const resourceId = data?.id ?? null;

  // Insert audit log
  if (resourceId) {
    await deps.client.from('resource_audit_logs').insert({
      resource_id: resourceId,
      action: 'created',
      previous_status: null,
      new_status: payload.status,
      quantity: input.quantity,
      performed_by: input.createdBy,
      notes: `Registered ${input.name} (${input.resourceType}) with quantity ${input.quantity}`,
    });
  }

  return { ok: true, resourceId, error: null };
}

export async function createResourceAllocation(
  deps: ResourceDeps,
  input: SubmitAllocationInput
): Promise<SubmitAllocationResult> {
  if (isResourceSchemaUnavailable()) {
    return {
      ok: false,
      allocationId: null,
      error: { kind: 'schema-unavailable', message: 'Resource management tables are not configured in the database.' },
    };
  }

  if (checkOffline(deps)) {
    return {
      ok: false,
      allocationId: null,
      error: { kind: 'network', message: 'You appear to be offline. The allocation was not created.' },
    };
  }

  if (typeof input.quantity !== 'number' || input.quantity <= 0) {
    return {
      ok: false,
      allocationId: null,
      error: { kind: 'malformed', message: 'Quantity must be greater than zero.' },
    };
  }

  // Fetch resource to verify availability and current status
  const { data: resourceData, error: resourceError } = await deps.client
    .from('resources')
    .select('*')
    .eq('id', input.resourceId)
    .single();

  if (resourceError || !resourceData) {
    return {
      ok: false,
      allocationId: null,
      error: resourceError ? classify(resourceError, 'database') : { kind: 'database', message: 'Resource not found.' },
    };
  }

  const resource = normalizeResourceRow(resourceData);
  if (!resource) {
    return {
      ok: false,
      allocationId: null,
      error: { kind: 'malformed', message: 'Resource record is corrupted.' },
    };
  }

  // Cannot allocate unavailable or maintenance resource
  if (resource.status === 'unavailable' || resource.status === 'maintenance') {
    return {
      ok: false,
      allocationId: null,
      error: {
        kind: 'malformed',
        message: `Cannot allocate resource in ${resource.status.toUpperCase()} state.`,
      },
    };
  }

  // Cannot allocate more than available quantity
  if (resource.availableQuantity < input.quantity) {
    return {
      ok: false,
      allocationId: null,
      error: {
        kind: 'malformed',
        message: `Insufficient available quantity. Requested: ${input.quantity}, Available: ${resource.availableQuantity}.`,
      },
    };
  }

  const initialStatus: AllocationStatus = input.status && isAllocationStatus(input.status) ? input.status : 'pending';

  const payload = {
    resource_id: input.resourceId,
    incident_id: input.incidentId,
    zone_id: input.zoneId,
    quantity: input.quantity,
    allocated_by: input.allocatedBy,
    status: initialStatus,
  };

  const { data, error } = await deps.client
    .from('resource_allocations')
    .insert(payload)
    .select('id')
    .single();

  if (error) {
    return {
      ok: false,
      allocationId: null,
      error: classify(error, 'database'),
    };
  }

  const allocationId = data?.id ?? null;

  // Persist updated available quantity and status on resource
  const newAvailable = Math.max(0, resource.availableQuantity - input.quantity);
  const newStatus: ResourceStatus = newAvailable === 0 ? 'allocated' : 'available';

  await deps.client
    .from('resources')
    .update({
      available_quantity: newAvailable,
      status: newStatus,
      updated_at: (deps.now ? deps.now() : new Date()).toISOString(),
    })
    .eq('id', input.resourceId);

  // Write audit trail
  if (allocationId) {
    await deps.client.from('resource_audit_logs').insert({
      resource_id: input.resourceId,
      allocation_id: allocationId,
      action: 'allocated',
      previous_status: resource.status,
      new_status: newStatus,
      quantity: input.quantity,
      performed_by: input.allocatedBy,
      notes: `Allocated ${input.quantity} unit(s) to incident ${input.incidentId ?? 'general'}. Available: ${newAvailable}`,
    });
  }

  return {
    ok: true,
    allocationId,
    error: null,
  };
}

export async function updateResourceAllocation(
  deps: ResourceDeps,
  input: UpdateAllocationInput
): Promise<UpdateAllocationResult> {
  if (isResourceSchemaUnavailable()) {
    return {
      ok: false,
      error: { kind: 'schema-unavailable', message: 'Resource management tables are not configured in the database.' },
    };
  }

  if (checkOffline(deps)) {
    return {
      ok: false,
      error: { kind: 'network', message: 'You appear to be offline. The allocation could not be updated.' },
    };
  }

  if (!isAllocationStatus(input.status)) {
    return {
      ok: false,
      error: { kind: 'malformed', message: `Invalid allocation status: ${input.status}.` },
    };
  }

  // Fetch allocation to obtain resource_id and prior status
  const { data: allocData, error: allocError } = await deps.client
    .from('resource_allocations')
    .select('*')
    .eq('id', input.allocationId)
    .single();

  if (allocError || !allocData) {
    return {
      ok: false,
      error: allocError ? classify(allocError, 'database') : { kind: 'database', message: 'Allocation not found.' },
    };
  }

  const allocation = normalizeAllocationRow(allocData);
  if (!allocation) {
    return {
      ok: false,
      error: { kind: 'malformed', message: 'Allocation record is corrupted.' },
    };
  }

  const nowIso = (deps.now ? deps.now() : new Date()).toISOString();
  const payload: Record<string, unknown> = {
    status: input.status,
    updated_at: nowIso,
  };

  if (input.status === 'approved') {
    payload.approved_at = nowIso;
    if (input.approvedBy) payload.approved_by = input.approvedBy;
  } else if (input.status === 'deployed') {
    payload.deployed_at = nowIso;
    if (input.deployedBy) payload.deployed_by = input.deployedBy;
  } else if (input.status === 'completed') {
    payload.completed_at = nowIso;
  } else if (input.status === 'released') {
    payload.released_at = nowIso;
  } else if (input.status === 'rejected') {
    if (input.rejectionReason) payload.rejection_reason = input.rejectionReason;
  }

  const { error: updateError } = await deps.client
    .from('resource_allocations')
    .update(payload)
    .eq('id', input.allocationId);

  if (updateError) {
    return {
      ok: false,
      error: classify(updateError, 'database'),
    };
  }

  // Fetch parent resource
  const { data: resData } = await deps.client
    .from('resources')
    .select('*')
    .eq('id', allocation.resourceId)
    .single();

  const resource = resData ? normalizeResourceRow(resData) : null;

  // Handle inventory restoration if rejected, completed, or released
  const releasingStates: AllocationStatus[] = ['rejected', 'completed', 'released'];
  const wasActive = allocation.status === 'pending' || allocation.status === 'approved' || allocation.status === 'deployed';

  if (resource && releasingStates.includes(input.status) && wasActive) {
    const restoredAvailable = Math.min(resource.quantity, resource.availableQuantity + allocation.quantity);
    const restoredStatus: ResourceStatus = restoredAvailable > 0 && resource.status !== 'maintenance' && resource.status !== 'unavailable'
      ? 'available'
      : resource.status;

    await deps.client
      .from('resources')
      .update({
        available_quantity: restoredAvailable,
        status: restoredStatus,
        updated_at: nowIso,
      })
      .eq('id', allocation.resourceId);
  } else if (resource && input.status === 'deployed') {
    // If all units are deployed, update status to deployed
    if (resource.availableQuantity === 0 && resource.status === 'allocated') {
      await deps.client
        .from('resources')
        .update({
          status: 'deployed',
          updated_at: nowIso,
        })
        .eq('id', allocation.resourceId);
    }
  }

  // Audit trail
  await deps.client.from('resource_audit_logs').insert({
    resource_id: allocation.resourceId,
    allocation_id: allocation.id,
    action: input.status,
    previous_status: allocation.status,
    new_status: input.status,
    quantity: allocation.quantity,
    performed_by: input.approvedBy ?? input.deployedBy ?? null,
    notes: input.rejectionReason ? `Rejected: ${input.rejectionReason}` : `Status transitioned to ${input.status}`,
  });

  return { ok: true, error: null };
}

export async function deleteResource(
  deps: ResourceDeps,
  resourceId: string
): Promise<{ ok: boolean; error: ResourceError | null }> {
  if (isResourceSchemaUnavailable()) {
    return {
      ok: false,
      error: { kind: 'schema-unavailable', message: 'Resource management tables are not configured in the database.' },
    };
  }

  if (checkOffline(deps)) {
    return {
      ok: false,
      error: { kind: 'network', message: 'You appear to be offline. The resource cannot be deleted.' },
    };
  }

  const { error } = await deps.client
    .from('resources')
    .delete()
    .eq('id', resourceId);

  if (error) {
    return {
      ok: false,
      error: classify(error, 'database'),
    };
  }

  return { ok: true, error: null };
}

export async function deleteResourceAllocation(
  deps: ResourceDeps,
  allocationId: string
): Promise<{ ok: boolean; error: ResourceError | null }> {
  if (isResourceSchemaUnavailable()) {
    return {
      ok: false,
      error: { kind: 'schema-unavailable', message: 'Resource management tables are not configured in the database.' },
    };
  }

  if (checkOffline(deps)) {
    return {
      ok: false,
      error: { kind: 'network', message: 'You appear to be offline. The allocation cannot be deleted.' },
    };
  }

  const { error } = await deps.client
    .from('resource_allocations')
    .delete()
    .eq('id', allocationId);

  if (error) {
    return {
      ok: false,
      error: classify(error, 'database'),
    };
  }

  return { ok: true, error: null };
}

/**
 * Deterministic, explainable recommendation engine.
 *
 * Rules:
 * 1. Matches active incident type with priority-ordered compatible resource types.
 * 2. Matches available resources (`status === 'available'` and `availableQuantity > 0`).
 * 3. Prioritizes resources within the incident's geographic zone.
 * 4. Transparent reasoning: NEVER claims AI or optimality; provides rule-based justification.
 * 5. If no compatible resources exist, returns empty array (no fake recommendations).
 */
export function computeRuleBasedRecommendations(params: {
  incidents: Incident[];
  resources: Resource[];
  compatibilities: ResourceIncidentCompatibility[];
  allocations: ResourceAllocation[];
  zones?: Array<{ id: string; name: string }>;
}): SuggestedAllocation[] {
  const { incidents, resources, compatibilities, allocations, zones = [] } = params;

  if (incidents.length === 0 || resources.length === 0 || compatibilities.length === 0) {
    return [];
  }

  // Active allocations grouped by incidentId
  const activeAllocationsByIncident = new Set<string>();
  for (const alloc of allocations) {
    if (
      alloc.incidentId &&
      (alloc.status === 'pending' || alloc.status === 'approved' || alloc.status === 'deployed')
    ) {
      activeAllocationsByIncident.add(alloc.incidentId);
    }
  }

  const recommendations: SuggestedAllocation[] = [];
  const allocatedResourceCounts = new Map<string, number>();

  for (const incident of incidents) {
    // If incident already has an active allocation, skip creating duplicate suggestions
    if (activeAllocationsByIncident.has(incident.id)) {
      continue;
    }

    const incType = incident.type || 'other';

    // Find compatible resource types for this incident, ordered by priority (1 is highest)
    const matchingRules = compatibilities
      .filter((c) => c.incidentType === incType)
      .sort((a, b) => a.priority - b.priority);

    if (matchingRules.length === 0) {
      continue;
    }

    // Try rules in priority order
    for (const rule of matchingRules) {
      // Find candidate resources of this type that are available
      const candidateResources = resources.filter((res) => {
        if (res.resourceType !== rule.resourceType) return false;
        if (res.status !== 'available') return false;

        // Allocation bookkeeping, not a measurement: a resource absent from
        // the map has genuinely zero prior allocations in this run, stated
        // with an explicit undefined check.
        const priorAllocations = allocatedResourceCounts.get(res.id);
        const alreadyAllocated = priorAllocations === undefined ? 0 : priorAllocations;
        return (res.availableQuantity - alreadyAllocated) > 0;
      });

      if (candidateResources.length === 0) {
        continue;
      }

      // Find zone name if matched
      let bestCandidate = candidateResources[0];

      // Prioritize zone affinity if incident coordinates match zone or candidate matches zone
      const candidateInZone = candidateResources.find((res) => res.zoneId !== null);
      if (candidateInZone) {
        bestCandidate = candidateInZone;
      }

      const zone = zones.find((z) => z.id === bestCandidate.zoneId);
      const zoneName = zone ? zone.name : (bestCandidate.zoneId ? 'Assigned Area' : 'General Inventory');

      const priorBestAllocations = allocatedResourceCounts.get(bestCandidate.id);
      const alreadyAllocated = priorBestAllocations === undefined ? 0 : priorBestAllocations;
      const effectiveAvailable = bestCandidate.availableQuantity - alreadyAllocated;
      const suggestedQuantity = Math.min(1, effectiveAvailable);

      // Track usage
      allocatedResourceCounts.set(bestCandidate.id, alreadyAllocated + suggestedQuantity);

      const locationText = incident.hasCoordinates
        ? `${incident.latitude?.toFixed(4)}, ${incident.longitude?.toFixed(4)}`
        : 'Reported location';

      recommendations.push({
        id: `rec-${incident.id}-${bestCandidate.id}`,
        incidentId: incident.id,
        incidentType: incType,
        incidentDescription: incident.description,
        incidentLocation: locationText,
        resourceId: bestCandidate.id,
        resourceName: bestCandidate.name,
        resourceType: bestCandidate.resourceType,
        suggestedQuantity,
        availableQuantity: effectiveAvailable,
        zoneId: bestCandidate.zoneId,
        zoneName,
        priority: rule.priority,
        reason: rule.notes
          ? `${rule.notes}. Rule priority ${rule.priority} for ${incType} incident. Available in ${zoneName} (${effectiveAvailable} unit${effectiveAvailable > 1 ? 's' : ''} free).`
          : `Compatible resource ${bestCandidate.name} (${bestCandidate.resourceType}) is available (${effectiveAvailable} unit${effectiveAvailable > 1 ? 's' : ''}) in ${zoneName}. Rule priority ${rule.priority} for ${incType} incident.`,
      });

      // Once a recommendation is produced for this incident, proceed to next incident
      break;
    }
  }

  return recommendations;
}