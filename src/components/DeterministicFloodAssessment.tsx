import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldAlert,
  Clock,
  Database,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  HelpCircle,
  CheckCircle2,
  Info,
  Layers,
  MapPin,
  ChevronDown,
  ChevronUp,
  FileText,
  ExternalLink,
  ArrowRight,
} from 'lucide-react';
import { type Language } from '@/lib/translations';
import {
  type UrbanFloodAssessmentResult,
  type ForecastHorizon,
  type FloodRiskLevel,
  type HorizonAssessment,
  FORECAST_HORIZONS,
} from '@/lib/floodIntelligence';

interface DeterministicFloodAssessmentProps {
  assessment: UrbanFloodAssessmentResult;
  language?: Language;
  onNavigateToCommand?: () => void;
}

function getRiskBadgeStyle(level: FloodRiskLevel): {
  bg: string;
  text: string;
  border: string;
  icon: typeof ShieldAlert;
  shortLabel: string;
} {
  switch (level) {
    case 'CRITICAL':
      return {
        bg: 'bg-red-500/10 dark:bg-red-950/30',
        text: 'text-red-600 dark:text-red-400',
        border: 'border-red-500/30',
        icon: AlertTriangle,
        shortLabel: 'CRITICAL',
      };
    case 'HIGH':
      return {
        bg: 'bg-orange-500/10 dark:bg-orange-950/30',
        text: 'text-orange-600 dark:text-orange-400',
        border: 'border-orange-500/30',
        icon: AlertTriangle,
        shortLabel: 'HIGH',
      };
    case 'MODERATE':
      return {
        bg: 'bg-yellow-500/10 dark:bg-yellow-950/30',
        text: 'text-yellow-600 dark:text-yellow-400',
        border: 'border-yellow-500/30',
        icon: Info,
        shortLabel: 'MODERATE',
      };
    case 'SAFE':
      return {
        bg: 'bg-emerald-500/10 dark:bg-emerald-950/30',
        text: 'text-emerald-600 dark:text-emerald-400',
        border: 'border-emerald-500/30',
        icon: CheckCircle2,
        shortLabel: 'SAFE',
      };
    case 'INSUFFICIENT_DATA':
    case 'UNKNOWN':
    default:
      return {
        bg: 'bg-slate-500/10 dark:bg-slate-900/40',
        text: 'text-slate-600 dark:text-slate-400',
        border: 'border-slate-500/30',
        icon: HelpCircle,
        shortLabel: 'NO DATA',
      };
  }
}

