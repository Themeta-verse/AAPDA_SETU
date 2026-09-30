import { useMemo, useState } from 'react';
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
} from 'lucide-react';
import type { Language } from '@/lib/translations';
import { useCoastalIntelligence, type CoastalIntelligenceState } from '@/hooks/useCoastalIntelligence';
import { buildVoiceScript, generateVoiceAlert, readVoiceConfig, type VoiceState } from '@/voice/alertCenter';
import type { ForecastPoint } from '@/integrations/adapters/hazardFeatures';
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

const EVENT_LABEL: Record<string, string> = {
  'source-updated': 'Source updated',
  'source-failed': 'Source failed',
  'source-unavailable': 'Source unavailable',
  'earthquake-received': 'Earthquake received',
  'incident-received': 'Incident received',
  'forecast-changed': 'Forecast changed',
  'risk-changed': 'Risk changed',
  'official-warning-detected': 'Official warning',
  'notification-generated': 'Notification',
  'notification-acknowledged': 'Acknowledged',
  'voice-generated': 'Voice',
  'voice-failed': 'Voice failed',
  'went-offline': 'Offline',
  'came-online': 'Online',
};

export function CoastalCommandCenter({ language }: CoastalCommandCenterProps) {
  const state = useCoastalIntelligence({});

  return (
    <section className="container py-8 space-y-8" aria-label="Coastal Command Center" data-testid="coastal-command-center">
      <CommandCenterHeader state={state} language={language} />
      <CurrentCoastalState state={state} />
      <OfficialWarnings state={state} />
      <ForecastTimeline state={state} />
      <RiskDrivers state={state} />
      <RiskExplanationPanel state={state} />
      <DataQualityPanel state={state} />
      <VoiceAlertCenter state={state} />
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
        <Loader2 className={`w-4 h-4 ${state.fetchState.marine.lastAttemptedFetch ? '' : 'animate-spin'}`} aria-hidden="true" />
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
            {new Date(assessment.evaluatedAt).toLocaleTimeString()}
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
        {state.officialWarnings.length === 0 && (
          <li className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Probing official sources…
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

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="cc-forecast">
      <h3 className="text-lg font-bold flex items-center gap-2 mb-1">
        <Waves className="w-5 h-5 text-primary" aria-hidden="true" />
        Forecast Timeline
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        Only horizons published by the source are shown. Select a point to inspect its inputs.
      </p>

      {state.forecast.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="cc-forecast-empty">
          No forecast points have been published yet.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto pb-2">
            <ul className="flex gap-2 min-w-max" data-testid="cc-forecast-list">
              {state.forecast.slice(0, 24).map((point) => (
                <li key={point.isoTime}>
                  <button
                    onClick={() => setSelected(point)}
                    aria-pressed={selected?.isoTime === point.isoTime}
                    className={`w-24 rounded-lg border px-2 py-2 text-left transition-colors ${
                      point.hazardState === 'severe'
                        ? 'border-danger/50 bg-danger/10'
                        : point.hazardState === 'high'
                          ? 'border-warning/50 bg-warning/10'
                          : point.hazardState === 'elevated'
                            ? 'border-warning/30 bg-warning/5'
                            : 'border-border bg-background/40 hover:bg-secondary/60'
                    } ${selected?.isoTime === point.isoTime ? 'ring-2 ring-primary' : ''}`}
                    data-testid="cc-forecast-point"
                  >
                    <span className="block text-[11px] text-muted-foreground">
                      {new Date(point.isoTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="block text-sm font-semibold text-foreground mt-0.5">
                      {point.waveHeightM === null ? '—' : `${point.waveHeightM.toFixed(1)}m`}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">{point.hazardState}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {selected && (
            <div className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-3" data-testid="cc-forecast-detail">
              <p className="text-xs font-semibold text-primary mb-2">
                Forecast inputs for {new Date(selected.isoTime).toLocaleString()}
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
              {selected.ruleIds.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Rules at this hour: {selected.ruleIds.join(', ')}
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
                {dimension.state.toUpperCase()}
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
                <span className="ml-2">{new Date(t.at).toLocaleTimeString()}</span>
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
                  Last ok: {new Date(fetch.lastSuccessfulFetch).toLocaleTimeString()}
                </p>
              )}
              {fetch.nextRefreshAt && (
                <p className="text-[10px] text-muted-foreground">
                  Next: {new Date(fetch.nextRefreshAt).toLocaleTimeString()}
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

function VoiceAlertCenter({ state }: { state: CoastalIntelligenceState }) {
  const [voice, setVoice] = useState<VoiceState>({ kind: 'idle' });

  const script = useMemo(
    () =>
      buildVoiceScript({
        features: state.features,
        assessment: state.assessment,
        officialWarnings: state.officialWarnings,
        retrievedAt: state.assessment.evaluatedAt,
      }),
    [state.features, state.assessment, state.officialWarnings]
  );

  const generate = async () => {
    setVoice({ kind: 'loading' });
    const config = readVoiceConfig();
    const result = await generateVoiceAlert(script.text, {
      supabaseUrl: config.supabaseUrl ?? undefined,
      supabaseKey: config.supabaseKey ?? undefined,
    });
    setVoice(result);
  };

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="cc-voice">
      <h3 className="text-lg font-bold flex items-center gap-2 mb-1">
        <Volume2 className="w-5 h-5 text-primary" aria-hidden="true" />
        Voice Alert Center
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        Spoken text is generated from current application state only.
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
          disabled={voice.kind === 'loading'}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
          data-testid="cc-voice-generate"
        >
          {voice.kind === 'loading' ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Volume2 className="w-4 h-4" aria-hidden="true" />
          )}
          {voice.kind === 'loading' ? 'Generating…' : 'Generate voice alert'}
        </button>

        {voice.kind === 'error' && (
          <>
            <span className="text-xs text-danger" data-testid="cc-voice-error">{voice.message}</span>
            <button
              onClick={generate}
              className="text-xs underline text-primary"
              data-testid="cc-voice-retry"
            >
              Retry
            </button>
          </>
        )}

        {voice.kind === 'unavailable' && (
          <span className="text-xs text-muted-foreground" data-testid="cc-voice-unavailable-reason">
            {voice.reason}
          </span>
        )}

        {voice.kind === 'ready' && (
          <span className="text-xs text-safe" data-testid="cc-voice-ready">
            Played via {voice.source === 'elevenlabs' ? 'ElevenLabs' : 'browser speech'}
            {voice.kind === 'ready' && voice.url ? (
              <audio controls src={voice.url} className="ml-2 h-8 align-middle" />
            ) : null}
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
                    {new Date(notification.createdAt).toLocaleString()}
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
                    Ack {new Date(notification.acknowledgedAt).toLocaleTimeString()}
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
                {new Date(event.at).toLocaleTimeString()}
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
// 10. Source provenance
// ---------------------------------------------------------------------

function SourceProvenance({ state }: { state: CoastalIntelligenceState }) {
  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="cc-provenance">
      <h3 className="text-lg font-bold flex items-center gap-2 mb-1">
        <Database className="w-5 h-5 text-primary" aria-hidden="true" />
        Source Provenance
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        What each value is, when it was issued, when it was retrieved, and what it cannot tell you.
      </p>

      <ul className="space-y-2" data-testid="cc-provenance-list">
        {state.provenance.map((entry) => (
          <li
            key={`${entry.sourceId}-${entry.url}`}
            className="rounded-xl border border-border bg-background/40 p-3"
            data-testid="cc-provenance-item"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-sm text-foreground">{entry.sourceName}</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                {STATUS_LABEL[entry.status]}
              </span>
            </div>

            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
            >
              {entry.url.slice(0, 70)}{entry.url.length > 70 ? '…' : ''}
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>

            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] mt-2">
              <div>
                <dt className="text-muted-foreground">Issued</dt>
                <dd className="text-foreground">{entry.issuedAt ?? 'Not published'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Valid from</dt>
                <dd className="text-foreground">{entry.validFrom ?? 'Not published'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Valid until</dt>
                <dd className="text-foreground">{entry.validUntil ?? 'Not published'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Retrieved</dt>
                <dd className="text-foreground">
                  {entry.retrievedAt ? new Date(entry.retrievedAt).toLocaleTimeString() : 'Never'}
                </dd>
              </div>
            </dl>

            {entry.fieldsUsed.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Fields used: <span className="font-mono">{entry.fieldsUsed.join(', ')}</span>
              </p>
            )}

            {entry.limitations.length > 0 && (
              <ul className="text-[11px] text-muted-foreground mt-1.5 space-y-0.5">
                {entry.limitations.map((limitation) => (
                  <li key={limitation}>• {limitation}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default CoastalCommandCenter;
