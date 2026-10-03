import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useNetworkStatus } from './useNetworkStatus';
import { saveToCache, loadFromCache, CACHE_KEYS } from '@/lib/offlineCache';
import {
  listResources,
  listResourceAllocations,
  listResourceAuditLogs,
  listResourceIncidentCompatibility,
  createResource as apiCreateResource,
  createResourceAllocation as apiCreateAllocation,
  updateResourceAllocation as apiUpdateAllocation,
  deleteResource as apiDeleteResource,
  deleteResourceAllocation as apiDeleteAllocation,
  checkSchemaAvailability,
  clearSchemaAvailabilityCache,
  isResourceSchemaUnavailable,
  getResourceSchemaAvailability,
  setResourceSchemaAvailability,
  subscribeResourceSchemaAvailability,
  type Resource,
  type ResourceAllocation,
  type ResourceAuditLog,
  type ResourceIncidentCompatibility,
  type ResourceType,
  type ResourceStatus,
  type AllocationStatus,
  type SubmitAllocationInput,
  type UpdateAllocationInput,
  type CreateResourceInput,
  type SuggestedAllocation,
  computeRuleBasedRecommendations,
} from '@/integrations/supabase/resources';

export type {
  Resource,
  ResourceAllocation,
  ResourceAuditLog,
  ResourceIncidentCompatibility,
  ResourceType,
  ResourceStatus,
  AllocationStatus,
  SubmitAllocationInput,
  UpdateAllocationInput,
  CreateResourceInput,
  SuggestedAllocation,
};

export { computeRuleBasedRecommendations };

import type { SupabaseClient, User } from '@supabase/supabase-js';

export interface UseResourcesOptions {
  client?: SupabaseClient;
  user?: User | null;
  enabled?: boolean;
}

export function useResourceSchemaAvailability(options?: UseResourcesOptions) {
  const { user: authUser } = useAuth();
  const user = options?.user !== undefined ? options.user : authUser;
  const { isOnline } = useNetworkStatus();
  const client = options?.client ?? supabase;
  const enabled = options?.enabled !== false && !!user;

  const [schemaAvailable, setSchemaAvailable] = useState<boolean | null>(() => {
    if (isResourceSchemaUnavailable()) return false;
    return getResourceSchemaAvailability();
  });
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    return subscribeResourceSchemaAvailability((status) => {
      setSchemaAvailable(status);
    });
  }, []);

  const probe = useCallback(
    async (force: boolean = false): Promise<boolean> => {
      if (!enabled) return false;
      setChecking(true);
      try {
        const available = await checkSchemaAvailability(
          {
            client,
            isOnline: () => isOnline,
          },
          force
        );
        setSchemaAvailable(available);
        return available;
      } finally {
        setChecking(false);
      }
    },
    [client, isOnline, enabled]
  );

  // Probe once on mount / status changes if availability not already known
  useEffect(() => {
    if (!enabled) {
      setSchemaAvailable(null);
      return;
    }
    const current = getResourceSchemaAvailability();
    if (current !== null) {
      setSchemaAvailable(current);
      return;
    }
    probe(false);
  }, [enabled, probe]);

  const retry = useCallback(async (): Promise<boolean> => {
    clearSchemaAvailabilityCache();
    return await probe(true);
  }, [probe]);

  return { schemaAvailable, checking, retry };
}

