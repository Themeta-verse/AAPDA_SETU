import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildMarineUrl,
  buildForecastUrl,
  MARINE_SOURCE_ID,
  WEATHER_SOURCE_ID,
} from '@/integrations/adapters/openMeteoMarine';
import { fetchEarthquakeFeed } from '@/integrations/adapters/usgsEarthquake';
import type {
  NormalizedEarthquake,
  NormalizedEarthquakeFeed,
} from '@/integrations/adapters/types';
import {
  fetchOfficialWarnings,
} from '@/integrations/adapters/officialWarnings';
import {
  summarizeOfficialWarnings,
  confirmedWarningAuthority,
  type OfficialWarningProduct,
} from '@/lib/officialWarnings';
import { extractHazardFeatures, type ForecastPoint } from '@/integrations/adapters/hazardFeatures';
import { FORECAST_HORIZON_HOURS } from '@/integrations/adapters/openMeteoForecast';
import {
  ensureFreshCoastalObservations,
  refreshCoastalObservations,
  useCoastalObservations,
  MONITORED_COORDINATES as STORE_COORDINATES,
  OBSERVATION_REFRESH_MS,
} from '@/integrations/coastalObservationsStore';
import { buildOutlook, type Outlook } from '@/risk/outlook';
import {
  assessCoastalRisk,
  assessDataQuality,
  emptySeismicFeatures,
  evaluateForecastHour,
  type CoastalRiskAssessment,
  type CoastalRiskState,
  type HazardFeatures,
  type SeismicFeatures,
} from '@/risk/engine';
import { buildRiskExplanation, detectTransition, type RiskExplanation } from '@/risk/explain';
import {
  buildEvent,
  dedupeEvents,
  type BayWatchEvent,
  type CoastalRiskTransition,
} from '@/notifications/types';
import {
  diffSnapshots,
  emptyObservationSnapshot,
  mergeEvents,
  snapshotFromState,
  MAX_EVENTS,
  type ObservationSnapshot,
} from '@/events/transitions';
import { subscribeToActionEvents } from '@/events/eventBus';
import {
  acknowledgeAll,
  acknowledgeNotification,
  dedupeNotifications,
  evaluateNotificationRules,
  loadNotifications,
  readNotificationPermission,
  requestNotificationPermission,
  saveNotifications,
  showBrowserNotification,
  type BayWatchNotification,
  type NotificationPermissionState,
} from '@/notifications/engine';
import type {
  AdapterDeps,
  Coordinates,
  NormalizedMarine,
  Provenance,
  SourceStatus,
} from '@/integrations/adapters/types';

/**
 * The Juhu Beach coordinate the platform monitors.
 *
 * This is a real, fixed monitoring location chosen by the project, not a
 * fabricated data point: it is the same coordinate the existing geolocation
 * helpers use as the coastal reference point.
 *
 * It is defined in the shared observation store so that every consumer polls
 * the SAME point. Two hooks previously used coordinates ~1 km apart while both
 * labelled their reading "Juhu Beach", which meant the hero and the command
 * center could legitimately disagree about conditions at one beach.
 */
export const MONITORED_COORDINATES: Coordinates = STORE_COORDINATES;

/** Refresh intervals, chosen per source to avoid hammering official services. */
export const REFRESH_INTERVALS = {
  /** Marine/weather: Open-Meteo updates roughly every 15 min. */
  marineMs: 10 * 60 * 1000,
  /** USGS: the all_day feed changes continuously; 5 min is ample. */
  seismicMs: 5 * 60 * 1000,
  /** IMD/INCOIS: probed far less often because they are bulletin pages. */
  warningsMs: 30 * 60 * 1000,
} as const;

/**
 * Stable defaults for the option bag.
 *
 * These MUST be module-level singletons. An inline `= {}` or `= () => new Date()`
 * default allocates a new identity on every render, which invalidates the
 * `useCallback` chains below, which tears down and re-runs the polling effect on
 * every render — and because each run calls `setOfficialWarnings` with a fresh
 * array, that re-render feeds itself into an infinite fetch loop.
 */
const EMPTY_DEPS = {} as const;
const systemNow = () => new Date();

export interface SourceFetchState {
  status: SourceStatus;
  lastSuccessfulFetch: string | null;
  lastAttemptedFetch: string | null;
  nextRefreshAt: string | null;
  errorKind: string | null;
  errorMessage: string | null;
}

/**
 * An honest "nothing read yet" earthquake feed.
 *
 * Every count is zero and every timestamp is null, so a UI cannot mistake an
 * unfetched feed for a genuinely empty one.
 */
