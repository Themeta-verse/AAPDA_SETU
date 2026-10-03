import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  CheckCircle2,
  CircleDashed,
  CloudOff,
  Database,
  ExternalLink,
  Loader2,
  Radio,
  ShieldAlert,
  Volume2,
  Bell,
  BellOff,
  History,
  Waves,
  TrendingUp,
} from 'lucide-react';
import { describeOutlook } from '@/risk/outlook';
import type { Language } from '@/lib/translations';
import { useSharedCoastalIntelligence } from '@/hooks/CoastalIntelligenceProvider';
import { type CoastalIntelligenceState } from '@/hooks/useCoastalIntelligence';
import { buildVoiceScript } from '@/voice/alertCenter';
import { speakVoiceScript, stopSpeech, type SpeechResult } from '@/voice/speech';
import type { ForecastPoint } from '@/integrations/adapters/hazardFeatures';
import { FORECAST_HORIZON_HOURS } from '@/integrations/adapters/openMeteoForecast';
import {
  formatForecastHourLabel,
  formatForecastTimestamp,
  formatInstantInSourceTimezone,
} from '@/lib/sourceTime';
import type { CoastalRiskState } from '@/risk/engine';
import type { SourceStatus } from '@/integrations/adapters/types';

/**
 * BayWatch Coastal Command Center.
 *
 * A single connected flow, not a grid of disconnected cards:
 *
 *   1. Current Coastal State      — the verdict, and what it is based on
 *   2. Active Official Warnings   — authority bulletins, or an honest "unknown"
 *   3. Forecast Timeline          — real published horizons, clickable
 *   4. Risk Drivers               — per-dimension rules that fired
 *   5. Why Did Risk Change        — deterministic explanation
 *   6. Data Quality               — evidence, never a confidence score
 *   7. Event Stream               — real system actions only
 *   8. Notification Center        — deduplicated, acknowledgeable
 *   9. Voice Alert Center         — generated from application state
 *  10. Source Provenance          — clickable links with limitations
 *
 * Every state renders explicitly. There is no path that shows a plausible
 * number where the source published nothing.
 */

interface CoastalCommandCenterProps {
  language: Language;
}

const STATE_META: Record<
  CoastalRiskState,
  { label: string; className: string; icon: typeof ShieldAlert; description: string }
> = {
  nominal: {
    label: 'Nominal',
    className: 'text-safe border-safe/40 bg-safe/10',
    icon: CheckCircle2,
    description: 'No monitored threshold has been crossed.',
  },
  watch: {
    label: 'Watch',
    className: 'text-primary border-primary/40 bg-primary/10',
    icon: CircleDashed,
    description: 'Some monitored dimensions could not be fully resolved.',
  },
  elevated: {
    label: 'Elevated',
    className: 'text-warning border-warning/40 bg-warning/10',
    icon: Activity,
    description: 'At least one published threshold has been crossed.',
  },
  high: {
    label: 'High',
    className: 'text-warning border-warning/50 bg-warning/15',
    icon: AlertOctagon,
    description: 'Significant hazard thresholds have been crossed.',
  },
  severe: {
    label: 'Severe',
    className: 'text-danger border-danger/50 bg-danger/15',
    icon: AlertOctagon,
    description: 'An official warning or tsunami flag is active.',
  },
  unknown: {
    label: 'Unknown',
    className: 'text-muted-foreground border-border bg-secondary/40',
    icon: CloudOff,
    description: 'Required data is unavailable. No hazard verdict can be made.',
  },
};

const QUALITY_META: Record<string, { className: string; icon: typeof Database }> = {
  CURRENT: { className: 'text-safe border-safe/40 bg-safe/10', icon: CheckCircle2 },
  STALE: { className: 'text-warning border-warning/40 bg-warning/10', icon: History },
  DEGRADED: { className: 'text-warning border-warning/40 bg-warning/10', icon: AlertOctagon },
  UNAVAILABLE: { className: 'text-muted-foreground border-border bg-secondary/40', icon: Database },
  UNKNOWN: { className: 'text-muted-foreground border-border bg-secondary/40', icon: CloudOff },
};

const STATUS_LABEL: Record<SourceStatus, string> = {
  live: 'Live',
  stale: 'Stale',
  unavailable: 'Unavailable',
  offline: 'Offline',
};

const SEVERITY_STYLE = {
  info: 'border-primary/40 text-primary',
  warning: 'border-warning/50 text-warning',
  critical: 'border-danger/50 text-danger',
} as const;

export const EVENT_LABEL: Record<string, string> = {
  'source-failed': 'Source failed',
  'source-recovered': 'Source recovered',
  'source-unavailable': 'Source unavailable',
  'earthquake-received': 'Earthquake received',
  'incident-received': 'Incident received',
  'forecast-changed': 'Forecast changed',
  'risk-changed': 'Risk changed',
  'official-warning-detected': 'Official warning',
  'official-warning-cleared': 'Warning cleared',
  'official-warning-unknown': 'Warning unknown',
  'tsunami-flag-set': 'Tsunami flag',
  'tsunami-flag-cleared': 'Tsunami flag cleared',
  'notification-generated': 'Notification',
  'notification-acknowledged': 'Acknowledged',
  'voice-generated': 'Voice',
  'voice-failed': 'Voice failed',
  'manual-refresh': 'Manual refresh',
  'gps-granted': 'Location acquired',
  'gps-denied': 'Location denied',
  'gps-lost': 'Location lost',
  'destination-selected': 'Destination selected',
  'route-calculated': 'Route calculated',
  'route-failed': 'Route failed',
  'went-offline': 'Offline',
  'came-online': 'Online',
};