export function useResources(options?: UseResourcesOptions) {
  const { user: authUser } = useAuth();
  const user = options?.user !== undefined ? options.user : authUser;
  const userId = user?.id;
  const enabled = options?.enabled !== false && !!user;
  const { isOnline } = useNetworkStatus();
  const client = options?.client ?? supabase;
  const { schemaAvailable, checking, retry: retrySchema } = useResourceSchemaAvailability(options);

  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);

  const fetchResources = useCallback(async () => {
    if (!enabled) {
      setResources([]);
      setLoading(false);
      setError(null);
      return;
    }

    // If schema is unavailable, don't query and show empty state
    if (schemaAvailable === false || isResourceSchemaUnavailable()) {
      setResources([]);
      setLoading(false);
      setError('Resource management tables are not configured in the database.');
      return;
    }

    // Only execute the query when schema availability is confirmed to be true
    if (schemaAvailable !== true) {
      return;
    }

    setLoading(true);
    setError(null);

    // If offline, attempt to load cached resources for read-only viewing
    if (!isOnline) {
      const cached = loadFromCache<Resource[]>(CACHE_KEYS.RESOURCES);
      if (cached && Array.isArray(cached.data)) {
        setResources(cached.data);
        setFetchedAt(cached.updatedAt);
        setIsCached(true);
        setLoading(false);
        return;
      }
    }

    try {
      const result = await listResources({
        client,
        isOnline: () => isOnline,
        now: () => new Date(),
      });

      if (result.error && result.error.kind === 'schema-unavailable') {
        setResources([]);
        setError('Resource management tables are not configured in the database.');
        setLoading(false);
        return;
      }

      if (result.error) {
        // Fallback to cache if database error/offline
        const cached = loadFromCache<Resource[]>(CACHE_KEYS.RESOURCES);
        if (cached && Array.isArray(cached.data)) {
          setResources(cached.data);
          setFetchedAt(cached.updatedAt);
          setIsCached(true);
          setError(result.error.message);
        } else {
          setError(result.error.message);
          setResources([]);
        }
      } else {
        setResources(result.resources);
        setFetchedAt(result.fetchedAt);
        setIsCached(false);
        saveToCache(CACHE_KEYS.RESOURCES, result.resources, 'Supabase');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [enabled, isOnline, client, schemaAvailable]);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  return {
    resources,
    loading: !enabled ? false : schemaAvailable === false ? false : (loading || checking),
    error,
    refetch: fetchResources,
    fetchedAt,
    isOnline,
    isCached,
    schemaAvailable,
    checking,
    retrySchema,
  };
}

export function useResourceAllocations(options?: UseResourcesOptions) {
  const { user: authUser } = useAuth();
  const user = options?.user !== undefined ? options.user : authUser;
  const userId = user?.id;
  const enabled = options?.enabled !== false && !!user;
  const { isOnline } = useNetworkStatus();
  const client = options?.client ?? supabase;
  const { schemaAvailable, checking, retry: retrySchema } = useResourceSchemaAvailability(options);

  const [allocations, setAllocations] = useState<ResourceAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const fetchAllocations = useCallback(async () => {
    if (!enabled) {
      setAllocations([]);
      setLoading(false);
      setError(null);
      return;
    }

    // If schema is unavailable, don't query and show empty state
    if (schemaAvailable === false || isResourceSchemaUnavailable()) {
      setAllocations([]);
      setLoading(false);
      return;
    }

    // Only execute the query when schema availability is confirmed to be true
    if (schemaAvailable !== true) {
      return;
    }

    setLoading(true);
    setError(null);

    if (!isOnline) {
      const cached = loadFromCache<ResourceAllocation[]>(CACHE_KEYS.ALLOCATIONS);
      if (cached && Array.isArray(cached.data)) {
        setAllocations(cached.data);
        setFetchedAt(cached.updatedAt);
        setLoading(false);
        return;
      }
    }

    try {
      const result = await listResourceAllocations({
        client,
        isOnline: () => isOnline,
        now: () => new Date(),
      });

      if (result.error && result.error.kind === 'schema-unavailable') {
        setAllocations([]);
        setLoading(false);
        return;
      }

      if (result.error) {
        const cached = loadFromCache<ResourceAllocation[]>(CACHE_KEYS.ALLOCATIONS);
        if (cached && Array.isArray(cached.data)) {
          setAllocations(cached.data);
          setFetchedAt(cached.updatedAt);
          setError(result.error.message);
        } else {
          setError(result.error.message);
          setAllocations([]);
        }
      } else {
        setAllocations(result.allocations);
        setFetchedAt(result.fetchedAt);
        saveToCache(CACHE_KEYS.ALLOCATIONS, result.allocations, 'Supabase');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [enabled, isOnline, client, schemaAvailable]);

  useEffect(() => {
    fetchAllocations();
  }, [fetchAllocations]);

  return {
    allocations,
    loading: !enabled ? false : schemaAvailable === false ? false : (loading || checking),
    error,
    refetch: fetchAllocations,
    fetchedAt,
    isOnline,
    schemaAvailable,
    checking,
    retrySchema,
  };
}

export function useResourceAuditLogs(options?: UseResourcesOptions) {
  const { user: authUser } = useAuth();
  const user = options?.user !== undefined ? options.user : authUser;
  const userId = user?.id;
  const enabled = options?.enabled !== false && !!user;
  const { isOnline } = useNetworkStatus();
  const client = options?.client ?? supabase;
  const { schemaAvailable, checking, retry: retrySchema } = useResourceSchemaAvailability(options);

  const [logs, setLogs] = useState<ResourceAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!enabled) {
      setLogs([]);
      setLoading(false);
      setError(null);
      return;
    }

    // If schema is unavailable, don't query and show empty state
    if (schemaAvailable === false || isResourceSchemaUnavailable()) {
      setLogs([]);
      setLoading(false);
      return;
    }

    // Only execute the query when schema availability is confirmed to be true
    if (schemaAvailable !== true) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await listResourceAuditLogs({
        client,
        isOnline: () => isOnline,
      });

      if (result.error && result.error.kind === 'schema-unavailable') {
        setLogs([]);
        setLoading(false);
        return;
      }

      if (result.error) {
        setError(result.error.message);
        setLogs([]);
      } else {
        setLogs(result.logs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [enabled, isOnline, client, schemaAvailable]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return {
    logs,
    loading: !enabled ? false : schemaAvailable === false ? false : (loading || checking),
    error,
    refetch: fetchLogs,
    schemaAvailable,
    checking,
    retrySchema,
  };
}

export function useResourceCompatibility(options?: UseResourcesOptions) {
  const { user: authUser } = useAuth();
  const user = options?.user !== undefined ? options.user : authUser;
  const userId = user?.id;
  const enabled = options?.enabled !== false && !!user;
  const { isOnline } = useNetworkStatus();
  const client = options?.client ?? supabase;
  const { schemaAvailable, checking, retry: retrySchema } = useResourceSchemaAvailability(options);

  const [compatibilities, setCompatibilities] = useState<ResourceIncidentCompatibility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCompatibilities = useCallback(async () => {
    if (!enabled) {
      setCompatibilities([]);
      setLoading(false);
      setError(null);
      return;
    }

    // If schema is unavailable, don't query and show empty state
    if (schemaAvailable === false || isResourceSchemaUnavailable()) {
      setCompatibilities([]);
      setLoading(false);
      return;
    }

    // Only execute the query when schema availability is confirmed to be true
    if (schemaAvailable !== true) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await listResourceIncidentCompatibility({
        client,
        isOnline: () => isOnline,
      });

      if (result.error && result.error.kind === 'schema-unavailable') {
        setCompatibilities([]);
        setLoading(false);
        return;
      }

      if (result.error) {
        setError(result.error.message);
        setCompatibilities([]);
      } else {
        setCompatibilities(result.compatibilities);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [enabled, isOnline, client, schemaAvailable]);

  useEffect(() => {
    fetchCompatibilities();
  }, [fetchCompatibilities]);

  return {
    compatibilities,
    loading: !enabled ? false : schemaAvailable === false ? false : (loading || checking),
    error,
    refetch: fetchCompatibilities,
    schemaAvailable,
    checking,
    retrySchema,
  };
}

export function useResourceMutations(options?: UseResourcesOptions) {
  const { user: authUser } = useAuth();
  const user = options?.user !== undefined ? options.user : authUser;
  const { isOnline } = useNetworkStatus();
  const client = options?.client ?? supabase;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const createResource = useCallback(
    async (input: Omit<CreateResourceInput, 'createdBy'>) => {
      if (!user) {
        setMutationError('Sign in required.');
        return { ok: false, resourceId: null };
      }

      if (isResourceSchemaUnavailable()) {
        const msg = 'Resource management tables are not configured in the database.';
        setMutationError(msg);
        return { ok: false, resourceId: null };
      }

      if (!isOnline) {
        setMutationError('Action requires connection. Resources cannot be created offline.');
        return { ok: false, resourceId: null };
      }

      setIsSubmitting(true);
      setMutationError(null);

      try {
        const result = await apiCreateResource(
          { client, isOnline: () => isOnline, now: () => new Date() },
          { ...input, createdBy: user.id }
        );

        if (result.error) {
          setMutationError(result.error.message);
          return { ok: false, resourceId: null };
        }

        return { ok: true, resourceId: result.resourceId };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create resource';
        setMutationError(msg);
        return { ok: false, resourceId: null };
      } finally {
        setIsSubmitting(false);
      }
    },
    [user, isOnline, client]
  );

  const createAllocation = useCallback(
    async (input: Omit<SubmitAllocationInput, 'allocatedBy'>) => {
      if (!user) {
        setMutationError('Sign in required.');
        return { ok: false, allocationId: null };
      }

      if (isResourceSchemaUnavailable()) {
        const msg = 'Resource management tables are not configured in the database.';
        setMutationError(msg);
        return { ok: false, allocationId: null };
      }

      if (!isOnline) {
        setMutationError('Action requires connection. Deployments cannot be made offline.');
        return { ok: false, allocationId: null };
      }

      setIsSubmitting(true);
      setMutationError(null);

      try {
        const result = await apiCreateAllocation(
          { client, isOnline: () => isOnline, now: () => new Date() },
          { ...input, allocatedBy: user.id }
        );

        if (result.error) {
          setMutationError(result.error.message);
          return { ok: false, allocationId: null };
        }

        return { ok: true, allocationId: result.allocationId };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to allocate resource';
        setMutationError(msg);
        return { ok: false, allocationId: null };
      } finally {
        setIsSubmitting(false);
      }
    },
    [user, isOnline, client]
  );

  const updateAllocation = useCallback(
    async (input: UpdateAllocationInput) => {
      if (!user) {
        setMutationError('Sign in required.');
        return { ok: false };
      }

      if (isResourceSchemaUnavailable()) {
        const msg = 'Resource management tables are not configured in the database.';
        setMutationError(msg);
        return { ok: false };
      }

      if (!isOnline) {
        setMutationError('Action requires connection. Allocations cannot be updated offline.');
        return { ok: false };
      }

      setIsSubmitting(true);
      setMutationError(null);

      try {
        const result = await apiUpdateAllocation(
          { client, isOnline: () => isOnline, now: () => new Date() },
          input
        );

        if (result.error) {
          setMutationError(result.error.message);
          return { ok: false };
        }

        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update allocation';
        setMutationError(msg);
        return { ok: false };
      } finally {
        setIsSubmitting(false);
      }
    },
    [user, isOnline, client]
  );

  const deleteResource = useCallback(
    async (resourceId: string) => {
      if (!user) {
        setMutationError('Sign in required.');
        return { ok: false };
      }

      if (isResourceSchemaUnavailable()) {
        const msg = 'Resource management tables are not configured in the database.';
        setMutationError(msg);
        return { ok: false };
      }

      if (!isOnline) {
        setMutationError('Action requires connection. Resources cannot be deleted offline.');
        return { ok: false };
      }

      setIsSubmitting(true);
      setMutationError(null);

      try {
        const result = await apiDeleteResource(
          { client, isOnline: () => isOnline, now: () => new Date() },
          resourceId
        );

        if (result.error) {
          setMutationError(result.error.message);
          return { ok: false };
        }

        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to delete resource';
        setMutationError(msg);
        return { ok: false };
      } finally {
        setIsSubmitting(false);
      }
    },
    [user, isOnline, client]
  );

  const deleteAllocation = useCallback(
    async (allocationId: string) => {
      if (!user) {
        setMutationError('Sign in required.');
        return { ok: false };
      }

      if (isResourceSchemaUnavailable()) {
        const msg = 'Resource management tables are not configured in the database.';
        setMutationError(msg);
        return { ok: false };
      }

      if (!isOnline) {
        setMutationError('Action requires connection. Allocations cannot be deleted offline.');
        return { ok: false };
      }

      setIsSubmitting(true);
      setMutationError(null);

      try {
        const result = await apiDeleteAllocation(
          { client, isOnline: () => isOnline, now: () => new Date() },
          allocationId
        );

        if (result.error) {
          setMutationError(result.error.message);
          return { ok: false };
        }

        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to delete allocation';
        setMutationError(msg);
        return { ok: false };
      } finally {
        setIsSubmitting(false);
      }
    },
    [user, isOnline, client]
  );

  return {
    createResource,
    createAllocation,
    updateAllocation,
    deleteResource,
    deleteAllocation,
    isSubmitting,
    error: mutationError,
    clearError: () => setMutationError(null),
  };
}