function emptyEarthquakeFeed(): NormalizedEarthquakeFeed {
  return {
    events: [],
    totalInFeed: 0,
    rejectedCount: 0,
    feedGeneratedAt: null,
    source: {
      id: 'usgs-earthquakes',
      label: 'USGS Earthquake Hazards Program',
      authority: 'official',
      url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      observedAt: null,
    },
    status: 'unavailable',
    fetchedAt: null,
    error: null,
  };
}

const idleFetchState: SourceFetchState = {  status: 'unavailable',
  lastSuccessfulFetch: null,
  lastAttemptedFetch: null,
  nextRefreshAt: null,
  errorKind: null,
  errorMessage: null,
};

export interface CoastalIntelligenceState {
  assessment: CoastalRiskAssessment;
  explanation: RiskExplanation;
  features: HazardFeatures;
  seismic: SeismicFeatures;
  /**
   * Regional earthquakes from the most recent USGS read.
   *
   * Exposed on the shared state so the monitoring dashboard can list real events
   * without instantiating a second `useEarthquakeData()` polling pipeline, which
   * is what previously caused three identical USGS requests per page load.
   */
  earthquakes: NormalizedEarthquakeFeed;
  marine: NormalizedMarine;
  forecast: ForecastPoint[];
  /** Transparent rule-based projection over the same 48 forecast hours. */
  outlook: Outlook;
  officialWarnings: OfficialWarningProduct[];
  /** Timestamps the source published for the newest forecast point. */
  forecastSourceIssuedAt: string | null;
  provenance: Provenance[];
  transitions: CoastalRiskTransition[];
  events: BayWatchEvent[];
  notifications: BayWatchNotification[];
  notificationPermission: NotificationPermissionState;
  persistenceUnavailable: boolean;
  fetchState: Record<'marine' | 'seismic' | 'warnings', SourceFetchState>;
  /**
   * True while the marine/weather request pair is in flight.
   *
   * This is a REAL in-flight flag, not "has an attempt been recorded". The
   * refresh button previously spun its loader off a value that was set on the
   * first cycle and never cleared, so the spinner could only ever appear before
   * the first fetch completed.
   */
  isFetching: boolean;
  /** HTTP 429 cooldown expiry, when the source rate-limited us. */
  rateLimitedUntil: string | null;
  isOnline: boolean;
  refresh: () => void;
  acknowledge: (id: string) => void;
  acknowledgeAll: () => void;
  requestPermission: () => Promise<NotificationPermissionState>;
}

export interface UseCoastalIntelligenceOptions {
  coordinates?: Coordinates;
  /**
   * Adapter injection points.
   *
   * The object is read through a ref, so callers may pass an inline literal
   * (`deps: { fetchImpl }`) without restarting the polling lifecycle. See the
   * stability note on `depsRef` below — this mattered in practice.
   */
  deps?: AdapterDeps;
  /**
   * Optional Supabase client used to reach the JWT-gated `official-warnings`
   * Edge Function. When absent, warning retrieval reports unreachable rather
   * than skipping silently.
   */
  supabase?: OfficialWarningSupabaseClient;
  /** Disable browser notifications entirely (used in tests). */
  enableBrowserNotifications?: boolean;
  now?: () => Date;
}

