import { useState, useEffect, useCallback } from 'react';
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

import type { User } from '@supabase/supabase-js';

export interface UseResourcesOptions {
  client?: any;
  user?: User | null;
}

export function useResources(options?: UseResourcesOptions) {
  const { user: authUser } = useAuth();
  const user = options?.user !== undefined ? options.user : authUser;
  const userId = user?.id;
  const { isOnline } = useNetworkStatus();
  const client = options?.client ?? supabase;

  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);

  const fetchResources = useCallback(async () => {
    if (!user) {
      setResources([]);
      setLoading(false);
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
  }, [userId, isOnline, client]);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  return {
    resources,
    loading,
    error,
    refetch: fetchResources,
    fetchedAt,
    isOnline,
    isCached,
  };
}

export function useResourceAllocations(options?: UseResourcesOptions) {
  const { user: authUser } = useAuth();
  const user = options?.user !== undefined ? options.user : authUser;
  const userId = user?.id;
  const { isOnline } = useNetworkStatus();
  const client = options?.client ?? supabase;

  const [allocations, setAllocations] = useState<ResourceAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const fetchAllocations = useCallback(async () => {
    if (!user) {
      setAllocations([]);
      setLoading(false);
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
  }, [userId, isOnline, client]);

  useEffect(() => {
    fetchAllocations();
  }, [fetchAllocations]);

  return {
    allocations,
    loading,
    error,
    refetch: fetchAllocations,
    fetchedAt,
    isOnline,
  };
}

export function useResourceAuditLogs(options?: UseResourcesOptions) {
  const { user: authUser } = useAuth();
  const user = options?.user !== undefined ? options.user : authUser;
  const userId = user?.id;
  const { isOnline } = useNetworkStatus();
  const client = options?.client ?? supabase;

  const [logs, setLogs] = useState<ResourceAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!user) {
      setLogs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await listResourceAuditLogs({
        client,
        isOnline: () => isOnline,
      });

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
  }, [userId, isOnline, client]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return {
    logs,
    loading,
    error,
    refetch: fetchLogs,
  };
}

export function useResourceCompatibility(options?: UseResourcesOptions) {
  const { user: authUser } = useAuth();
  const user = options?.user !== undefined ? options.user : authUser;
  const userId = user?.id;
  const { isOnline } = useNetworkStatus();
  const client = options?.client ?? supabase;

  const [compatibilities, setCompatibilities] = useState<ResourceIncidentCompatibility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCompatibilities = useCallback(async () => {
    if (!user) {
      setCompatibilities([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await listResourceIncidentCompatibility({
        client,
        isOnline: () => isOnline,
      });

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
  }, [userId, isOnline, client]);

  useEffect(() => {
    fetchCompatibilities();
  }, [fetchCompatibilities]);

  return {
    compatibilities,
    loading,
    error,
    refetch: fetchCompatibilities,
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