function getTrendIcon(trend: HorizonAssessment['trend']) {
  switch (trend) {
    case 'escalation':
      return <TrendingUp className="w-3.5 h-3.5 text-orange-500" />;
    case 'reduction':
      return <TrendingDown className="w-3.5 h-3.5 text-emerald-500" />;
    case 'peak':
      return <AlertTriangle className="w-3.5 h-3.5 text-red-500" />;
    case 'insufficient_data':
      return <HelpCircle className="w-3.5 h-3.5 text-slate-500" />;
    default:
      return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

export function DeterministicFloodAssessment({
  assessment,
  onNavigateToCommand,
}: DeterministicFloodAssessmentProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [showProvenance, setShowProvenance] = useState<boolean>(false);

  const currentRisk = assessment.currentRisk;
  const currentBadge = getRiskBadgeStyle(currentRisk.riskLevel);
  const CurrentBadgeIcon = currentBadge.icon;

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const formatTime = (iso?: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      className="glass-card rounded-2xl border border-border p-4 space-y-3"
      data-testid="deterministic-flood-assessment"
    >
      {/* Header: Title + Current Risk Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/50">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-primary/10 text-primary border border-primary/20">
            Deterministic Forecast-Based Risk Assessment
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">v{assessment.modelVersion}</span>
        </div>
        <div className="flex items-center gap-2">
          {onNavigateToCommand && (
            <button
              type="button"
              onClick={onNavigateToCommand}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 text-xs font-semibold transition-colors"
              data-testid="navigate-command-btn"
              title="Navigate to Incident Command & Resource Dispatch"
            >
              <span>Incident Command</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold text-xs uppercase tracking-wide ${currentBadge.bg} ${currentBadge.text} ${currentBadge.border}`}
            data-testid="current-risk-badge"
          >
            <CurrentBadgeIcon className="w-4 h-4" />
            <span>NOW: {currentBadge.shortLabel}</span>
          </div>
        </div>
      </div>

      {/* Location Context - compact */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <MapPin className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
        <span className="font-medium text-foreground">{assessment.location.zoneName}</span>
        {assessment.location.ward && <span>· {assessment.location.ward}</span>}
        <span>({assessment.location.city})</span>
        <span className="text-[10px] px-1.5 py-0.2 rounded bg-secondary font-mono border border-border">
          {assessment.location.isCoastal ? 'Coastal Zone' : 'Inland Zone'}
        </span>
      </div>

      {/* Why: Contributing Factors - compact */}
      <div className="p-3 rounded-xl bg-card/60 border border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-primary" />
            Why: Contributing Factors
          </span>
          {currentRisk.contributingInputs.length > 0 && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {currentRisk.contributingInputs.filter(c => c.contributionLevel !== 'SAFE').length} active / {currentRisk.contributingInputs.length} total
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {currentRisk.contributingInputs.map((input, i) => {
            const style = getRiskBadgeStyle(input.contributionLevel);
            if (input.contributionLevel === 'SAFE') return null;
            return (
              <span
                key={i}
                className={`px-2 py-0.5 rounded-full font-medium text-[10px] border ${style.bg} ${style.text} ${style.border}`}
                title={input.rule}
              >
                {input.source}: {input.value}{input.unit}
              </span>
            );
          })}
          {currentRisk.contributingInputs.every(c => c.contributionLevel === 'SAFE') && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/30">
              All inputs within safe thresholds
            </span>
          )}
          {currentRisk.contributingInputs.length === 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-500/10 text-slate-600 border border-slate-500/30">
              No contributing data available
            </span>
          )}
        </div>
      </div>

      {/* Forecast Horizons - compact cards */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-primary" />
            Forecast Horizons
          </span>
          <button
            onClick={() => toggleSection('forecast')}
            className="text-[11px] text-primary hover:underline font-medium flex items-center gap-1"
          >
            {expandedSection === 'forecast' ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                Expand Details
              </>
            )}
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: expandedSection === 'forecast' ? 1 : 0, height: expandedSection === 'forecast' ? 'auto' : 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 p-2 bg-card/40 rounded-xl border border-border">
            {FORECAST_HORIZONS.map((h) => {
              const item = assessment.forecastHorizons[h];
              const style = getRiskBadgeStyle(item.riskLevel);
              const TrendIcon = getTrendIcon(item.trend);
              const isNow = h === 'NOW';

              return (
                <div
                  key={h}
                  className={`p-2.5 rounded-lg text-center transition-colors ${
                    isNow ? 'bg-primary/10 border-primary/20 ring-1 ring-primary/20' : 'hover:bg-card'
                  }`}
                  data-testid={`horizon-card-${h.replace('+', '')}`}
                >
                  <div className="font-mono text-[11px] font-bold uppercase tracking-wide mb-1">
                    {h}
                  </div>
                  <div
                    className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase mx-auto mb-1.5 w-fit ${style.bg} ${style.text}`}
                  >
                    {style.shortLabel}
                  </div>
                  <div className="flex items-center justify-center gap-1 mb-1">
                    {TrendIcon}
                    <span className="text-[9px] text-muted-foreground">{item.trend}</span>
                  </div>
                  {item.targetTime && (
                    <div className="text-[9px] text-muted-foreground font-mono">{formatTime(item.targetTime)}</div>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>

      {/* Expandable Detailed Sections */}
      <div className="space-y-2 border-t border-border/50 pt-3">
        {/* Detailed Assessment */}
        <button
          onClick={() => toggleSection('detailed')}
          className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-card/50 transition-colors text-left"
        >
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-primary" />
            Detailed Assessment
          </span>
          {expandedSection === 'detailed' ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: expandedSection === 'detailed' ? 1 : 0, height: expandedSection === 'detailed' ? 'auto' : 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-2">
            <div className="p-3 rounded-xl border border-border bg-card/40 space-y-1">
              <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
                1. Where is Risk Monitored?
              </span>
              <p className="text-muted-foreground leading-relaxed">{assessment.answers.where}</p>
            </div>

            <div className="p-3 rounded-xl border border-border bg-card/40 space-y-1">
              <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
                2. How Severe is it?
              </span>
              <p className="text-muted-foreground leading-relaxed">{assessment.answers.howSevere}</p>
            </div>

            <div className="p-3 rounded-xl border border-border bg-card/40 space-y-1 md:col-span-2">
              <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
                3. Why? (Deterministic Factor Breakdown)
              </span>
              <ul className="space-y-1 mt-1 text-muted-foreground">
                {assessment.answers.why.map((reason, idx) => (
                  <li key={idx} className="flex items-start gap-1.5 leading-snug">
                    <span className="text-primary font-bold">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-3 rounded-xl border border-border bg-card/40 space-y-1">
              <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
                4. What Happens Next?
              </span>
              <p className="text-muted-foreground leading-relaxed">{assessment.answers.whatHappensNext}</p>
            </div>

            <div className="p-3 rounded-xl border border-border bg-card/40 space-y-1">
              <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
                5. What Sources Support This?
              </span>
              <div className="flex flex-wrap gap-1 mt-1">
                {assessment.answers.whatSources.map((src, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded-md bg-secondary text-foreground text-[10px] font-medium border border-border"
                  >
                    {src}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Contributing Inputs Table for Selected Horizon (NOW) */}
          <div className="space-y-2 pt-3 border-t border-border/50">
            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-primary" />
              Contributing Inputs (NOW)
            </h4>

            {currentRisk.contributingInputs.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
                No contributing data available for current horizon.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-secondary/60 text-muted-foreground font-semibold border-b border-border">
                    <tr>
                      <th className="p-2">Source</th>
                      <th className="p-2">Observation</th>
                      <th className="p-2">Evaluated Rule</th>
                      <th className="p-2">Contribution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {currentRisk.contributingInputs.map((input, i) => {
                      const style = getRiskBadgeStyle(input.contributionLevel);
                      return (
                        <tr key={i} className="hover:bg-card/50 transition-colors">
                          <td className="p-2 font-medium text-foreground whitespace-nowrap">{input.source}</td>
                          <td className="p-2 font-mono text-[11px] whitespace-nowrap">
                            {input.value !== null ? `${input.value} ${input.unit}` : 'Unavailable'}
                          </td>
                          <td className="p-2 text-muted-foreground text-[11px]">{input.rule}</td>
                          <td className="p-2 whitespace-nowrap">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${style.bg} ${style.text}`}>
                              {input.contributionLevel}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>

        {/* Source Provenance */}
        <button
          onClick={() => setShowProvenance(!showProvenance)}
          className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-card/50 transition-colors text-left"
        >
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-primary" />
            Source Provenance & Audit Trail
          </span>
          {showProvenance ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: showProvenance ? 1 : 0, height: showProvenance ? 'auto' : 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="p-3 rounded-xl bg-secondary/40 border border-border text-xs font-mono space-y-2 text-muted-foreground pt-2">
            <div className="flex items-center justify-between font-bold text-foreground">
              <span>AUDIT & PROVENANCE METADATA</span>
              <span>MODEL: {assessment.modelVersion}</span>
            </div>
            <div>Assessed Timestamp: {assessment.assessedAt}</div>
            <div>Data Freshness: {currentRisk.provenance.freshness}</div>
            <div>
              Active Sources: {currentRisk.provenance.sourceNames.join(', ')}
            </div>
            {currentRisk.provenance.missingSources.length > 0 && (
              <div className="text-red-500 font-bold">
                Missing / Degraded Sources: {currentRisk.provenance.missingSources.join(', ')}
              </div>
            )}
            <pre className="p-2 rounded bg-background/80 text-[10px] overflow-x-auto whitespace-pre-wrap">
              {currentRisk.explanation}
            </pre>
          </div>
        </motion.div>
      </div>
    </div>
  );
}