/** Minimal client shape needed to invoke the warnings function. */
export interface OfficialWarningSupabaseClient {
  functions: {
    invoke: (
      fn: string,
      opts?: { body?: unknown },
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
}

const EARTHQUAKE_REGION = { minLatitude: 5, maxLatitude: 25, minLongitude: 60, maxLongitude: 90 };

/**
 * Compose every verified source into one coherent state.
 *
 * This hook owns the polling lifecycle, the freshness stamping, and the
 * transition/notification bookkeeping. All numerical interpretation happens in
 * the risk engine; this layer only fetches, normalizes and records.
 */
export function useCoastalIntelligence({
  coordinates = MONITORED_COORDINATES,
  deps = EMPTY_DEPS,
  supabase,
  enableBrowserNotifications = true,
  now = systemNow,
}: UseCoastalIntelligenceOptions): CoastalIntelligenceState {
  // Marine + weather now come from one shared store: a single request pair per
  // cycle, shared by every subscriber, with freshness aging on a timer.
  const observations = useCoastalObservations();
  const marine = observations.marine;
  const forecastData = observations.forecast;

  const [seismic, setSeismic] = useState<SeismicFeatures>(emptySeismicFeatures);
  // Retained so the shared state can present the real earthquake list, feed
  // metadata and validation-rejection count without any component starting a
  // second USGS polling pipeline.
  const [earthquakeState, setEarthquakeState] =
    useState<NormalizedEarthquakeFeed>(emptyEarthquakeFeed());
  const [seismicSource, setSeismicSource] = useState<{
    url: string;
    retrievedAt: string | null;
    status: SourceStatus;
  }>({ url: '', retrievedAt: null, status: 'unavailable' });
  const [officialWarnings, setOfficialWarnings] = useState<OfficialWarningProduct[]>([]);  const [fetchState, setFetchState] = useState<
    Record<'marine' | 'seismic' | 'warnings', SourceFetchState>
  >({
    marine: idleFetchState,
    seismic: idleFetchState,
    warnings: idleFetchState,
  });
  const [events, setEvents] = useState<BayWatchEvent[]>([]);
  const [transitions, setTransitions] = useState<CoastalRiskTransition[]>([]);
  /**
   * Stable ids of the regional earthquakes in the most recent USGS read.
   *
   * Held as state (not derived from the feed on the fly) so the observation
   * diff has a stable "previous" to compare against and can tell a new
   * earthquake from the same one being re-listed on the next poll.
   */
  const [seismicEventIdsState, setSeismicEventIds] = useState<string[]>([]);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  // Refs hold the previous evaluation so transitions can be detected without
  // forcing an extra render.
  const previousFeaturesRef = useRef<HazardFeatures | null>(null);
  const previousStateRef = useRef<CoastalRiskState | null>(null);

  // --- stability of injected options -------------------------------------
  //
  // `deps`, `supabase` and `now` are read through refs and are never used as
  // hook dependencies.
  //
  // This is not stylistic. The lifecycle effect depends on `requestMarine`,
  // which depends on `deps`. A caller passing an inline object literal
  // (`deps: { fetchImpl }`) therefore changes `deps` identity on every render,
  // which recreates `requestMarine`, which tears down and re-runs the lifecycle
  // effect, which fetches again, which sets state, which re-renders. Measured
  // against an instantly-resolving `fetchImpl`, that loop issued 1,986 requests
  // in 3 seconds.
  //
  // In production the loop was invisible because the default `EMPTY_DEPS` is
  // stable and real network latency throttled each cycle — the defect was
  // masked, not absent. Reading the injected values through refs removes the
  // dependence on caller discipline entirely.
  const depsRef = useRef<AdapterDeps>(deps);
  depsRef.current = deps;
  const supabaseRef = useRef<OfficialWarningSupabaseClient | undefined>(supabase);
  supabaseRef.current = supabase;
  const nowRef = useRef(now);
  nowRef.current = now;

  // --- notifications: hydrate once from storage -------------------------
  const [notificationState] = useState(() => loadNotifications());
  const [notifications, setNotifications] = useState<BayWatchNotification[]>(
    notificationState.notifications
  );
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    readNotificationPermission()
  );

  /**
   * Merge externally produced events into the single stream.
   *
   * The stream is stored NEWEST-FIRST so the panel never has to sort, and the
   * incoming batch is reversed to match. Deduplication is by `kind` + `summary`,
   * which is what stops the same real-world occurrence being logged twice when
   * it is observed on consecutive polls.
   */
  const appendEvents = useCallback((incoming: BayWatchEvent[]) => {
    if (incoming.length === 0) return;
    setEvents((prev) =>
      [...incoming].reverse().concat(
        dedupeEvents(prev, incoming, (e) => `${e.kind}:${e.summary}`)
      ).slice(0, MAX_EVENTS)
    );
  }, []);

  // --- marine + weather: delegated to the shared store --------------------
  //
  // This hook no longer issues its own marine request. `ensureFresh...` is
  // single-flight and TTL-guarded, so mounting this hook and `useWeatherData`
  // together still costs exactly one request pair per cycle. The previous
  // implementation fetched both URLs here AND again further down to read
  // variables the URL had never requested.
  const requestMarine = useCallback(
    (force: boolean) =>
      (force
        ? refreshCoastalObservations(coordinates, depsRef.current)
        : ensureFreshCoastalObservations(coordinates, depsRef.current)
      ).catch(() => {
        // The store records the failure; swallowing here keeps the poll loop alive.
      }),
    [coordinates]
  );

  // Mirror the store's marine outcome into this hook's fetch-state panel, so
  // the Data Quality UI reads from one place rather than two.
  useEffect(() => {
    const attemptedAt = observations.lastAttemptedAt;
    if (!attemptedAt) return;

    setFetchState((prev) => {
      const nextStatus = observations.marine.status;
      const nextErrorKind = observations.marine.error?.kind ?? null;
      const nextErrorMessage = observations.marine.error?.message ?? null;
      if (
        prev.marine.status === nextStatus &&
        prev.marine.lastAttemptedFetch === attemptedAt &&
        prev.marine.errorKind === nextErrorKind &&
        prev.marine.errorMessage === nextErrorMessage
      ) {
        return prev;
      }
      return {
        ...prev,
        marine: {
          status: nextStatus,
          lastAttemptedFetch: attemptedAt,
          lastSuccessfulFetch: observations.fetchedAt ?? prev.marine.lastSuccessfulFetch,
          nextRefreshAt: observations.fetchedAt
            ? new Date(now().getTime() + OBSERVATION_REFRESH_MS).toISOString()
            : prev.marine.nextRefreshAt,
          errorKind: nextErrorKind,
          errorMessage: nextErrorMessage,
        },
      };
    });
  }, [observations, now]);

  // NOTE: the per-poll "source-updated" event that used to live here has been
  // removed. A completed poll is not an event. Source transitions (becoming
  // unavailable, recovering) and threshold crossings are recorded centrally in
  // the observation-diff effect further down, which only fires on real change.

  // --- seismic fetch ----------------------------------------------------
  const fetchSeismic = useCallback(async () => {
    const attemptedAt = nowRef.current().toISOString();
    const feed = await fetchEarthquakeFeed(
      {
        window: 'all_day',
        regionOnly: true,
        ...EARTHQUAKE_REGION,
      },
      // `deps` is the adapter's SECOND parameter. Merging it into the options
      // object silently discarded it: the adapter destructures only `window`
      // and `regionOnly` from options, so `fetchImpl` was dropped and USGS
      // always fell back to `globalThis.fetch`. Tests therefore never saw a
      // request they could count, and the hook ignored any injected transport.
      depsRef.current
    );

    const strongest = feed.events.reduce<{
      magnitude: number | null;
      depthKm: number | null;
      url: string | null;
      tsunamiFlag: boolean | null;
      tsunamiAuthoritative: boolean;
      count: number;
    }>(
      (acc, event) => {
        if (acc.magnitude === null || (event.magnitude !== null && event.magnitude > acc.magnitude)) {
          acc.magnitude = event.magnitude;
          acc.depthKm = event.depthKm;
          acc.url = event.eventUrl;
        }
        // USGS tsunami flag is tri-state; keep the strongest positive flag.
        if (event.tsunami === true) {
          acc.tsunamiFlag = true;
          acc.tsunamiAuthoritative = true;
        } else if (acc.tsunamiFlag === null && event.tsunami === false) {
          acc.tsunamiFlag = false;
          acc.tsunamiAuthoritative = true;
        }
        acc.count += 1;
        return acc;
      },
      {
        magnitude: null,
        depthKm: null,
        url: null,
        tsunamiFlag: null,
        tsunamiAuthoritative: false,
        count: 0,
      }
    );

    setSeismic({
      seismicMagnitude: strongest.magnitude,
      seismicDepthKm: strongest.depthKm,
      tsunamiFlag: strongest.tsunamiFlag,
      tsunamiFlagAuthoritative: strongest.tsunamiAuthoritative,
      eventCount: strongest.count,
    });
    setSeismicSource({ url: feed.source.url, retrievedAt: feed.fetchedAt, status: feed.status });
    // Keep the parsed feed so the UI can list real events, show the feed's own
    // timestamps, and state how many malformed rows validation excluded.
    setEarthquakeState(feed);
    // Stable ids of the regional events in this read, so the observation diff
    // can distinguish a genuinely NEW earthquake from the same earthquake being
    // listed again on the next poll.
    setSeismicEventIds(feed.events.map((e) => e.id));

    setFetchState((prev) => ({
      ...prev,
      seismic: {
        status: feed.status,
        lastAttemptedFetch: attemptedAt,
        lastSuccessfulFetch: feed.fetchedAt ?? prev.seismic.lastSuccessfulFetch,
        nextRefreshAt: feed.fetchedAt
          ? new Date(now().getTime() + REFRESH_INTERVALS.seismicMs).toISOString()
          : prev.seismic.nextRefreshAt,
        errorKind: feed.error?.kind ?? null,
        errorMessage: feed.error?.message ?? null,
      },
    }));

    // New regional events and USGS feed failures are recorded centrally by the
    // observation-diff effect, which compares against the previously observed
    // set of event ids and the previous source status. Emitting an event per
    // successful poll here produced a duplicate entry every 5 minutes.
  }, []);

  // --- official warnings probe ------------------------------------------
  const fetchWarnings = useCallback(async () => {
    const attemptedAt = now().toISOString();

    // IMD and INCOIS cannot be read from a browser, so retrieval runs through
    // the JWT-gated `official-warnings` Edge Function. The CORS barrier is a
    // browser-only restriction, so the server can reach these hosts — which is
    // what lets the blocker below be a measured finding rather than a guess.
    const lookup = await fetchOfficialWarnings(supabaseRef.current);
    const products = lookup.products;
    setOfficialWarnings(products);

    // A product counts as readable only when the retriever actually parsed
    // something. Today it parses nothing, so this is false by design and the
    // resulting error message says exactly why rather than blaming CORS.
    const anyReadable = products.some((p) => p.status === 'live');

    setFetchState((prev) => ({
      ...prev,
      warnings: {
        status: anyReadable ? 'live' : 'unavailable',
        lastAttemptedFetch: attemptedAt,
        lastSuccessfulFetch: anyReadable ? attemptedAt : prev.warnings.lastSuccessfulFetch,
        nextRefreshAt: new Date(now().getTime() + REFRESH_INTERVALS.warningsMs).toISOString(),
        errorKind: anyReadable ? null : lookup.unreachable ? 'unreachable' : 'no-bulletin-content',
        errorMessage: anyReadable ? null : lookup.detail,
      },
    }));

    appendEvents(
      products
        .filter((s) => s.active === true)
        .map((s) =>
          buildEvent({
            kind: 'official-warning-detected',
            at: attemptedAt,
            summary: `${s.authority} reports an active warning: ${s.label}`,
            source: String(s.authority),
            link: s.url,
            data: { productId: s.productId },
          })
        )
    );
  }, [appendEvents]);

  // --- lifecycle --------------------------------------------------------
  useEffect(() => {
    const runAll = async () => {
      // Marine/weather and USGS are independent official sources; probing IMD
      // and INCOIS is slower, so they run on their own longer interval below.
      await Promise.all([requestMarine(false), fetchSeismic()]);
    };

    void runAll();
    void fetchWarnings();

    const marineTimer = setInterval(
      () => void requestMarine(false),
      REFRESH_INTERVALS.marineMs
    );
    const seismicTimer = setInterval(() => void fetchSeismic(), REFRESH_INTERVALS.seismicMs);
    const warningTimer = setInterval(() => void fetchWarnings(), REFRESH_INTERVALS.warningsMs);

    return () => {
      clearInterval(marineTimer);
      clearInterval(seismicTimer);
      clearInterval(warningTimer);
    };
  }, [requestMarine, fetchSeismic, fetchWarnings]);

  // --- connectivity -----------------------------------------------------
  useEffect(() => {
    const goOffline = () => {
      setIsOnline(false);
      appendEvents([
        buildEvent({
          kind: 'went-offline',
          at: now().toISOString(),
          summary: 'Browser went offline. Retained data is marked stale.',
          source: 'Browser',
        }),
      ]);
    };
    const goOnline = () => {
      setIsOnline(true);
      appendEvents([
        buildEvent({
          kind: 'came-online',
          at: now().toISOString(),
          summary: 'Browser came back online. Refreshing sources.',
          source: 'Browser',
        }),
      ]);
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [now]);

  // --- derived: hazard features ----------------------------------------
  //
  // Swell, ocean current and SST now arrive on the normalized reading itself
  // (they were previously read from a side channel whose URL never requested
  // them, so they were permanently null while provenance claimed otherwise).
  const extraction = useMemo(() => extractHazardFeatures(marine, null, null), [marine]);

  const features = extraction.features;

  // --- forecast timeline ------------------------------------------------
  //
  // Built from the already-validated, already-joined hours in the store. This
  // layer adds no parsing: it drops elapsed hours, caps the horizon, and runs
  // the shared rule table. If the source published fewer hours than the
  // horizon, the shorter list is what renders.
  const forecast = useMemo<ForecastPoint[]>(() => {
    if (forecastData.hours.length === 0) return [];

    // The current hour is still partly ahead of us, so we start one hour back
    // rather than dropping the in-progress hour entirely.
    const cutoffMs = now().getTime() - 60 * 60 * 1000;

    return forecastData.hours
      .filter((hour) => hour.epochMs >= cutoffMs)
      .slice(0, FORECAST_HORIZON_HOURS)
      .map((hour): ForecastPoint => {
        const evaluation = evaluateForecastHour({
          waveHeightM: hour.waveHeightM,
          swellHeightM: hour.swellHeightM,
          wavePeriodS: hour.wavePeriodS,
          windSpeedKmh: hour.windSpeedKmh,
          windGustKmh: hour.windGustKmh,
          precipitationMm: hour.precipitationMm,
          precipitationProbabilityPct: hour.precipitationProbabilityPct,
          visibilityM: hour.visibilityM,
        });

        return {
          time: hour.time,
          isoTime: hour.isoTime,
          waveHeightM: hour.waveHeightM,
          swellHeightM: hour.swellHeightM,
          wavePeriodS: hour.wavePeriodS,
          windSpeedKmh: hour.windSpeedKmh,
          windGustKmh: hour.windGustKmh,
          precipitationMm: hour.precipitationMm,
          precipitationProbabilityPct: hour.precipitationProbabilityPct,
          visibilityM: hour.visibilityM,
          hazardState: evaluation.state,
          ruleIds: evaluation.ruleIds,
          sourceStatus: forecastData.status,
        };
      });
  }, [forecastData, now]);

  // --- derived: transparent 48-hour outlook --------------------------------
  //
  // Built from the same `forecast` hours the timeline renders, so the outlook
  // and the timeline can never disagree. It applies the same rule table as the
  // current-conditions assessment and adds no thresholds of its own.
  const outlook = useMemo(
    () =>
      buildOutlook(
        forecast.map((point) => ({
          at: point.isoTime,
          values: {
            waveHeightM: point.waveHeightM,
            swellHeightM: point.swellHeightM,
            wavePeriodS: point.wavePeriodS,
            windSpeedKmh: point.windSpeedKmh,
            windGustKmh: point.windGustKmh,
            precipitationMm: point.precipitationMm,
            precipitationProbabilityPct: point.precipitationProbabilityPct,
            visibilityM: point.visibilityM,
          },
        })),
        FORECAST_HORIZON_HOURS,
      ),
    [forecast],
  );

  // --- derived: official warning summary --------------------------------
  const warningSummary = useMemo(() => summarizeOfficialWarnings(officialWarnings), [officialWarnings]);

  // Null unless a warning was actually issued. Naming an authority that did not
  // issue anything would imply a real bulletin exists.
  const warningAuthority = useMemo(
    () => confirmedWarningAuthority(officialWarnings),
    [officialWarnings],
  );

  // --- derived: quality + assessment ------------------------------------
  //
  // Marine and weather freshness are tracked separately so one failing endpoint
  // cannot mark the whole reading unavailable while the other is serving data.
  const quality = useMemo(
    () =>
      assessDataQuality({
        marineStatus: marine.status,
        weatherStatus: forecastData.weatherStatus,
        marineFetchedAt: marine.fetchedAt,
        weatherFetchedAt: forecastData.fetchedAt,
        marineErrorKind: marine.error?.kind ?? null,
        weatherErrorKind: forecastData.error?.kind ?? null,
        rejectedRecords: forecastData.rejectedCount,
        missingFields: extraction.missingFields,
        warningsUnreadable: officialWarnings.some((w) => w.active === null),
        now: now(),
      }),
    [marine, forecastData, extraction.missingFields, officialWarnings, now]
  );

  const assessment = useMemo(
    () =>
      assessCoastalRisk(
        { features, seismic, officialWarnings, officialWarningActive: warningSummary },
        quality,
        now
      ),
    [features, seismic, officialWarnings, warningSummary, quality, now]
  );

  // --- central observation diff: the ONLY source of polled-state events ----
  //
  // Everything above this effect used to append an event per completed poll.
  // This effect instead compares a comparable projection of current state with
  // the previous one and records an event only for a genuine transition:
  // a source becoming unavailable or recovering, a documented risk threshold
  // being crossed or cleared, the canonical verdict changing, the tri-state
  // official-warning or tsunami value changing, or a genuinely new regional
  // earthquake appearing in the USGS feed.
  //
  // An unchanged poll produces an empty change list and appends nothing, so the
  // stream stays quiet while conditions hold steady.
  const previousSnapshotRef = useRef<ObservationSnapshot>(emptyObservationSnapshot());
  const seismicEventIds = useMemo(() => seismicEventIdsState, [seismicEventIdsState]);

  useEffect(() => {
    const snapshot = snapshotFromState({
      assessment,
      marineStatus: marine.status,
      weatherStatus: forecastData.weatherStatus,
      seismicStatus: seismicSource.status,
      officialWarningAuthority: warningAuthority,
      earthquakeIds: seismicEventIds,
      waveHeightM: features.waveHeightM,
      wavePeriodS: features.wavePeriodS,
      windSpeedKmh: features.windSpeedKmh,
      windGustKmh: features.windGustKmh,
    });

    const changes = diffSnapshots(previousSnapshotRef.current, snapshot);
    previousSnapshotRef.current = snapshot;

    if (changes.length === 0) return;
    setEvents((prev) => mergeEvents(prev, changes, assessment.evaluatedAt));
  }, [
    assessment,
    marine.status,
    forecastData.weatherStatus,
    seismicSource.status,
    seismicSource.retrievedAt,
    warningAuthority,
    seismicEventIds,
    features.waveHeightM,
    features.wavePeriodS,
    features.windSpeedKmh,
    features.windGustKmh,
  ]);

  // Action events (GPS, routing, voice, manual refresh) originate in
  // components that do not own an event stream. They are folded into this one.
  useEffect(() => subscribeToActionEvents((event) => {
    setEvents((prev) =>
      [event, ...prev].slice(0, MAX_EVENTS).filter(
        (existing, index, all) => all.findIndex((e) => e.id === existing.id) === index
      )
    );
  }), []);

  // --- transitions + notifications --------------------------------------
  useEffect(() => {
    const transition = detectTransition({
      previousState: previousStateRef.current,
      previousFeatures: previousFeaturesRef.current,
      currentFeatures: features,
      assessment,
      at: assessment.evaluatedAt,
      source: 'BayWatch risk engine',
    });

    if (transition) {
      const record: CoastalRiskTransition = {
        id: `trn_${transition.at.replace(/[^0-9]/g, '')}_${transition.newState}`,
        previousState: transition.previousState,
        newState: transition.newState,
        at: transition.at,
        ruleIds: transition.ruleIds,
        triggeringInputs: transition.triggeringInputs,
        source: transition.source,
      };
      setTransitions((prev) => [...prev, record].slice(-50));
      // The event-stream entry for this transition is emitted by the central
      // observation-diff effect below, so a risk change is recorded exactly
      // once. This effect owns the persisted transition record only, because
      // only it has the triggering input values.
    }

    // --- notifications ---------------------------------------------------
    const worstForecast = forecast.reduce<
      { state: ForecastPoint['hazardState']; hours: number | null }
    >((acc, point) => {
      const order = ['nominal', 'insufficient-data', 'elevated', 'high', 'severe'] as const;
      const pointRank = order.indexOf(point.hazardState);
      const accRank = order.indexOf(acc.state);
      if (pointRank > accRank) {
        const hours = Math.round((Date.parse(point.isoTime) - Date.parse(assessment.evaluatedAt)) / 3600000);
        return { state: point.hazardState, hours: hours > 0 ? hours : null };
      }
      return acc;
    }, { state: 'nominal' as const, hours: null });

    const candidates = evaluateNotificationRules({
      riskState: assessment.state,
      previousRiskState: previousStateRef.current,
      officialWarningActive: warningSummary,
      tsunamiStatus: assessment.tsunamiStatus,
      tsunamiAuthoritative: assessment.tsunamiAuthoritative,
      maxMagnitude: seismic.seismicMagnitude,
      earthquakeUrl: null,
      worstForecastState: worstForecast.state,
      worstForecastHours: worstForecast.hours,
      anySourceUnavailable: marine.status === 'unavailable',
      sourceStatus: marine.status,
      evaluatedAt: assessment.evaluatedAt,
    });

    if (candidates.length > 0) {
      const added = dedupeNotifications(notifications, candidates, assessment.evaluatedAt).filter(
        (n) => !notifications.some((existing) => existing.id === n.id)
      );

      if (added.length > 0) {
        setNotifications(dedupeNotifications(notifications, candidates, assessment.evaluatedAt));
        saveNotifications(dedupeNotifications(notifications, candidates, assessment.evaluatedAt));

        if (enableBrowserNotifications) {
          for (const n of added) showBrowserNotification(n);
        }

        appendEvents(
          added.map((n) =>
            buildEvent({
              kind: 'notification-generated',
              at: assessment.evaluatedAt,
              summary: `Notification: ${n.title}`,
              source: n.source,
              data: { rule: n.rule, eventKey: n.eventKey },
            })
          )
        );
      }
    }

    previousFeaturesRef.current = features;
    previousStateRef.current = assessment.state;
  }, [
    features,
    assessment,
    forecast,
    outlook,
    seismic,
    warningSummary,
    marine.status,
    notifications,
    enableBrowserNotifications,
  ]);

  // --- provenance -------------------------------------------------------
  // Declared BEFORE `explanation`, which consumes it. Hook order is stable
  // either way, but referencing a `const` before its initialization would
  // throw at render time.
  const provenance = useMemo<Provenance[]>(() => {
    const entries: Provenance[] = [
      {
        sourceId: MARINE_SOURCE_ID,
        sourceName: 'Open-Meteo Marine',
        url: buildMarineUrl(coordinates),
        authority: 'Open-Meteo',
        issuedAt: marine.source.observedAt,
        validFrom: forecastData.validFrom,
        validUntil: forecastData.validUntil,
        retrievedAt: marine.fetchedAt,
        status: marine.status,
        fieldsUsed: [
          'wave_height',
          'wave_period',
          'wave_direction',
          'swell_wave_height',
          'swell_wave_direction',
          'ocean_current_velocity',
          'sea_surface_temperature',
        ],
        limitations: [
          'Model-based forecast, not an observation from an Indian government authority.',
          'Swell and current fields are absent when the model run does not publish them.',
        ],
      },
      {
        sourceId: WEATHER_SOURCE_ID,
        sourceName: 'Open-Meteo Forecast',
        url: buildForecastUrl(coordinates),
        authority: 'Open-Meteo',
        issuedAt: null,
        retrievedAt: forecastData.fetchedAt,
        status: forecastData.weatherStatus,
        fieldsUsed: [
          'temperature_2m',
          'wind_speed_10m',
          'wind_direction_10m',
          'surface_pressure',
          'precipitation_probability',
          'wind_gusts_10m',
          'precipitation',
          'visibility',
        ],
        validFrom: forecastData.validFrom,
        validUntil: forecastData.validUntil,
        limitations: [
          'Global numerical model output; not an IMD observation for the Mumbai coast.',
          'Hourly wave and swell values are absent here because this endpoint does not publish them; they come from Open-Meteo Marine.',
        ],
      },
      {
        sourceId: 'usgs-earthquakes',
        sourceName: 'USGS Earthquake Hazards Program',
        url: seismicSource.url || 'https://earthquake.usgs.gov/earthquakes/feed/',
        authority: 'USGS',
        issuedAt: null,
        validFrom: null,
        validUntil: null,
        retrievedAt: seismicSource.retrievedAt,
        status: seismicSource.status,
        fieldsUsed: ['properties.mag', 'properties.time', 'geometry.coordinates', 'properties.tsunami'],
        limitations: [
          'Earthquake data only. A USGS tsunami flag reflects oceanographic modelling, not a BayWatch prediction.',
          'Events are filtered to the Indian Ocean region; magnitudes below the feed threshold are not listed.',
        ],
      },
    ];

    for (const w of officialWarnings) {
      entries.push({
        sourceId: w.productId.toLowerCase() as Provenance['sourceId'],
        sourceName: w.label,
        url: w.url,
        authority: w.authority,
        issuedAt: w.issuedAt,
        validFrom: w.validFrom,
        validUntil: w.validUntil,
        retrievedAt: w.retrievedAt,
        status: w.status,
        fieldsUsed: [],
        limitations: [
          w.blockerDetail ?? 'Bulletin state could not be established from this browser.',
        ],
      });
    }

    return entries;
  }, [marine, forecastData, coordinates, seismicSource, officialWarnings]);

  const explanation = useMemo(
    () =>
      buildRiskExplanation({
        assessment,
        previousFeatures: previousFeaturesRef.current,
        currentFeatures: features,
        previousState: previousStateRef.current,
        officialWarnings,
        sources: provenance,
      }),
    [assessment, features, officialWarnings, provenance]
  );

  // --- actions ----------------------------------------------------------
  /**
   * Force a refresh of every polled source.
   *
   * This IS a real user action, so it is recorded once. The individual reads it
   * triggers are not recorded again: the observation diff reports only what
   * actually changed as a result, which is what an operator cares about.
   */
  const refresh = useCallback(() => {
    const at = now().toISOString();
    appendEvents([
      buildEvent({
        kind: 'manual-refresh',
        at,
        summary: 'Manual refresh requested for all sources',
        source: 'Operator',
        data: { sources: 'marine,weather,seismic,warnings' },
      }),
    ]);
    void requestMarine(true);
    void fetchSeismic();
    void fetchWarnings();
  }, [requestMarine, fetchSeismic, fetchWarnings, nowRef]);

  const acknowledge = useCallback(
    (id: string) => {
      const at = now().toISOString();
      const next = acknowledgeNotification(notifications, id, at);
      if (next === notifications) return;
      setNotifications(next);
      saveNotifications(next);
      appendEvents([
        buildEvent({
          kind: 'notification-acknowledged',
          at,
          summary: 'Notification acknowledged',
          source: 'BayWatch notifications',
          data: { id },
        }),
      ]);
    },
    [notifications, now, appendEvents]
  );

  const acknowledgeEvery = useCallback(() => {
    const at = now().toISOString();
    const next = acknowledgeAll(notifications, at);
    setNotifications(next);
    saveNotifications(next);
  }, [notifications, now]);

  const askForPermission = useCallback(async () => {
    const result = await requestNotificationPermission();
    setPermission(result);
    return result;
  }, []);

  return {
    assessment,
    explanation,
    features,
    seismic,
    earthquakes: earthquakeState,
    marine,
    forecast,
    outlook,
    officialWarnings,
    forecastSourceIssuedAt: null,
    provenance,
    transitions,
    events: [...events].reverse(),
    notifications: [...notifications].reverse(),
    notificationPermission: permission,
    persistenceUnavailable: notificationState.persistenceUnavailable,
    fetchState,
    isFetching: observations.isFetching,
    rateLimitedUntil: observations.rateLimitedUntil,
    isOnline,
    refresh,
    acknowledge,
    acknowledgeAll: acknowledgeEvery,
    requestPermission: askForPermission,
  };
}