export function CoastalCommandCenter({ language }: CoastalCommandCenterProps) {
  // Reads the single provider-owned pipeline. Calling useCoastalIntelligence()
  // here directly would start a second independent polling loop and a second set
  // of requests, which is what produced three identical USGS calls per page load.
  const state = useSharedCoastalIntelligence();

  return (
    <section className="container py-8 space-y-8" aria-label="Coastal Command Center" data-testid="coastal-command-center">
      <CommandCenterHeader state={state} language={language} />
      <CurrentCoastalState state={state} />
      <OfficialWarnings state={state} />
      <ForecastTimeline state={state} />
      <OutlookPanel state={state} />
      <RiskDrivers state={state} />
      <RiskExplanationPanel state={state} />
      <DataQualityPanel state={state} />
      <VoiceAlertCenter state={state} language={language} />
      <NotificationCenter state={state} />
      <EventStream state={state} />
      <SourceProvenance state={state} />
    </section>
  );
}

function CommandCenterHeader({ state, language: _language }: { state: CoastalIntelligenceState; language: Language }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Radio className="w-6 h-6 text-primary" aria-hidden="true" />
          Coastal Risk Intelligence
        </h2>
        <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
          Deterministic assessment of Juhu Beach from verified sources. Every value below is
          shown with the rule that produced it and the source it came from.
        </p>
      </div>
      <button
        onClick={state.refresh}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
        data-testid="cc-refresh"
      >
        {/* Driven by the store's REAL in-flight flag. The previous condition
            (`lastAttemptedFetch`) was set on the very first cycle and never
            cleared, so the spinner could only ever animate before the first
            fetch completed and was dead for the entire session. */}
        <Loader2
          className={`w-4 h-4 ${state.isFetching ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
        Refresh sources
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// 1. Current coastal state
// ---------------------------------------------------------------------

function CurrentCoastalState({ state }: { state: CoastalIntelligenceState }) {
  const meta = STATE_META[state.assessment.state];
  const Icon = meta.icon;
  const { features, assessment } = state;

  const headline = [
    { label: 'Wave height', value: features.waveHeightM, unit: 'm', digits: 2 },
    { label: 'Swell height', value: features.swellHeightM, unit: 'm', digits: 2 },
    { label: 'Wave period', value: features.wavePeriodS, unit: 's', digits: 1 },
    { label: 'Wind', value: features.windSpeedKmh, unit: 'km/h', digits: 0 },
    { label: 'Gusts', value: features.windGustKmh, unit: 'km/h', digits: 0 },
    { label: 'Precipitation', value: features.precipitationMm, unit: 'mm/h', digits: 1 },
  ];

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="cc-current-state">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-semibold ${meta.className}`}
          data-testid="cc-risk-state"
        >
          <Icon className="w-4 h-4" aria-hidden="true" />
          {meta.label}
        </span>
        {!state.isOnline && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-secondary text-xs">
            <CloudOff className="w-3.5 h-3.5" aria-hidden="true" /> Offline — showing retained data
          </span>
        )}
      </div>

      <p className="text-sm text-muted-foreground mb-4">{meta.description}</p>

      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {headline.map((item) => (
          <div key={item.label} className="rounded-xl border border-border bg-background/40 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{item.label}</dt>
            <dd className="text-lg font-semibold text-foreground mt-0.5" data-testid={`cc-metric-${item.label.toLowerCase().replace(/\s+/g, '-')}`}>
              {item.value === null ? (
                <span className="text-xs font-normal text-muted-foreground">Unavailable</span>
              ) : (
                <>
                  {item.value.toFixed(item.digits)}
                  <span className="text-xs font-normal text-muted-foreground ml-0.5">{item.unit}</span>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 grid sm:grid-cols-3 gap-3 text-xs">
        <div className="rounded-lg border border-border bg-background/30 px-3 py-2">
          <span className="text-muted-foreground">Tsunami status</span>
          <p
            className="font-semibold text-foreground mt-0.5"
            data-testid="cc-tsunami-status"
          >
            {assessment.tsunamiStatus === null
              ? 'Unknown'
              : assessment.tsunamiStatus
                ? 'Flag present'
                : 'Not flagged'}
            {assessment.tsunamiAuthoritative ? '' : ' (no authoritative flag)'}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background/30 px-3 py-2">
          <span className="text-muted-foreground">Official warning</span>
          <p className="font-semibold text-foreground mt-0.5" data-testid="cc-warning-summary">
            {assessment.officialWarningActive === null
              ? 'Unknown'
              : assessment.officialWarningActive
                ? 'Active'
                : 'None reported'}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background/30 px-3 py-2">
          <span className="text-muted-foreground">Evaluated</span>
          <p className="font-semibold text-foreground mt-0.5">
            {formatInstantInSourceTimezone(assessment.evaluatedAt)} IST
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 2. Official warnings
// ---------------------------------------------------------------------

function OfficialWarnings({ state }: { state: CoastalIntelligenceState }) {
  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="cc-official-warnings">
      <h3 className="text-lg font-bold flex items-center gap-2 mb-1">
        <ShieldAlert className="w-5 h-5 text-warning" aria-hidden="true" />
        Active Official Warnings
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        Government bulletins only. A model verdict is never presented as a warning.
      </p>

      <ul className="space-y-2" data-testid="cc-warning-list">
        {/*
          An empty list is ambiguous: it could mean "not attempted yet" or
          "attempted and the retriever was unreachable". Showing a spinner for
          both left the panel reading "Probing official sources…" forever after a
          failure, which looked like a hung request rather than an honest
          inability to read the source. The attempt state disambiguates them.
        */}
        {state.officialWarnings.length === 0 &&
          state.fetchState.warnings.lastAttemptedFetch === null && (
            <li className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Probing official
              sources…
            </li>
          )}

        {state.officialWarnings.length === 0 &&
          state.fetchState.warnings.lastAttemptedFetch !== null && (
            <li className="text-sm text-warning" data-testid="cc-warning-unreachable">
              {state.fetchState.warnings.errorMessage ??
                'The official warning retriever did not return a result. IMD and INCOIS status is UNKNOWN. This is not an all-clear.'}
            </li>
          )}

        {state.officialWarnings.map((warning) => (
          <li
            key={warning.productId}
            className="rounded-xl border border-border bg-background/40 p-3"
            data-testid="cc-warning-item"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-sm text-foreground">{warning.label}</span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  warning.active === true
                    ? 'border-danger/50 text-danger'
                    : warning.active === false
                      ? 'border-safe/40 text-safe'
                      : 'border-border text-muted-foreground'
                }`}
              >
                {warning.active === true
                  ? 'ACTIVE'
                  : warning.active === false
                    ? 'NONE REPORTED'
                    : 'UNKNOWN'}
              </span>
            </div>

            {warning.blockerDetail && (
              <p className="text-xs text-muted-foreground mt-1.5" data-testid="cc-warning-blocker">
                {warning.blockerDetail}
              </p>
            )}

            <a
              href={warning.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1.5"
            >
              Open official source <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------
// 3. Forecast timeline
// ---------------------------------------------------------------------

function ForecastTimeline({ state }: { state: CoastalIntelligenceState }) {
  const [selected, setSelected] = useState<ForecastPoint | null>(null);

  // Default the detail panel to the first real hour so the panel is useful
  // immediately, and keep it pointed at a valid hour if the list refreshes.
  const firstIso = state.forecast[0]?.isoTime ?? null;
  useEffect(() => {
    if (firstIso === null) {
      setSelected(null);
      return;
    }
    if (!selected || !state.forecast.some((p) => p.isoTime === selected.isoTime)) {
      setSelected(state.forecast[0]);
    }
  }, [firstIso, state.forecast, selected]);

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="cc-forecast">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Waves className="w-5 h-5 text-primary" aria-hidden="true" />
          Forecast Timeline
        </h3>
        <span className="text-[10px] font-mono text-muted-foreground shrink-0" data-testid="cc-forecast-horizon">
          {state.forecast.length} of {FORECAST_HORIZON_HOURS} hours published
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        {FORECAST_HORIZON_HOURS}-hour wave and weather forecast from Open-Meteo. Times are Indian
        Standard Time as published by the source. Only hours the source actually published are
        shown — select one to inspect its inputs.
      </p>

      {state.forecast.length === 0 ? (
        state.isFetching ? (
          <p
            className="text-sm text-muted-foreground flex items-center gap-2"
            data-testid="cc-forecast-loading"
            role="status"
          >
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Requesting forecast from Open-Meteo…
          </p>
        ) : (
          <div data-testid="cc-forecast-empty">
            <p className="text-sm text-muted-foreground">No forecast points have been published.</p>
            {state.fetchState.marine.errorMessage && (
              <p className="text-xs text-muted-foreground/80 mt-1 font-mono break-all">
                {state.fetchState.marine.errorKind}: {state.fetchState.marine.errorMessage}
              </p>
            )}
            {state.rateLimitedUntil && (
              <p className="text-xs text-warning mt-1" data-testid="cc-forecast-ratelimited">
                The source rate-limited this device (HTTP 429). The next request is held until{' '}
                {formatInstantInSourceTimezone(state.rateLimitedUntil)}.
              </p>
            )}
          </div>
        )
      ) : (
        <>
          <div className="overflow-x-auto pb-2">
            <ul className="flex gap-2 min-w-max" data-testid="cc-forecast-list">
              {state.forecast.map((point) => (
                <li key={point.isoTime}>
                  <button
                    onClick={() => setSelected(point)}
                    aria-pressed={selected?.isoTime === point.isoTime}
                    className={`w-24 rounded-lg border px-2 py-2 text-left transition-colors ${
                      point.hazardState === 'high'
                        ? 'border-danger/50 bg-danger/10'
                        : point.hazardState === 'elevated'
                          ? 'border-warning/50 bg-warning/10'
                          : 'border-border bg-background/40 hover:bg-secondary/60'
                    } ${selected?.isoTime === point.isoTime ? 'ring-2 ring-primary' : ''}`}
                    data-testid="cc-forecast-point"
                  >
                    <span className="block text-[11px] text-muted-foreground">
                      {formatForecastHourLabel(point.time)}
                    </span>
                    <span className="block text-sm font-semibold text-foreground mt-0.5">
                      {point.waveHeightM === null ? '—' : `${point.waveHeightM.toFixed(1)}m`}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {point.hazardState === 'insufficient-data'
                        ? 'no data'
                        : point.hazardState}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {selected && (
            <div className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-3" data-testid="cc-forecast-detail">
              <p className="text-xs font-semibold text-primary mb-2">
                Forecast inputs for {formatForecastTimestamp(selected.time)} IST
              </p>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {[
                  ['Wave height', selected.waveHeightM, 'm'],
                  ['Swell height', selected.swellHeightM, 'm'],
                  ['Wave period', selected.wavePeriodS, 's'],
                  ['Wind', selected.windSpeedKmh, 'km/h'],
                  ['Gusts', selected.windGustKmh, 'km/h'],
                  ['Precipitation', selected.precipitationMm, 'mm'],
                  ['Precip probability', selected.precipitationProbabilityPct, '%'],
                  ['Visibility', selected.visibilityM, 'm'],
                ].map(([label, value, unit]) => (
                  <div key={String(label)}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-foreground font-medium">
                      {value === null || value === undefined ? (
                        <span className="text-muted-foreground">Not published</span>
                      ) : (
                        <>
                          {Number(value).toFixed(1)} {unit}
                        </>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {selected.ruleIds.length > 0 ? (
                <p className="text-xs text-muted-foreground mt-2">
                  Rules at this hour: {selected.ruleIds.join(', ')}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-2">
                  {selected.hazardState === 'insufficient-data'
                    ? 'No rule inputs were published for this hour, so no hazard claim is made.'
                    : 'No rule threshold was crossed at this hour.'}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                Source status: {STATUS_LABEL[selected.sourceStatus]}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 4. Risk drivers
// ---------------------------------------------------------------------

function RiskDrivers({ state }: { state: CoastalIntelligenceState }) {
  const dimensions = Object.values(state.assessment.dimensions);

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="cc-risk-drivers">
      <h3 className="text-lg font-bold flex items-center gap-2 mb-1">
        <Activity className="w-5 h-5 text-primary" aria-hidden="true" />
        Risk Drivers
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        Each dimension is calculated independently. Missing inputs produce "insufficient data",
        never a low score.
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        {dimensions.map((dimension) => (
          <div
            key={dimension.id}
            className="rounded-xl border border-border bg-background/40 p-3"
            data-testid="cc-dimension"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-sm text-foreground">{dimension.label}</span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  dimension.state === 'insufficient-data'
                    ? 'border-border text-muted-foreground'
                    : dimension.state === 'nominal'
                      ? 'border-safe/40 text-safe'
                      : 'border-warning/50 text-warning'
                }`}
              >
                {(dimension.state || 'insufficient-data').toUpperCase()}
              </span>
            </div>

            {dimension.triggered.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {dimension.triggered.map((rule) => (
                  <li key={rule.ruleId} className="text-xs">
                    <span className="font-mono text-primary">{rule.ruleId}</span>
                    <span className="block text-muted-foreground mt-0.5">{rule.basis}</span>
                    <span className="block text-muted-foreground/80 mt-0.5">
                      Observed: {rule.observed.map((v) => (v === null ? 'n/a' : v)).join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : dimension.missingInputs.length > 0 ? (
              <p className="text-xs text-muted-foreground mt-2">
                Missing: {dimension.missingInputs.join(', ')}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-2">
                No threshold crossed by the published values.
              </p>
            )}

            <p className="text-[10px] text-muted-foreground/70 mt-2">
              Source: {STATUS_LABEL[dimension.sourceStatus]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 5. Why did risk change
// ---------------------------------------------------------------------

function RiskExplanationPanel({ state }: { state: CoastalIntelligenceState }) {
  const explanation = state.explanation;

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="cc-explanation">
      <h3 className="text-lg font-bold mb-3">Why did risk change?</h3>
      <p className="font-medium text-foreground mb-4" data-testid="cc-explanation-headline">
        {explanation.headline}
      </p>

      <div className="grid lg:grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Observed changes
          </h4>
          {explanation.observedChanges.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="cc-no-changes">
              No field-level change since the previous reading.
            </p>
          ) : (
            <ul className="space-y-1">
              {explanation.observedChanges.map((change) => (
                <li key={String(change.key)} className="text-xs flex items-center gap-2">
                  <span className="text-muted-foreground">{change.label}:</span>
                  <span className="font-mono text-foreground">
                    {change.previous === null ? 'n/a' : String(change.previous)}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono text-foreground">
                    {change.current === null ? 'n/a' : String(change.current)}
                  </span>
                  {change.unitHint && (
                    <span className="text-muted-foreground">{change.unitHint}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {explanation.rules.length > 0 && (
            <>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-4 mb-2">
                Rules that fired
              </h4>
              <ul className="space-y-1">
                {explanation.rules.map((rule) => (
                  <li key={rule.ruleId} className="text-xs">
                    <span className="font-mono text-primary">{rule.ruleId}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-background/30 p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Official warning
            </h4>
            <p className="text-xs text-foreground" data-testid="cc-explanation-warning">
              {explanation.officialWarning.summary}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-background/30 p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Tsunami
            </h4>
            <p className="text-xs text-foreground" data-testid="cc-explanation-tsunami">
              {explanation.tsunami.summary}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-background/30 p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Data quality
            </h4>
            <p className="text-xs text-foreground">
              {explanation.quality.state} · {explanation.quality.assessment}
            </p>
            <ul className="mt-1 space-y-0.5">
              {explanation.quality.reasons.map((reason) => (
                <li key={reason} className="text-[11px] text-muted-foreground">• {reason}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {state.transitions.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Recorded transitions
          </h4>
          <ul className="space-y-1" data-testid="cc-transitions">
            {state.transitions.slice(-6).reverse().map((t) => (
              <li key={t.id} className="text-xs text-muted-foreground">
                <span className="font-mono text-foreground">
                  {t.previousState} → {t.newState}
                </span>
                <span className="ml-2">{formatInstantInSourceTimezone(t.at)} IST</span>
                {t.ruleIds.length > 0 && (
                  <span className="ml-2 font-mono text-[10px]">{t.ruleIds.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 6. Data quality
// ---------------------------------------------------------------------

function DataQualityPanel({ state }: { state: CoastalIntelligenceState }) {
  const quality = state.assessment.quality;
  const meta = QUALITY_META[quality.state] ?? QUALITY_META.UNKNOWN;
  const Icon = meta.icon;

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="cc-quality">
      <h3 className="text-lg font-bold flex items-center gap-2 mb-3">
        <Database className="w-5 h-5 text-primary" aria-hidden="true" />
        Data Quality
      </h3>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className={`px-3 py-1 rounded-full border text-xs font-semibold ${meta.className}`} data-testid="cc-quality-state">
          {quality.state}
        </span>
        <span className="px-3 py-1 rounded-full border border-border text-xs text-muted-foreground">
          Evidence: {quality.assessment}
        </span>
        {quality.ageMs !== null && (
          <span className="px-3 py-1 rounded-full border border-border text-xs text-muted-foreground">
            Age: {Math.round(quality.ageMs / 1000)}s
          </span>
        )}
      </div>

      <ul className="space-y-1" data-testid="cc-quality-reasons">
        {quality.reasons.length === 0 && (
          <li className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Awaiting first reading…
          </li>
        )}
        {quality.reasons.map((reason) => (
          <li key={reason} className="text-xs text-muted-foreground flex items-start gap-2">
            <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            {reason}
          </li>
        ))}
      </ul>

      <div className="mt-4 grid sm:grid-cols-3 gap-2 text-xs">
        {(['marine', 'seismic', 'warnings'] as const).map((key) => {
          const fetch = state.fetchState[key];
          return (
            <div key={key} className="rounded-lg border border-border bg-background/30 px-3 py-2">
              <p className="capitalize text-muted-foreground">{key}</p>
              <p className="text-foreground font-medium mt-0.5">{STATUS_LABEL[fetch.status]}</p>
              {fetch.lastSuccessfulFetch && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Last ok: {formatInstantInSourceTimezone(fetch.lastSuccessfulFetch)} IST
                </p>
              )}
              {fetch.nextRefreshAt && (
                <p className="text-[10px] text-muted-foreground">
                  Next: {formatInstantInSourceTimezone(fetch.nextRefreshAt)} IST
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 7. Voice alert center
// ---------------------------------------------------------------------

function VoiceAlertCenter({ state, language }: { state: CoastalIntelligenceState; language: Language }) {
  // Playback state only. The spoken WORDS come from `buildVoiceScript` below,
  // which is the single generator of alert text; audibility comes from the
  // single speech engine (`speakVoiceScript`), which also files the
  // voice-generated / voice-failed event. Nothing here invents content.
  const [speech, setSpeech] = useState<'idle' | 'playing' | 'failed' | 'unavailable'>('idle');
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);
  // Guards the await below: a stop issued while generation is in flight must
  // not be overwritten by the stale result arriving afterwards.
  const speechRunRef = useRef(0);

  const script = useMemo(
    () =>
      buildVoiceScript({
        features: state.features,
        assessment: state.assessment,
        officialWarnings: state.officialWarnings,
        retrievedAt: state.assessment.evaluatedAt,
        language,
      }),
    [state.features, state.assessment, state.officialWarnings, language]
  );

  const generate = async () => {
    if (speech === 'playing') {
      speechRunRef.current += 1;
      stopSpeech();
      setSpeech('idle');
      setSpeechMessage(null);
      return;
    }
    const run = ++speechRunRef.current;
    setSpeech('playing');
    setSpeechMessage(null);
    const result: SpeechResult = await speakVoiceScript(script.text, {
      language,
      onEnd: () => {
        if (speechRunRef.current === run) {
          setSpeech('idle');
        }
      },
    });
    if (speechRunRef.current !== run) return;
    if (result.kind === 'playing') {
      setSpeechMessage(
        `Playing via ${result.backend === 'elevenlabs' ? 'ElevenLabs' : 'browser speech'} (${language})`
      );
    } else if (result.kind === 'failed') {
      setSpeech('failed');
      setSpeechMessage(result.message);
    } else {
      setSpeech('unavailable');
      setSpeechMessage(result.reason);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="cc-voice">
      <h3 className="text-lg font-bold flex items-center gap-2 mb-1">
        <Volume2 className="w-5 h-5 text-primary" aria-hidden="true" />
        Voice Alert Center
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        Spoken text is generated from current application state only, in the selected language ({language}).
      </p>

      <p
        className="text-xs text-muted-foreground bg-secondary/50 rounded-lg p-3 mb-3 max-h-32 overflow-y-auto"
        data-testid="cc-voice-script"
      >
        {script.text}
      </p>

      {script.unavailableFields.length > 0 && (
        <p className="text-xs text-warning mb-3" data-testid="cc-voice-unavailable">
          Not spoken: {script.unavailableFields.join(', ')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={generate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
          data-testid="cc-voice-generate"
        >
          {speech === 'playing' && !speechMessage ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Volume2 className="w-4 h-4" aria-hidden="true" />
          )}
          {speech === 'playing' && speechMessage ? 'Stop' : speech === 'playing' ? 'Generating…' : 'Generate voice alert'}
        </button>

        {speech === 'failed' && (
          <>
            <span className="text-xs text-danger" data-testid="cc-voice-error">{speechMessage}</span>
            <button
              onClick={generate}
              className="text-xs underline text-primary"
              data-testid="cc-voice-retry"
            >
              Retry
            </button>
          </>
        )}

        {speech === 'unavailable' && (
          <span className="text-xs text-muted-foreground" data-testid="cc-voice-unavailable-reason">
            {speechMessage}
          </span>
        )}

        {speech === 'playing' && speechMessage && (
          <span className="text-xs text-safe" data-testid="cc-voice-ready">
            {speechMessage}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 8. Notification center
// ---------------------------------------------------------------------

function NotificationCenter({ state }: { state: CoastalIntelligenceState }) {
  const unacknowledged = state.notifications.filter((n) => n.acknowledgedAt === null).length;

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="cc-notifications">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Bell className="w-5 h-5 text-primary" aria-hidden="true" />
          Notification Center
          {unacknowledged > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {unacknowledged} unacknowledged
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {unacknowledged > 0 && (
            <button
              onClick={state.acknowledgeAll}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary transition-colors"
              data-testid="cc-ack-all"
            >
              Acknowledge all
            </button>
          )}
          {/* Only offer the request while it can still succeed. Once the user
              has denied, re-prompting is a dead button in every modern browser,
              so we state the block instead. */}
          {state.notificationPermission === 'default' && (
            <button
              onClick={() => void state.requestPermission()}
              className="text-xs px-3 py-1.5 rounded-lg border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
              data-testid="cc-request-permission"
            >
              Enable browser notifications
            </button>
          )}
          {state.notificationPermission === 'denied' && (
            <span className="text-xs text-muted-foreground flex items-center gap-1" data-testid="cc-permission-denied">
              <BellOff className="w-3.5 h-3.5" aria-hidden="true" /> Blocked in browser
            </span>
          )}
          {state.notificationPermission === 'granted' && (
            <span className="text-xs text-safe">Browser notifications on</span>
          )}
          {state.notificationPermission === 'unsupported' && (
            <span className="text-xs text-muted-foreground">Browser notifications unsupported</span>
          )}
        </div>
      </div>

      {state.persistenceUnavailable && (
        <p className="text-xs text-warning mb-2">
          Local storage is unavailable; notifications will not persist across reloads.
        </p>
      )}

      {state.notifications.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="cc-notifications-empty">
          No notifications. Alerts are raised only when a documented rule fires against observed data.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="cc-notification-list">
          {state.notifications.map((notification) => (
            <li
              key={notification.id}
              className={`rounded-xl border p-3 ${
                notification.acknowledgedAt ? 'border-border bg-background/20 opacity-70' : SEVERITY_STYLE[notification.severity]
              }`}
              data-testid="cc-notification"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{notification.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{notification.detail}</p>
                  <p className="text-[10px] text-muted-foreground/80 mt-1">
                    <span className="font-mono">{notification.rule}</span> · {notification.source} ·{' '}
                    {formatInstantInSourceTimezone(notification.createdAt)} IST
                  </p>
                </div>
                {notification.acknowledgedAt === null ? (
                  <button
                    onClick={() => state.acknowledge(notification.id)}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary transition-colors"
                    data-testid="cc-acknowledge"
                  >
                    Acknowledge
                  </button>
                ) : (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    Ack {formatInstantInSourceTimezone(notification.acknowledgedAt)} IST
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 9. Event stream
// ---------------------------------------------------------------------

function EventStream({ state }: { state: CoastalIntelligenceState }) {
  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="cc-events">
      <h3 className="text-lg font-bold flex items-center gap-2 mb-1">
        <History className="w-5 h-5 text-primary" aria-hidden="true" />
        Event Stream
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        Every entry corresponds to a real system action. No synthetic events.
      </p>

      {state.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events recorded yet.</p>
      ) : (
        <ol className="space-y-1.5 max-h-72 overflow-y-auto" data-testid="cc-event-list">
          {state.events.slice(0, 60).map((event) => (
            <li key={event.id} className="text-xs flex items-start gap-2">
              <span className="text-muted-foreground tabular-nums shrink-0 w-16">
                {formatInstantInSourceTimezone(event.at)}
              </span>
              <span className="font-medium text-foreground shrink-0">
                {EVENT_LABEL[event.kind] ?? event.kind}
              </span>
              <span className="text-muted-foreground flex-1">{event.summary}</span>
              {event.link && (
                <a
                  href={event.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline shrink-0"
                  aria-label={`Open ${event.source}`}
                >
                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------
// Derived outlook
// ---------------------------------------------------------------------

/**
 * The transparent 48-hour projection.
 *
 * Deliberately labelled as a rule-based derivation rather than a prediction.
 * It applies the same thresholds as the headline verdict to each published
 * forecast hour, and every claim it makes is traceable to named rules and the
 * values that fired them. `coverage` is stated up front, because an outlook
 * drawn from half a horizon is a weaker claim than one drawn from all of it.
 */
function OutlookPanel({ state }: { state: CoastalIntelligenceState }) {
  const outlook = state.outlook;
  const summary = describeOutlook(outlook);

  const trendLabel: Record<string, string> = {
    worsening: 'Worsening',
    improving: 'Improving',
    stable: 'Steady',
    unknown: 'Trend unknown',
  };

  const peakLabel: Record<string, string> = {
    nominal: 'Nominal',
    elevated: 'Elevated',
    high: 'High',
  };

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="cc-outlook">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" aria-hidden="true" />
          48-hour outlook
        </h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
          Rule-based derivation
        </span>
      </div>

      <p className="text-xs text-muted-foreground mb-3" data-testid="cc-outlook-summary">
        {summary}
      </p>

      {outlook.coverage === 'none' ? (
        <p className="text-xs text-warning" data-testid="cc-outlook-unknown">
          No outlook can be projected. This is not an indication of calm conditions.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <div className="rounded-lg bg-secondary/50 p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Peak</p>
              <p className="text-sm font-bold" data-testid="cc-outlook-peak">
                {outlook.peakState && peakLabel[outlook.peakState]
                  ? peakLabel[outlook.peakState]
                  : 'Unknown'}
              </p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Trend</p>
              <p className="text-sm font-bold" data-testid="cc-outlook-trend">
                {trendLabel[outlook.trend]}
              </p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Peak hour</p>
              <p className="text-sm font-bold">
                {outlook.peakAt ? formatInstantInSourceTimezone(outlook.peakAt) : '—'}
              </p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Coverage</p>
              <p className="text-sm font-bold" data-testid="cc-outlook-coverage">
                {outlook.hoursAssessed}/{outlook.hoursExpected} h
              </p>
            </div>
          </div>

          {outlook.windows.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] text-muted-foreground mb-1.5">
                Elevated windows, worst first
              </p>
              <ul className="space-y-1.5" data-testid="cc-outlook-windows">
                {outlook.windows.map((window) => (
                  <li
                    key={`${window.from}-${window.to}`}
                    className="rounded-lg border border-border bg-background/40 p-2.5 text-[11px]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-foreground">
                        {formatInstantInSourceTimezone(window.from)} →{' '}
                        {formatInstantInSourceTimezone(window.to)}
                      </span>
                      <span className="text-muted-foreground">
                        {peakLabel[window.state] ?? window.state} · {window.hours} h
                      </span>
                    </div>
                    {window.basis && (
                      <p className="text-muted-foreground mt-1">
                        {/*
                          The cause is read from the rules that actually reached
                          this hour's severity, not inferred from whichever value
                          happened to be non-null. Guessing produced claims like
                          "peak driven by wave height 0.56 m" on an hour whose
                          real trigger was a visibility rule.
                        */}
                        Peak at {formatInstantInSourceTimezone(window.basis.at)} driven by{' '}
                        {window.basis.triggers.length > 0
                          ? window.basis.triggers
                              .map(
                                (trigger) =>
                                  `${trigger.ruleId} (${trigger.observed
                                    .map((value) => (value === null ? 'n/a' : String(value)))
                                    .join(', ')})`,
                              )
                              .join('; ')
                          : window.basis.ruleIds.join(', ') || 'published forecast values'}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">{outlook.coverageNote}</p>

          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] font-medium text-primary select-none">
              What this outlook cannot tell you
            </summary>
            <ul className="mt-1.5 space-y-0.5">
              {outlook.limitations.map((limitation) => (
                <li key={limitation} className="text-[11px] text-muted-foreground">
                  • {limitation}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 10. Data availability + provenance
//
// WHY THIS IS COMPACT
// -------------------
// Provenance was previously rendered as a full-height stack of expanded cards,
// one per source, each showing four timestamps and a field list. On a laptop it
// occupied more vertical space than the entire operational dashboard above it,
// which inverted the priority: the app looked like a metadata browser.
//
// It is supporting information, so it now renders as:
//
//   1. a one-glance availability line per source, always visible, so a reader
//      learns "IMD unreadable" in a second without expanding anything; and
//   2. full issued/valid/retrieved/fields/limitations detail behind a native
//      <details> toggle, collapsed by default.
//
// Nothing was deleted. Every field that was displayed before is still here,
// reachable in one click.
// ---------------------------------------------------------------------

const PROVENANCE_GROUP: Record<string, string> = {
  'open-meteo-marine': 'Weather & marine',
  'open-meteo-weather': 'Weather & marine',
  'usgs-earthquakes': 'Seismic',
  'imd-marine-forecast': 'Official warnings',
  'imd-sea-area-bulletin': 'Official warnings',
  'incois-ocean-state': 'Official warnings',
  'incois-tsunami': 'Official warnings',
};

const SOURCE_DOT: Record<string, string> = {
  live: 'bg-safe',
  stale: 'bg-warning',
  unavailable: 'bg-muted-foreground',
  offline: 'bg-muted-foreground',
};

function SourceProvenance({ state }: { state: CoastalIntelligenceState }) {
  const entries = state.provenance;

  const operational = entries.filter((e) => e.status === 'live').length;
  const degraded = entries.filter((e) => e.status === 'stale').length;
  const unavailable = entries.filter((e) => e.status === 'unavailable' || e.status === 'offline').length;

  // Grouped for scanning, but only groups that actually exist are rendered.
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = PROVENANCE_GROUP[entry.sourceId] ?? 'Other';
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-5" data-testid="cc-provenance">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" aria-hidden="true" />
          Data sources &amp; provenance
        </h3>
        <p className="text-[11px] text-muted-foreground" data-testid="cc-provenance-summary">
          {entries.length} sources · {operational} operational
          {degraded > 0 ? ` · ${degraded} stale` : ''}
          {unavailable > 0 ? ` · ${unavailable} unreadable` : ''}
        </p>
      </div>

      {/* Availability at a glance — this is the part that must always be visible. */}
      <div className="space-y-2.5 mb-3">
        {[...groups.entries()].map(([group, items]) => (
          <div key={group}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              {group}
            </p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {items.map((entry) => (
                <li key={`${entry.sourceId}-${entry.url}`} className="flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      SOURCE_DOT[entry.status] ?? 'bg-muted-foreground'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-[11px] text-foreground">{entry.sourceName}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {STATUS_LABEL[entry.status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {unavailable > 0 && (
        <p className="text-[11px] text-warning mb-3">
          {unavailable} source{unavailable === 1 ? '' : 's'} could not be read. Values that depend
          on {unavailable === 1 ? 'it' : 'them'} are shown as unknown, not as safe. Expand a source
          below for the exact reason.
        </p>
      )}

      <details className="group" data-testid="cc-provenance-details">
        <summary className="cursor-pointer text-xs font-medium text-primary select-none">
          Show full provenance
        </summary>

        <ul className="space-y-2 mt-3" data-testid="cc-provenance-list">
          {entries.map((entry) => (
            <li
              key={`${entry.sourceId}-${entry.url}`}
              className="rounded-xl border border-border bg-background/40"
              data-testid="cc-provenance-item"
            >
              <details>
                <summary className="flex flex-wrap items-center justify-between gap-2 p-3 cursor-pointer select-none">
                  <span className="font-medium text-xs text-foreground">{entry.sourceName}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                    {STATUS_LABEL[entry.status]}
                  </span>
                </summary>

                <div className="px-3 pb-3">
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline break-all"
                  >
                    {entry.url}
                    <ExternalLink className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                  </a>

                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] mt-2">
                    <div>
                      <dt className="text-muted-foreground">Issued</dt>
                      <dd className="text-foreground">
                        {entry.issuedAt ? formatInstantInSourceTimezone(entry.issuedAt) : 'Not published'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Valid from</dt>
                      <dd className="text-foreground">
                        {entry.validFrom ? formatInstantInSourceTimezone(entry.validFrom) : 'Not published'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Valid until</dt>
                      <dd className="text-foreground">
                        {entry.validUntil ? formatInstantInSourceTimezone(entry.validUntil) : 'Not published'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Retrieved</dt>
                      <dd className="text-foreground">
                        {entry.retrievedAt
                          ? `${formatInstantInSourceTimezone(entry.retrievedAt)} IST`
                          : 'Never'}
                      </dd>
                    </div>
                  </dl>

                  {entry.fieldsUsed.length > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Fields used: <span className="font-mono break-all">{entry.fieldsUsed.join(', ')}</span>
                    </p>
                  )}

                  {entry.limitations.length > 0 && (
                    <ul className="text-[11px] text-muted-foreground mt-1.5 space-y-0.5">
                      {entry.limitations.map((limitation) => (
                        <li key={limitation}>• {limitation}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export default CoastalCommandCenter;
