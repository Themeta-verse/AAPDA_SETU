import { useCallback, useEffect } from 'react';
import {
  ensureFreshCoastalObservations,
  refreshCoastalObservations,
  useCoastalObservations,
  MONITORED_COORDINATES,
} from '@/integrations/coastalObservationsStore';
import { LIVE_MAX_AGE_MS } from '@/integrations/adapters/freshness';
import type { MarineHourlyPoint, NormalizedMarine } from '@/integrations/adapters/types';

export type { MarineHourlyPoint, NormalizedMarine } from '@/integrations/adapters/types';

export interface MarineState {
  marine: NormalizedMarine;
  error: string | null;
  refetch: () => void;
  /** True while a request pair is in flight. */
  isFetching: boolean;
}

/**
 * Marine observation state.
 *
 * This hook now READS the shared observation store rather than owning its own
 * request loop. That fixes two real problems:
 *
 *  1. Duplicate polling. `useWeatherData` and `useCoastalIntelligence` each ran
 *     their own interval against the same endpoints, for coordinates ~1 km
 *     apart, both labelled "Juhu Beach". The store serves both from one
 *     request pair per cycle.
 *  2. Frozen freshness. The adapter stamps `status` at fetch time, and this
 *     hook returned it verbatim, so a reading stayed labelled LIVE indefinitely.
 *     The store re-derives freshness on a timer, so a reading ages into STALE
 *     and then UNAVAILABLE without a refetch.
 *
 * `refetch` forces a request, bypassing the store's TTL.
 */
export function useWeatherData(intervalMs = LIVE_MAX_AGE_MS): MarineState {
  const { marine, isFetching, error } = useCoastalObservations();

  const ensure = useCallback(
    (force: boolean) => {
      const call = force
        ? refreshCoastalObservations(MONITORED_COORDINATES)
        : ensureFreshCoastalObservations(MONITORED_COORDINATES);
      return call.catch(() => {
        // The store records the failure; keep the poll loop alive.
      });
    },
    []
  );

  useEffect(() => {
    void ensure(false);
    const id = setInterval(() => void ensure(false), intervalMs);
    return () => clearInterval(id);
  }, [ensure, intervalMs]);

  const refetch = useCallback(() => void ensure(true), [ensure]);

  return {
    marine,
    error: error ? error.message : null,
    refetch,
    isFetching,
  };
}