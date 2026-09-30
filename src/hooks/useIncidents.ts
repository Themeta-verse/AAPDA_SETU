import { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import {
  createSignedIncidentPhoto,
  listIncidents,
  type Incident,
  type IncidentError,
  type IncidentClientLike,
  type SignedPhotoResult,
} from '@/integrations/supabase/incidents';
import { useAppRole, type AppRoleState } from './useAppRole';

export type { Incident, IncidentError } from '@/integrations/supabase/incidents';

/**
 * Every state the incident console can be in, as a closed union.
 *
 * The point of modelling this explicitly is that the ambiguous states are
 * forced apart. In particular:
 *
 *  - `empty` means "the read succeeded and there are zero reports you may
 *    see". It is NOT a stand-in for a failure.
 *  - `denied` means RLS refused the read. It is NOT rendered as "no reports",
 *    because telling an unauthorized caller they have no reports is itself a
 *    misleading answer.
 *  - `degraded` means rows came back but at least one was structurally
 *    unusable, so the count on screen is lower than the count in the database.
 */
export type IncidentViewState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'empty'; fetchedAt: string | null }
  | { kind: 'ready'; fetchedAt: string | null; malformedCount: number }
  | { kind: 'degraded'; fetchedAt: string | null; malformedCount: number }
  | { kind: 'denied'; error: IncidentError }
  | { kind: 'offline' }
  | { kind: 'error'; error: IncidentError };

export interface IncidentListState {
  state: IncidentViewState;
  incidents: Incident[];
  refetch: () => void;
  isRefreshing: boolean;
}

export interface UseIncidentsOptions {
  /** Injectable for tests. Defaults to the real RLS-protected client. */
  client?: IncidentClientLike;
  /** Stop polling when the viewer has no operational role. */
  enabled?: boolean;
}

export function useIncidents(
  user: User | null | undefined,
  { client, enabled = true }: UseIncidentsOptions = {}
): IncidentListState {
  const activeClient = client ?? (supabase as unknown as IncidentClientLike);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [state, setState] = useState<IncidentViewState>({ kind: 'loading' });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      // No session: there is nothing RLS could authorize.
      setIncidents([]);
      setState({ kind: 'unauthenticated' });
      return;
    }

    setIsRefreshing(true);
    const result = await listIncidents({ client: activeClient });

    if (result.error) {
      setIncidents([]);
      setState(toErrorState(result.error));
      setIsRefreshing(false);
      return;
    }

    setIncidents(result.incidents);

    const malformedCount = result.incidents.filter((i) => i.malformed).length;

    if (result.incidents.length === 0) {
      setState({ kind: 'empty', fetchedAt: result.fetchedAt });
    } else if (malformedCount > 0) {
      setState({ kind: 'degraded', fetchedAt: result.fetchedAt, malformedCount });
    } else {
      setState({ kind: 'ready', fetchedAt: result.fetchedAt, malformedCount: 0 });
    }

    setIsRefreshing(false);
  }, [user, activeClient]);

  useEffect(() => {
    if (!enabled) {
      setIncidents([]);
      setState({ kind: 'empty', fetchedAt: null });
      return;
    }
    load();
  }, [load, enabled]);

  // Manual refresh rather than Realtime: this project has no confirmed
  // Realtime publication on `incident_reports`, and enabling one is a schema
  // change. Polling would be indistinguishable from live to the operator, so
  // the UI shows a refresh control and a last-updated time rather than a
  // "LIVE" badge it cannot honestly justify.
  return { state, incidents, refetch: load, isRefreshing };
}

function toErrorState(error: IncidentError): IncidentViewState {
  switch (error.kind) {
    case 'permission-denied':
    case 'unauthenticated':
      return { kind: 'denied', error };
    case 'network':
      return { kind: 'offline' };
    default:
      return { kind: 'error', error };
  }
}

export interface UseIncidentPhotoResult {
  /** True while a signed URL is being minted. */
  isLoading: boolean;
  url: string | null;
  error: IncidentError | null;
}

/**
 * Request one incident photo.
 *
 * A signed URL is minted ONLY on an explicit viewer action, lives in component
 * state, and disappears when the request is reset. It is never written to the
 * database, localStorage, or a shared cache, because it grants download access
 * to a private object until it expires.
 *
 * Refuses to run without a photo path, so "no photo" never becomes an error
 * about a photo.
 */
export function useIncidentPhoto(): {
  photo: UseIncidentPhotoResult;
  load: (photoPath: string, client?: IncidentClientLike) => Promise<void>;
  reset: () => void;
} {
  const [photo, setPhoto] = useState<UseIncidentPhotoResult>({
    isLoading: false,
    url: null,
    error: null,
  });

  const load = useCallback(async (photoPath: string, client?: IncidentClientLike) => {
    const activeClient = client ?? (supabase as unknown as IncidentClientLike);

    if (!photoPath) {
      setPhoto({
        isLoading: false,
        url: null,
        error: { kind: 'malformed', message: 'No photo path was provided for this report.' },
      });
      return;
    }

    setPhoto({ isLoading: true, url: null, error: null });
    const result: SignedPhotoResult = await createSignedIncidentPhoto(
      { client: activeClient },
      photoPath
    );
    setPhoto({ isLoading: false, url: result.url, error: result.error });
  }, []);

  const reset = useCallback(() => {
    setPhoto({ isLoading: false, url: null, error: null });
  }, []);

  return { photo, load, reset };
}

export type { AppRoleState };
export { useAppRole };