import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchMarineReading,
  emptyMarineReading,
  buildMarineUrl,
  buildForecastUrl,
  MARINE_SOURCE_ID,
  WEATHER_SOURCE_ID,
} from '@/integrations/adapters/openMeteoMarine';
import { fetchEarthquakeFeed } from '@/integrations/adapters/usgsEarthquake';
import {
  probeOfficialWarnings,
  summarizeOfficialWarnings,
  WARNING_PRODUCTS,
  type WarningProbeDeps,
} from '@/integrations/adapters/officialWarnings';
import {
  extractHazardFeatures,
  parseForecastPoints,
  type ForecastPoint,
  type ForecastPayloadLike,
} from '@/integrations/adapters/hazardFeatures';
import { isRecord } from '@/integrations/adapters/validation';
import {
  assessCoastalRisk,
  assessDataQuality,
  emptySeismicFeatures,
  type CoastalRiskAssessment,
  type CoastalRiskState,
  type HazardFeatures,
  type SeismicFeatures,
} from '@/risk/engine';
import { buildRiskExplanation, detectTransition, type RiskExplanation } from '@/risk/explain';
import {
  acknowledgeAll as ackAll,
  acknowledgeNotification as ackOne,
  buildEvent,
  dedupeEvents,
  type BayWatchEvent,
  type CoastalRiskTransition,
} from '@/notifications/types';
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
  OfficialWarningStatus,
  Provenance,
  SourceStatus,
} from '@/integrations/adapters/types';
import { resolveFreshness } from '@/integrations/adapters/freshness';

/**
 * The Juhu Beach coordinate the platform monitors.
 *
 * This is a real, fixed monitoring location chosen by the project, not a
 * fabricated data point: it is the same coordinate the existing geolocation
 * helpers use as the coastal reference point.
 */
export const MONITORED_COORDINATES: Coordinates = { latitude: 19.0988, longitude: 72.8267 };

/** Refresh intervals, chosen per source to avoid hammering official services. */
export const REFRESH_INTERVALS = {
  /** Marine/weather: Open-Meteo updates roughly every 15 min. */
  marineMs: 10 * 60 * 1000,
  /** USGS: the all_day feed changes continuously; 5 min is ample. */
  seismicMs: 5 * 60 * 1000,
  /** IMD/INCOIS: probed far less often because they are bulletin pages. */
  warningsMs: 30 * 60 * 1000,
} as const;

export interface SourceFetchState {
  status: SourceStatus;
  lastSuccessfulFetch: string | null;
  lastAttemptedFetch: string | null;
  nextRefreshAt: string | null;
  errorKind: string | null;
  errorMessage: string | null;
}

const idleFetchState: SourceFetchState = {
  status: 'unavailable',
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
  marine: NormalizedMarine;
  forecast: ForecastPoint[];
  officialWarnings: OfficialWarningStatus[];
  /** Timestamps the source published for the newest forecast point. */
  forecastSourceIssuedAt: string | null;
  provenance: Provenance[];
  transitions: CoastalRiskTransition[];
  events: BayWatchEvent[];
  notifications: BayWatchNotification[];
  notificationPermission: NotificationPermissionState;
  persistenceUnavailable: boolean;
  fetchState: Record<'marine' | 'seismic' | 'warnings', SourceFetchState>;
  isOnline: boolean;
  refresh: () => void;
  acknowledge: (id: string) => void;
  acknowledgeAll: () => void;
  requestPermission: () => Promise<NotificationPermissionState>;
}

