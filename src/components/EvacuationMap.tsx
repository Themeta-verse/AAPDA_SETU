import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Navigation, MapPin, Loader2, AlertTriangle, ExternalLink, Crosshair, X, Volume2, ShieldAlert, ShieldCheck, HelpCircle } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import { useGeolocation, MONITORED_POINT, MONITORED_POINT_LABEL } from '@/hooks/useGeolocation';
import { useOptionalSharedCoastalIntelligence } from '@/hooks/CoastalIntelligenceProvider';
import { buildVoiceScript } from '@/voice/alertCenter';
import { speakVoiceScript } from '@/voice/speech';
import { publishActionEvent } from '@/events/eventBus';
import {
  fetchCandidateFacilities,
  facilityKindLabel,
  type CandidateFacility,
  type NearbyFacilitiesResult,
} from '@/integrations/adapters/safeShelters';
import { calculateRoute, externalDirectionsUrl, type RouteResult } from '@/integrations/adapters/routing';
import { formatDistance, formatDuration, type LatLon } from '@/lib/geo';
import { evacuationGuidanceFor } from '@/lib/evacuationGuidance';

/**
 * Location-aware evacuation guidance.
 *
 * ===================================================================
 * WHAT THIS REPLACES
 * ===================================================================
 *
 * The previous component drew a decorative gradient rectangle, placed two
 * markers labelled "Safe Zone A – JVPD Ground" and "Safe Zone B – Mithibai
 * College" at hardcoded percentage positions (55%, 22% and 72%, 38%), and
 * connected them to the beach with straight SVG lines labelled "Evacuation
 * Route".
 *
 * Three separate things were false about that:
 *   1. The positions were not coordinates. They were percentages on a box.
 *   2. The "safe zone" designation was invented. No source designated them.
 *   3. A straight line is not a road route. It crosses whatever is in the way.
 *
 * ===================================================================
 * WHAT IS HERE NOW
 * ===================================================================
 *
 *   - A real Leaflet map on real OpenStreetMap tiles.
 *   - The user's real GPS position, or an honest statement that there is none.
 *   - Real candidate facilities from Overpass, with real names and real
 *     coordinates, sorted by real great-circle distance.
 *   - A real driving route from OSRM with real geometry, distance and duration.
 *   - A prominent, permanent statement that these facilities are NOT official
 *     designated shelters, because no authoritative shelter feed exists.
 *
 * There is no straight-line fallback anywhere. When routing fails, the failure
 * and its reason are shown, because an invented line is worse than no line.
 */

interface EvacuationMapProps {
  language: Language;
}

type FacilityState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; result: NearbyFacilitiesResult }
  | { kind: 'failed'; result: NearbyFacilitiesResult };

