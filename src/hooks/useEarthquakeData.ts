import { useState, useEffect, useCallback } from 'react';
import {
  emptyEarthquakeReading,
  buildUsgsFeedUrl,
  fetchEarthquakeFeed,
  resolveTsunamiFlag,
} from '@/integrations/adapters/usgsEarthquake';
import { resolveFreshness } from '@/integrations/adapters/freshness';
import type { NormalizedEarthquake, NormalizedEarthquakeFeed } from '@/integrations/adapters/types';

/**
 * Lifecycle and state only. Transport, validation and normalisation all live
 * in the USGS adapter.
 */
export interface EarthquakeState {
  events: NormalizedEarthquake[];
  /** Tri-state: true / false / null when the source cannot support a claim. */
  tsunamiFlag: boolean | null;
  /** Freshness of the earthquake source, recomputed on every render tick. */
  status: NormalizedEarthquakeFeed['status'];
  /** Timestamp of the last successfully parsed feed, ISO-8601. */
  fetchedAt: string | null;
  /** Timestamp USGS generated this feed, ISO-8601. */
  feedGeneratedAt: string | null;
  source: NormalizedEarthquakeFeed['source'];
  totalInFeed: number;
  error: NormalizedEarthquakeFeed['error'];
  refetch: () => void;
}

export type { NormalizedEarthquake, NormalizedEarthquakeFeed };

export function useEarthquakeData(intervalMs = 300000): EarthquakeState {
  const [feed, setFeed] = useState<NormalizedEarthquakeFeed>(() =>
    emptyEarthquakeReading(buildUsgsFeedUrl('all_day'))
  );

  const fetchData = useCallback(async () => {
    const next = await fetchEarthquakeFeed({ window: 'all_day', regionOnly: true });
    setFeed(next);
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, intervalMs);
    return () => clearInterval(id);
  }, [fetchData, intervalMs]);

  // A retained reading must age. The adapter stamps freshness at fetch time;
  // re-deriving here means a quiet tab stops claiming "live" once the reading
  // passes the shared staleness window.
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  const status = resolveFreshness(feed.fetchedAt, feed.fetchedAt !== null, new Date(), isOnline);

  return {
    events: feed.events,
    tsunamiFlag: resolveTsunamiFlag({ ...feed, status }),
    status,
    fetchedAt: feed.fetchedAt,
    feedGeneratedAt: feed.feedGeneratedAt,
    source: feed.source,
    totalInFeed: feed.totalInFeed,
    error: feed.error,
    refetch: fetchData,
  };
}