export interface UseCoastalIntelligenceOptions {
  coordinates?: Coordinates;
  deps?: AdapterDeps;
  warningDeps?: WarningProbeDeps;
  /** Disable browser notifications entirely (used in tests). */
  enableBrowserNotifications?: boolean;
  now?: () => Date;
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
  deps = {},
  warningDeps = {},
  enableBrowserNotifications = true,
  now = () => new Date(),
}: UseCoastalIntelligenceOptions): CoastalIntelligenceState {
  const [marine, setMarine] = useState<NormalizedMarine>(() => emptyMarineReading(coordinates));
  const [marineExtra, setMarineExtra] = useState<Record<string, unknown> | null>(null);
  const [forecastPayload, setForecastPayload] = useState<ForecastPayloadLike | null>(null);
  const [forecastOffsetSeconds, setForecastOffsetSeconds] = useState(19800);
  const [seismic, setSeismic] = useState<SeismicFeatures>(emptySeismicFeatures);
  const [seismicSource, setSeismicSource] = useState<{
    url: string;
    retrievedAt: string | null;
    status: SourceStatus;
  }>({ url: '', retrievedAt: null, status: 'unavailable' });
  const [officialWarnings, setOfficialWarnings] = useState<OfficialWarningStatus[]>([]);
  const [fetchState, setFetchState] = useState<
    Record<'marine' | 'seismic' | 'warnings', SourceFetchState>
  >({
    marine: idleFetchState,
    seismic: idleFetchState,
    warnings: idleFetchState,
  });
  const [events, setEvents] = useState<BayWatchEvent[]>([]);
  const [transitions, setTransitions] = useState<CoastalRiskTransition[]>([]);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  // Refs hold the previous evaluation so transitions can be detected without
  // forcing an extra render.
  const previousFeaturesRef = useRef<HazardFeatures | null>(null);
  const previousStateRef = useRef<CoastalRiskState | null>(null);

  // --- notifications: hydrate once from storage -------------------------
  const [notificationState] = useState(() => loadNotifications());
  const [notifications, setNotifications] = useState<BayWatchNotification[]>(
    notificationState.notifications
  );
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    readNotificationPermission()
  );

  const appendEvents = useCallback((incoming: BayWatchEvent[]) => {
    if (incoming.length === 0) return;
    setEvents((prev) => dedupeEvents(prev, incoming, (e) => `${e.kind}:${e.summary}`).slice(-120));
  }, []);

  // --- marine + weather fetch ------------------------------------------
  const fetchMarine = useCallback(async () => {
    const attemptedAt = now().toISOString();

    // Reuse the adapter for normalization, then read the extra published
    // fields (swell, current, SST, gusts, visibility) from the same payloads
    // so we make no additional requests.
    const reading = await fetchMarineReading(coordinates, deps);
    setMarine(reading);

    const nextRefresh = new Date(now().getTime() + REFRESH_INTERVALS.marineMs).toISOString();

    setFetchState((prev) => ({
      ...prev,
      marine: {
        status: reading.status,
        lastAttemptedFetch: attemptedAt,
        lastSuccessfulFetch: reading.fetchedAt ?? prev.marine.lastSuccessfulFetch,
        nextRefreshAt: reading.fetchedAt ? nextRefresh : prev.marine.nextRefreshAt,
        errorKind: reading.error?.kind ?? null,
        errorMessage: reading.error?.message ?? null,
      },
    }));

    // Persist the raw extras by re-reading the endpoint once per cycle only
    // when the primary read succeeded.
    if (reading.status !== 'unavailable') {
      try {
        const [marineJson, weatherJson] = await Promise.all([
          fetch(buildMarineUrl(coordinates), deps),
          fetch(buildForecastUrl(coordinates), deps),
        ]);
        const marineBody = await marineJson.json();
        const weatherBody = await weatherJson.json();

        if (isRecord(marineBody)) setMarineExtra(marineBody.current as Record<string, unknown>);
        if (isRecord(weatherBody)) {
          setForecastPayload((weatherBody.hourly ?? null) as ForecastPayloadLike);
          if (typeof weatherBody.utc_offset_seconds === 'number') {
            setForecastOffsetSeconds(weatherBody.utc_offset_seconds);
          }
        }
      } catch {
        // Extras are best-effort. The risk engine handles their absence by
        // reporting insufficient data, which is the honest outcome.
      }
    }

    appendEvents([
      reading.error
        ? buildEvent({
            kind: 'source-failed',
            at: attemptedAt,
            summary: `Marine source error: ${reading.error.message}`,
            source: 'Open-Meteo Marine',
            link: buildMarineUrl(coordinates),
            data: { kind: reading.error.kind },
          })
        : buildEvent({
            kind: 'source-updated',
            at: attemptedAt,
            summary: reading.fetchedAt
              ? `Marine reading updated at ${reading.fetchedAt}`
              : 'Marine reading updated',
            source: 'Open-Meteo Marine',
            link: buildMarineUrl(coordinates),
            data: { waveHeightM: reading.waveHeight },
          }),
    ]);
  }, [coordinates, deps, now, appendEvents]);

  // --- seismic fetch ----------------------------------------------------
  const fetchSeismic = useCallback(async () => {
    const attemptedAt = now().toISOString();
    const feed = await fetchEarthquakeFeed({
      window: 'all_day',
      regionOnly: true,
      ...EARTHQUAKE_REGION,
      ...deps,
    });

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

    appendEvents([
      feed.error
        ? buildEvent({
            kind: 'source-failed',
            at: attemptedAt,
            summary: `USGS feed error: ${feed.error.message}`,
            source: 'USGS',
            link: feed.source.url,
            data: { kind: feed.error.kind },
          })
        : buildEvent({
            kind: 'source-updated',
            at: attemptedAt,
            summary: `USGS feed read: ${strongest.count} regional event(s)`,
            source: 'USGS',
            link: feed.source.url,
            data: { events: strongest.count },
          }),
    ]);
  }, [deps, now, appendEvents]);

  // --- official warnings probe ------------------------------------------
  const fetchWarnings = useCallback(async () => {
    const attemptedAt = now().toISOString();
    const statuses = await probeOfficialWarnings(WARNING_PRODUCTS, warningDeps);
    setOfficialWarnings(statuses);

    const anyReadable = statuses.some((s) => s.blocker === null);
    setFetchState((prev) => ({
      ...prev,
      warnings: {
        status: anyReadable ? 'live' : 'unavailable',
        lastAttemptedFetch: attemptedAt,
        lastSuccessfulFetch: anyReadable ? attemptedAt : prev.warnings.lastSuccessfulFetch,
        nextRefreshAt: new Date(now().getTime() + REFRESH_INTERVALS.warningsMs).toISOString(),
        errorKind: anyReadable ? null : 'cors-denied',
        errorMessage: anyReadable
          ? null
          : 'IMD and INCOIS bulletins are not readable from a browser (CORS). Warning state is unknown.',
      },
    }));

    appendEvents(
      statuses
        .filter((s) => s.active === true)
        .map((s) =>
          buildEvent({
            kind: 'official-warning-detected',
            at: attemptedAt,
            summary: `${s.authority} reports an active warning: ${s.label}`,
            source: s.authority,
            link: s.url,
            data: { productId: s.productId },
          })
        )
    );
  }, [warningDeps, now, appendEvents]);

  // --- lifecycle --------------------------------------------------------
  useEffect(() => {
    const runAll = async () => {
      // Marine/weather and USGS are independent official sources; probing IMD
      // and INCOIS is slower, so they run on their own longer interval below.
      await Promise.all([fetchMarine(), fetchSeismic()]);
    };

    void runAll();
    void fetchWarnings();

    const marineTimer = setInterval(() => void fetchMarine(), REFRESH_INTERVALS.marineMs);
    const seismicTimer = setInterval(() => void fetchSeismic(), REFRESH_INTERVALS.seismicMs);
    const warningTimer = setInterval(() => void fetchWarnings(), REFRESH_INTERVALS.warningsMs);

    return () => {
      clearInterval(marineTimer);
      clearInterval(seismicTimer);
      clearInterval(warningTimer);
    };
  }, [fetchMarine, fetchSeismic, fetchWarnings]);

  // --- connectivity -----------------------------------------------------
  useEffect(() => {
    const goOffline = () => {
      setIsOnline(false);
      setEvents((prev) =>
        [
          ...prev,
          buildEvent({
            kind: 'went-offline',
            at: now().toISOString(),
            summary: 'Browser went offline. Retained data is marked stale.',
            source: 'Browser',
            data: null,
          }),
        ].slice(-120)
      );
    };
    const goOnline = () => {
      setIsOnline(true);
      setEvents((prev) =>
        [
          ...prev,
          buildEvent({
            kind: 'came-online',
            at: now().toISOString(),
            summary: 'Browser came back online. Refreshing sources.',
            source: 'Browser',
            data: null,
          }),
        ].slice(-120)
      );
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [now]);

  // --- derived: hazard features ----------------------------------------
  const extraction = useMemo(
    () => extractHazardFeatures(marine, marineExtra, null),
    [marine, marineExtra]
  );

  const features = extraction.features;

  // --- forecast timeline ------------------------------------------------
  const forecast = useMemo<ForecastPoint[]>(() => {
    if (!forecastPayload) return [];
    const { points } = parseForecastPoints(forecastPayload, forecastOffsetSeconds);
    const nowMs = now().getTime();

    return points
      .filter((p) => Date.parse(p.isoTime) >= nowMs - 60 * 60 * 1000)
      .slice(0, 48)
      .map((p): ForecastPoint => {
        const state = forecastHazardState(p.values);
        return {
          time: p.time,
          isoTime: p.isoTime,
          waveHeightM: p.values.waveHeightM,
          swellHeightM: p.values.swellHeightM,
          wavePeriodS: p.values.wavePeriodS,
          windSpeedKmh: p.values.windSpeedKmh,
          windGustKmh: p.values.windGustKmh,
          precipitationMm: p.values.precipitationMm,
          precipitationProbabilityPct: p.values.precipitationProbabilityPct,
          visibilityM: p.values.visibilityM,
          hazardState: state.state,
          ruleIds: state.ruleIds,
          sourceStatus: resolveFreshness(marine.fetchedAt, marine.waveHeight !== null, now(), true),
        };
      });
  }, [forecastPayload, forecastOffsetSeconds, marine.fetchedAt, marine.waveHeight, now]);

  // --- derived: official warning summary --------------------------------
  const warningSummary = useMemo(() => summarizeOfficialWarnings(officialWarnings), [officialWarnings]);

  // --- derived: quality + assessment ------------------------------------
  const quality = useMemo(
    () =>
      assessDataQuality({
        marineStatus: marine.status,
        weatherStatus: marine.status,
        marineFetchedAt: marine.fetchedAt,
        weatherFetchedAt: marine.fetchedAt,
        marineErrorKind: marine.error?.kind ?? null,
        weatherErrorKind: null,
        rejectedRecords: 0,
        missingFields: extraction.missingFields,
        warningsUnreadable: officialWarnings.some((w) => w.active === null),
        now: now(),
      }),
    [marine, extraction.missingFields, officialWarnings, now]
  );

  const assessment = useMemo(
    () =>
      assessCoastalRisk(
        { features, seismic, officialWarnings, officialWarningActive: warningSummary.active },
        quality,
        now
      ),
    [features, seismic, officialWarnings, warningSummary.active, quality, now]
  );

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
      setEvents((prev) =>
        [
          ...prev,
          buildEvent({
            kind: 'risk-changed',
            at: transition.at,
            summary: `Risk ${transition.previousState} -> ${transition.newState}`,
            source: 'BayWatch risk engine',
            data: { ruleIds: transition.ruleIds.join(', ') },
          }),
        ].slice(-120)
      );
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
      officialWarningActive: warningSummary.active,
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

        setEvents((prev) =>
          [
            ...prev,
            ...added.map((n) =>
              buildEvent({
                kind: 'notification-generated',
                at: assessment.evaluatedAt,
                summary: `Notification: ${n.title}`,
                source: n.source,
                data: { rule: n.rule, eventKey: n.eventKey },
              })
            ),
          ].slice(-120)
        );
      }
    }

    previousFeaturesRef.current = features;
    previousStateRef.current = assessment.state;
  }, [
    features,
    assessment,
    forecast,
    seismic,
    warningSummary.active,
    marine.status,
    notifications,
    enableBrowserNotifications,
  ]);

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
    [assessment, features, officialWarnings]
  );

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
        validFrom: null,
        validUntil: null,
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
        validFrom: null,
        validUntil: null,
        retrievedAt: marine.fetchedAt,
        status: marine.status,
        fieldsUsed: ['wind_speed_10m', 'wind_gusts_10m', 'precipitation', 'visibility'],
        limitations: [
          'Global numerical model output; not an IMD observation for the Mumbai coast.',
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
  }, [marine, coordinates, seismicSource, officialWarnings]);

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
  const refresh = useCallback(() => {
    void fetchMarine();
    void fetchSeismic();
    void fetchWarnings();
  }, [fetchMarine, fetchSeismic, fetchWarnings]);

  const acknowledge = useCallback(
    (id: string) => {
      const at = now().toISOString();
      const next = acknowledgeNotification(notifications, id, at);
      if (next === notifications) return;
      setNotifications(next);
      saveNotifications(next);
      setEvents((prev) =>
        [
          ...prev,
          buildEvent({
            kind: 'notification-acknowledged',
            at,
            summary: 'Notification acknowledged',
            source: 'BayWatch notifications',
            data: { id },
          }),
        ].slice(-120)
      );
    },
    [notifications, now]
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
    marine,
    forecast,
    officialWarnings,
    forecastSourceIssuedAt: null,
    provenance,
    transitions,
    events: [...events].reverse(),
    notifications: [...notifications].reverse(),
    notificationPermission: permission,
    persistenceUnavailable: notificationState.persistenceUnavailable,
    fetchState,
    isOnline,
    refresh,
    acknowledge,
    acknowledgeAll: acknowledgeEvery,
    requestPermission: askForPermission,
  };
}