/**
 * Escape text before it goes into a Leaflet popup.
 *
 * Facility names come from OpenStreetMap and are therefore third-party content
 * rendered as HTML. Without this, a name containing markup would be injected
 * into the popup DOM.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function EvacuationMap({ language }: EvacuationMapProps) {
  const t = translations[language];
  const geo = useGeolocation();
  // Risk/alert state for the guidance banner. Optional so this panel degrades
  // to pure navigation (no verdict) when rendered outside the provider, rather
  // than crashing or inventing a risk level.
  const intelligence = useOptionalSharedCoastalIntelligence();
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{
    monitored?: L.LayerGroup;
    user?: L.LayerGroup;
    facilities?: L.LayerGroup;
    route?: L.Polyline;
  }>({});

  const [facilityState, setFacilityState] = useState<FacilityState>({ kind: 'idle' });
  const [selected, setSelected] = useState<CandidateFacility | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routing, setRouting] = useState(false);

  // --- map lifecycle ----------------------------------------------------
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;

    const map = L.map(mapRef.current, {
      center: [MONITORED_POINT.latitude, MONITORED_POINT.longitude],
      zoom: 13,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. ' +
        'Routing by <a href="https://project-osrm.org/">OSRM</a>.',
    }).addTo(map);

    // One group per category so each effect can clear only its own layer.
    layersRef.current.monitored = L.layerGroup().addTo(map);
    layersRef.current.user = L.layerGroup().addTo(map);
    layersRef.current.facilities = L.layerGroup().addTo(map);
    leafletRef.current = map;

    return () => {
      map.remove();
      leafletRef.current = null;
      layersRef.current = {};
    };
  }, []);

  // --- markers ----------------------------------------------------------
  //
  // Each category owns its own layer group and is cleared before it redraws.
  // A single shared group that only ever accumulated produced 151 markers for 39
  // facilities, because every re-run of the discovery effect stacked another copy
  // on the map. Clearing first makes each effect idempotent.

  useEffect(() => {
    const group = layersRef.current.monitored;
    if (!group) return;
    group.clearLayers();
    L.marker([MONITORED_POINT.latitude, MONITORED_POINT.longitude], {
      title: 'Monitored point',
      icon: L.divIcon({
        className: '',
        html: '<div style="width:22px;height:22px;border-radius:50%;background:hsl(32 95% 50%);border:2.5px solid #fff;box-shadow:0 0 0 3px hsl(32 95% 50% / .35)"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
    })
      .addTo(group)
      .bindPopup(
        `<strong>${MONITORED_POINT_LABEL}</strong><br/>Monitored point for all BayWatch sources.<br/>This is not your location.`,
      );
  }, []);

  useEffect(() => {
    const group = layersRef.current.user;
    const map = leafletRef.current;
    if (!group || !map) return;

    group.clearLayers();

    if (!geo.position) {
      // No fix: recentre on the monitored point rather than leaving the map
      // wherever the last fix happened to be.
      map.setView([MONITORED_POINT.latitude, MONITORED_POINT.longitude], 13);
      return;
    }

    L.marker([geo.position.latitude, geo.position.longitude], {
      title: 'Your location',
      icon: L.divIcon({
        className: '',
        html: '<div style="width:26px;height:26px;border-radius:50%;background:hsl(217 91% 60%);border:3px solid #fff;box-shadow:0 0 0 4px hsl(217 91% 60% / .3)"></div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    })
      .addTo(group)
      .bindPopup(
        `<strong>Your location</strong><br/>${geo.formatted}<br/>Accuracy: ${geo.accuracyLabel ?? 'unknown'}`,
      );
  }, [geo.position, geo.formatted, geo.accuracyLabel]);

  // --- facility discovery ------------------------------------------------
  const searchFacilities = async (origin: LatLon) => {
    setFacilityState({ kind: 'loading' });
    const result = await fetchCandidateFacilities(origin, { radiusM: 6000, limit: 40 });
    setFacilityState(
      result.ok ? { kind: 'ready', result } : { kind: 'failed', result },
    );
  };

  // Search automatically once a real fix exists, so the panel is useful without
  // an extra click.
  useEffect(() => {
    if (geo.position && facilityState.kind === 'idle') {
      void searchFacilities(geo.position);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.position]);

  // --- facility markers --------------------------------------------------
  useEffect(() => {
    const group = layersRef.current.facilities;
    if (!group) return;

    // Always clear, including when the state is not 'ready', so a previous
    // result cannot linger on the map after a failed or empty refresh.
    group.clearLayers();
    if (facilityState.kind !== 'ready') return;

    for (const facility of facilityState.result.facilities) {
      L.marker([facility.latitude, facility.longitude], {
        title: facility.name,
        alt: facility.name,
        icon: L.divIcon({
          className: '',
          html: '<div style="width:18px;height:18px;border-radius:50%;background:hsl(142 70% 45%);border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      })
        .bindPopup(
          `<strong>${escapeHtml(facility.name)}</strong><br/>${facilityKindLabel(facility.kind)}<br/>` +
            `${formatDistance(facility.distanceM) ?? 'distance unknown'} straight-line away<br/>` +
            '<em>Not an official designated shelter.</em>',
        )
        .on('click', () => setSelected(facility))
        .addTo(group);
    }
  }, [facilityState]);

  // --- routing -----------------------------------------------------------
  const routeTo = async (facility: CandidateFacility) => {
    setSelected(facility);
    publishActionEvent({
      kind: 'destination-selected',
      summary: `Evacuation destination selected: ${facility.name} (${facilityKindLabel(facility.kind)}, ${formatDistance(facility.distanceM) ?? 'distance unknown'} straight-line)`,
      source: 'Evacuation panel',
      data: {
        facilityId: facility.id,
        name: facility.name,
        latitude: facility.latitude,
        longitude: facility.longitude,
        straightLineM: Math.round(facility.distanceM),
      },
    });
    if (!geo.position) {
      setRoute(null);
      return;
    }
    setRouting(true);
    const origin = geo.position;
    const result = await calculateRoute(origin, {
      latitude: facility.latitude,
      longitude: facility.longitude,
    });
    setRoute(result);
    setRouting(false);

    if (result.status === 'ok' && result.leg) {
      publishActionEvent({
        kind: 'route-calculated',
        summary: `OSRM driving route to ${facility.name}: ${formatDistance(result.leg.distanceM) ?? 'unknown distance'}, ${formatDuration(result.leg.durationS) ?? 'unknown duration'}`,
        source: 'OSRM',
        link: result.sourceUrl,
        data: {
          facilityId: facility.id,
          distanceM: Math.round(result.leg.distanceM),
          durationS: Math.round(result.leg.durationS),
        },
      });
    } else {
      publishActionEvent({
        kind: 'route-failed',
        summary: `No route to ${facility.name}: ${result.error ?? 'routing service unavailable'}`,
        source: 'OSRM',
        data: { facilityId: facility.id, status: result.status },
      });
    }

    const map = leafletRef.current;
    if (map && result.status === 'ok' && result.leg) {
      const latLngs = result.leg.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
      layersRef.current.route?.remove();
      layersRef.current.route = L.polyline(latLngs, {
        color: '#2563eb',
        weight: 5,
        opacity: 0.85,
        lineJoin: 'round',
      }).addTo(map);
      map.fitBounds(layersRef.current.route.getBounds(), { padding: [40, 40] });
    } else {
      // Explicitly remove any previous line rather than leaving a stale route on
      // screen next to a new, failed calculation.
      layersRef.current.route?.remove();
      layersRef.current.route = undefined;
    }
  };

  const recentreOnUser = () => {
    const map = leafletRef.current;
    if (map && geo.position) {
      map.setView([geo.position.latitude, geo.position.longitude], 15);
    }
  };

  // --- action events: GPS -------------------------------------------------
  //
  // The event stream records that a fix was acquired / denied / lost exactly
  // once per transition. The ref key includes the coordinates so a genuinely
  // new fix is a new event, while re-renders of the same fix stay silent.
  const lastGpsEventRef = useRef<string | null>(null);
  useEffect(() => {
    if (geo.status === 'idle' || geo.status === 'locating' || geo.status === 'unsupported') return;
    const key =
      geo.status === 'ready' && geo.fix
        ? `ready@${geo.fix.latitude.toFixed(5)},${geo.fix.longitude.toFixed(5)}`
        : geo.status;
    if (lastGpsEventRef.current === key) return;
    lastGpsEventRef.current = key;

    if (geo.status === 'ready' && geo.position) {
      publishActionEvent({
        kind: 'gps-granted',
        summary: `GPS fix acquired (${geo.formatted}, ${geo.accuracyLabel ?? 'accuracy unknown'})`,
        source: 'Device GPS',
        data: {
          latitude: geo.position.latitude,
          longitude: geo.position.longitude,
          accuracyM: geo.accuracyM ?? null,
        },
      });
    } else if (geo.status === 'denied') {
      publishActionEvent({
        kind: 'gps-denied',
        summary: 'Location permission denied. Evacuation routing needs a GPS fix.',
        source: 'Device GPS',
        data: {},
      });
    } else {
      publishActionEvent({
        kind: 'gps-lost',
        summary: `Device could not provide a position (${geo.status}).`,
        source: 'Device GPS',
        data: { status: geo.status },
      });
    }
  }, [geo.status, geo.fix, geo.position, geo.formatted, geo.accuracyLabel, geo.accuracyM]);

  // --- viewport: include the user and the candidates ----------------------
  //
  // The initial view is the monitored beach point. Once a real fix AND real
  // facilities exist, fit both exactly once per fix so the operator sees the
  // useful evacuation area immediately — without yanking the viewport on every
  // subsequent render while they zoom and inspect.
  const fittedForFixRef = useRef<string | null>(null);
  const facilities =
    facilityState.kind === 'ready' ? facilityState.result.facilities : [];
  useEffect(() => {
    const map = leafletRef.current;
    if (!map || !geo.position || facilities.length === 0) return;
    const key = `${geo.position.latitude.toFixed(5)},${geo.position.longitude.toFixed(5)}@${facilities.length}`;
    if (fittedForFixRef.current === key) return;
    fittedForFixRef.current = key;
    const bounds = L.latLngBounds(
      [geo.position.latitude, geo.position.longitude],
      ...facilities.slice(0, 12).map(
        (f) => [f.latitude, f.longitude] as [number, number]
      )
    );
    map.fitBounds(bounds.pad(0.15), { maxZoom: 15 });
  }, [geo.position, facilities]);

  const nearestLabel = useMemo(() => {
    if (facilities.length === 0) return null;
    const nearest = facilities[0];
    return `${nearest.name} — ${formatDistance(nearest.distanceM) ?? 'distance unknown'}`;
  }, [facilities]);

  // --- risk-aware evacuation guidance ------------------------------------
  //
  // The RULE lives in `lib/evacuationGuidance.ts` as a pure, tested function
  // of the canonical assessment (no invented triggers). The BayWatch-derived
  // verdict and the official bulletin state are rendered as SEPARATE facts:
  // a government warning must never be confused with model output.
  // Capacity/availability of any facility is unknown (no source publishes it)
  // and is stated as such, never invented.
  const guidance = useMemo(
    () => evacuationGuidanceFor(intelligence?.assessment ?? null),
    [intelligence]
  );

  const [speakingGuidance, setSpeakingGuidance] = useState(false);
  const playGuidance = async () => {
    if (!intelligence || speakingGuidance) return;
    setSpeakingGuidance(true);
    const script = buildVoiceScript({
      features: intelligence.features,
      assessment: intelligence.assessment,
      officialWarnings: intelligence.officialWarnings,
      retrievedAt: intelligence.assessment.evaluatedAt,
      language,
    });
    await speakVoiceScript(script.text, { language });
    setSpeakingGuidance(false);
  };

  const guidanceIcon =
    guidance.mode === 'evacuate' ? AlertTriangle
    : guidance.mode === 'prepare' ? ShieldAlert
    : guidance.mode === 'normal' ? ShieldCheck
    : HelpCircle;
  const GuidanceIcon = guidanceIcon;
  const guidanceUrgent = guidance.mode === 'evacuate';
  const guidanceCaution = guidance.mode === 'prepare';

  return (
    <section className="container py-8" aria-label={t.evacTitle ?? 'Evacuation guidance'}>
      <div className="flex items-center gap-2 mb-1">
        <Navigation className="w-6 h-6 text-primary" aria-hidden="true" />
        <h2 className="text-2xl font-bold">{t.evacTitle ?? 'Get to safety'}</h2>
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl mb-4">
        Real routing from your actual position to real mapped facilities near you.
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ---------------- map ---------------- */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div ref={mapRef} className="w-full h-[340px] sm:h-[460px]" data-testid="evac-map" />

          <div className="flex flex-wrap items-center gap-2 p-3 border-t border-border">
            <button
              type="button"
              onClick={geo.requestLocation}
              disabled={geo.status === 'locating'}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60"
              data-testid="evac-use-my-location"
            >
              {geo.status === 'locating' ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Crosshair className="w-4 h-4" aria-hidden="true" />
              )}
              {geo.status === 'locating' ? 'Locating…' : 'Use my location'}
            </button>

            {geo.hasFix && (
              <button
                type="button"
                onClick={recentreOnUser}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium"
              >
                Centre on me
              </button>
            )}

            <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Monitored beach
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600" /> You are here
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-green-600" /> Candidate facility
              </span>
            </div>
          </div>
        </div>

        {/* ---------------- panel ---------------- */}
        <div className="flex flex-col gap-3">
          {/* risk-aware guidance — the Phase 6 connection: this panel reads the
              same canonical assessment as the command center, so an official
              warning or a severe/high verdict surfaces here, not just there. */}
          <div
            className={`glass-card rounded-2xl p-4 ${
              guidanceUrgent
                ? 'border-danger/50 bg-danger/5'
                : guidanceCaution
                  ? 'border-warning/40 bg-warning/5'
                  : ''
            }`}
            data-testid="evac-guidance"
          >
            <div className="flex items-start gap-2">
              <GuidanceIcon
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  guidanceUrgent
                    ? 'text-danger'
                    : guidanceCaution
                      ? 'text-warning'
                      : guidance.mode === 'normal'
                        ? 'text-safe'
                        : 'text-muted-foreground'
                }`}
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground" data-testid="evac-guidance-title">
                  {guidance.title}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                  {guidance.detail}
                </p>
                {guidance.mode === 'evacuate' && facilities.length > 0 && (
                  <p className="text-xs text-foreground font-medium mt-2" data-testid="evac-recommended">
                    Nearest candidate: {facilities[0].name} (
                    {formatDistance(facilities[0].distanceM) ?? 'distance unknown'} straight-line;
                    availability unknown). Select it below to calculate the road route.
                  </p>
                )}
                {intelligence && (
                  <button
                    type="button"
                    onClick={() => void playGuidance()}
                    disabled={speakingGuidance}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium disabled:opacity-60"
                    data-testid="evac-play-guidance"
                  >
                    <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                    {speakingGuidance ? 'Playing…' : 'Hear the current alert in your language'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* honesty notice — always visible, not dismissible */}
          <div className="glass-card rounded-2xl p-4 border-warning/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-xs text-muted-foreground leading-relaxed">
                <p className="font-semibold text-foreground mb-1">
                  These are not official evacuation shelters
                </p>
                <p>
                  No authority publishes a designated-shelter feed that this app can read, and
                  OpenStreetMap carries no shelter designations for this area. The markers below are
                  real named facilities — schools, community centres and hospitals — offered as
                  <em> candidate destinations</em>. Confirm any destination with your ward office or
                  the NDMA before travelling.
                </p>
              </div>
            </div>
          </div>

          {/* GPS state */}
          <div className="glass-card rounded-2xl p-4" data-testid="evac-gps-state">
            <h3 className="text-sm font-semibold mb-2">Your location</h3>

            {geo.hasFix ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-mono text-foreground" data-testid="evac-coords">
                  {geo.formatted}
                </p>
                <p>{geo.accuracyLabel}</p>
                <p>
                  Fix age: {geo.ageSeconds}s{geo.isStale ? ' — stale' : geo.watching ? ' — live' : ''}
                </p>
                {geo.distanceToMonitoredM !== null && (
                  <p>{formatDistance(geo.distanceToMonitoredM)} from the monitored beach point</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="evac-gps-message">
                {geo.statusMessage}
              </p>
            )}
          </div>

          {/* facilities */}
          <div className="glass-card rounded-2xl p-4 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Nearby facilities</h3>
              {facilityState.kind === 'loading' && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
              )}
            </div>

            {!geo.hasFix ? (
              <p className="text-xs text-muted-foreground">
                Grant location access to search for facilities around you. You can still browse the
                monitored area without it.
              </p>
            ) : facilityState.kind === 'loading' ? (
              <p className="text-xs text-muted-foreground">Searching OpenStreetMap…</p>
            ) : facilityState.kind === 'failed' ? (
              <p className="text-xs text-warning" data-testid="evac-facility-error">
                {facilityState.result.error}
              </p>
            ) : facilityState.kind !== 'ready' ? (
              <p className="text-xs text-muted-foreground">
                Facilities have not been searched for yet.
              </p>
            ) : facilities.length === 0 ? (
              // A successful query that matched nothing is a real result and is
              // reported as such, not as a failure.
              <p className="text-xs text-muted-foreground" data-testid="evac-facility-empty">
                {facilityState.result.error}
              </p>
            ) : (
              <>
                <p className="text-[11px] text-muted-foreground mb-2">
                  {facilities.length} real facilities found. Nearest: {nearestLabel}.
                </p>
                <ul className="space-y-1.5 overflow-y-auto max-h-64 pr-1">
                  {facilities.map((facility) => (
                    <li key={facility.id}>
                      <button
                        type="button"
                        onClick={() => void routeTo(facility)}
                        className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                          selected?.id === facility.id
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:bg-secondary'
                        }`}
                        data-testid="evac-facility"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground truncate">{facility.name}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {formatDistance(facility.distanceM)}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          {facilityKindLabel(facility.kind)} · availability unknown
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* route result */}
          {selected && (
            <div className="glass-card rounded-2xl p-4" data-testid="evac-route-card">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold">Route</h3>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setRoute(null);
                    layersRef.current.route?.remove();
                    layersRef.current.route = undefined;
                  }}
                  aria-label="Clear route"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                <MapPin className="w-3 h-3" aria-hidden="true" />
                {selected.name}
              </p>
              <p className="text-[11px] font-mono text-muted-foreground mb-2" data-testid="evac-destination-coords">
                {selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)} · availability unknown
              </p>
              {facilities.length > 0 && selected.id === facilities[0].id && (
                <p className="text-[11px] text-muted-foreground mb-2" data-testid="evac-selection-reason">
                  Shown first because it is the nearest candidate with real
                  map coordinates. A road route is confirmed only below — never
                  assumed from straight-line distance.
                </p>
              )}

              {!geo.hasFix ? (
                <p className="text-xs text-warning">
                  A route needs your location. Grant location access to calculate one.
                </p>
              ) : routing ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                  Calculating route with OSRM…
                </p>
              ) : route?.status === 'ok' && route.leg ? (
                <>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div className="rounded-lg bg-secondary/50 p-2">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Distance
                      </div>
                      <div className="text-sm font-semibold" data-testid="evac-route-distance">
                        {formatDistance(route.leg.distanceM)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-secondary/50 p-2">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Est. drive
                      </div>
                      <div className="text-sm font-semibold" data-testid="evac-route-duration">
                        {formatDuration(route.leg.durationS)}
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-2">
                    Driving estimate only. It does not account for live traffic, road closures or
                    flooding on the route.
                  </p>
                  {geo.destination({
                    latitude: selected.latitude,
                    longitude: selected.longitude,
                  }).compass && (
                    <p className="text-xs text-muted-foreground mb-2">
                      Direction from you:{' '}
                      {geo.destination({ latitude: selected.latitude, longitude: selected.longitude }).compass}
                    </p>
                  )}
                  <a
                    href={externalDirectionsUrl(geo.position!, {
                      latitude: selected.latitude,
                      longitude: selected.longitude,
                    }) ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
                  >
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    Open in OpenStreetMap directions
                  </a>
                </>
              ) : route ? (
                <>
                  <p className="text-xs text-warning" data-testid="evac-route-error">
                    {route.error}
                  </p>
                  {/* No fake line is drawn. The destination coordinates and an
                      official navigation action are offered instead, so the
                      user still has something real to act on. */}
                  {geo.hasFix && geo.position && (
                    <a
                      href={
                        externalDirectionsUrl(geo.position, {
                          latitude: selected.latitude,
                          longitude: selected.longitude,
                        }) ?? '#'
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium mt-2"
                    >
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      Open destination in OpenStreetMap directions
                    </a>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