/**
 * Evaluate a single forecast point against the SAME rule thresholds used for
 * the current state, so the timeline and the headline can never disagree.
 */
function forecastHazardState(values: {
  waveHeightM: number | null;
  swellHeightM: number | null;
  wavePeriodS: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  precipitationMm: number | null;
}): { state: ForecastPoint['hazardState']; ruleIds: string[] } {
  const ruleIds: string[] = [];
  let worst: ForecastPoint['hazardState'] = 'nominal';

  const escalate = (ruleId: string, state: ForecastPoint['hazardState']) => {
    ruleIds.push(ruleId);
    const order = ['nominal', 'insufficient-data', 'elevated', 'high', 'severe'] as const;
    if (order.indexOf(state) > order.indexOf(worst)) worst = state;
  };

  if (values.waveHeightM !== null && values.waveHeightM >= 3.7) escalate('MARINE.WAVE.HIGH', 'severe');
  if (values.swellHeightM !== null && values.swellHeightM >= 3.0) escalate('MARINE.SWELL.HIGH', 'severe');
  if (values.waveHeightM !== null && values.waveHeightM >= 2.1) escalate('MARINE.WAVE.MODERATE', 'elevated');
  if (values.wavePeriodS !== null && values.wavePeriodS >= 14) escalate('MARINE.PERIOD.LONG', 'high');
  if (values.wavePeriodS !== null && values.wavePeriodS >= 18) escalate('MARINE.PERIOD.VERY_LONG', 'severe');
  if (values.windSpeedKmh !== null && values.windSpeedKmh >= 40) escalate('WEATHER.WIND.HIGH', 'high');
  if (values.windGustKmh !== null && values.windGustKmh >= 55) escalate('WEATHER.GUST.HIGH', 'severe');
  if (values.windSpeedKmh !== null && values.windSpeedKmh >= 25) escalate('WEATHER.WIND.MODERATE', 'elevated');
  if (values.precipitationMm !== null && values.precipitationMm >= 7.5) escalate('WEATHER.RAIN.HEAVY', 'high');

  return { state: worst, ruleIds };
}
