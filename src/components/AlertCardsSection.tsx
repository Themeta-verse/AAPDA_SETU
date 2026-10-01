import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, ChevronRight, Volume2, VolumeX, X, Waves, CloudRain, Zap, ShieldAlert, Wind } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import { type AlertInfo, type AlertType } from '@/lib/monitoringData';
import { speakVoiceScript, stopSpeech } from '@/voice/speech';
import { buildVoiceScript } from '@/voice/alertCenter';
import { useOptionalSharedCoastalIntelligence } from '@/hooks/CoastalIntelligenceProvider';

interface AlertCardsSectionProps {
  alerts: AlertInfo[];
  language: Language;
  /**
   * The exact current-state script, or null when no voice backend is usable.
   *
   * This component used to speak a canned per-alert string such as "Emergency.
   * Tsunami risk alert... Evacuate immediately" regardless of whether any
   * tsunami existed — tapping an inactive tsunami card announced an evacuation.
   * The spoken text is now supplied by the caller from real application state,
   * so this section can only ever read what is actually true.
   */
  spokenSummary?: string | null;
}

const alertIcons: Record<AlertType, typeof Waves> = {
  highWave: Waves,
  tsunami: Zap,
  flood: CloudRain,
  rain: CloudRain,
  storm: Wind,
};

export function AlertCardsSection({ alerts, language, spokenSummary = null }: AlertCardsSectionProps) {
  const t = translations[language];
  const [selectedAlert, setSelectedAlert] = useState<AlertInfo | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const activeAlerts = alerts.filter(a => a.active);

  /**
   * Read the CURRENT situation aloud, from the canonical state-derived script.
   *
   * No canned text is generated here. The script is built from the single
   * shared pipeline (same generator the Voice Alert Center uses), in the
   * current UI language, and played through the single speech engine — which
   * files the voice event on the shared stream. An explicit `spokenSummary`
   * prop still overrides, for callers that already hold a script.
   *
   * When no script is available the control is not rendered at all rather than
   * becoming a button that does nothing.
   */
  const shared = useOptionalSharedCoastalIntelligence();
  const canonicalScript = useMemo(
    () =>
      shared
        ? buildVoiceScript({
            features: shared.features,
            assessment: shared.assessment,
            officialWarnings: shared.officialWarnings,
            retrievedAt: shared.assessment.evaluatedAt,
            language,
          }).text
        : null,
    [shared, language]
  );
  const effectiveSummary = spokenSummary ?? canonicalScript;

  const handleSpeak = async () => {
    if (!effectiveSummary) return;
    if (speaking) {
      stopSpeech();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    const result = await speakVoiceScript(effectiveSummary, {
      language,
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
    // A failure or an unavailable backend leaves nothing audible: reset the
    // toggle rather than stranding it on "stop".
    if (result.kind !== 'playing') setSpeaking(false);
  };

  const guidanceSteps = [t.step1, t.step2, t.step3, t.step4, t.step5];

  return (
    <section id="alerts" className="container py-8" aria-label="Alert cards">
      <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <ShieldAlert className="w-6 h-6 text-danger" />
        {t.alerts}
        {activeAlerts.length > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="ml-2 px-2.5 py-0.5 text-xs font-black rounded-full bg-danger/20 text-danger border border-danger/30"
          >
            {activeAlerts.length} ACTIVE
          </motion.span>
        )}
      </h2>
      <p className="text-muted-foreground text-sm mb-6">
        {activeAlerts.length > 0
          ? `${activeAlerts.length} alert(s) currently active. Tap for details.`
          : 'No active alerts at this time.'}
      </p>

      {activeAlerts.length === 0 && (
        <div className="glass-card p-8 rounded-2xl text-center status-safe border-2">
          <div className="flex items-center justify-center gap-3">
            <div className="w-4 h-4 rounded-full bg-safe animate-pulse" />
            <p className="text-lg font-bold text-safe">✅ {t.safe}</p>
          </div>
          <p className="text-sm text-muted-foreground mt-2">All conditions within safe parameters</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {alerts.map((alert) => {
          const Icon = alertIcons[alert.type] || AlertTriangle;
          const isCritical = alert.severity === 'critical';
          const isHigh = alert.severity === 'high';

          return (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className={`glass-card p-5 rounded-xl cursor-pointer transition-all hover:scale-[1.02] ${
                alert.active
                  ? isCritical
                    ? 'border-2 border-danger/60 bg-danger/10 glow-danger'
                    : isHigh
                    ? 'border-2 border-danger/40 bg-danger/5'
                    : 'border-2 border-warning/40 bg-warning/5'
                  : 'opacity-40 border border-border'
              }`}
              onClick={() => alert.active && setSelectedAlert(alert)}
              role="button"
              tabIndex={0}
              aria-label={`${t[alert.titleKey]}: ${t[alert.descKey]}`}
              onKeyDown={(e) => e.key === 'Enter' && alert.active && setSelectedAlert(alert)}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className={`p-2.5 rounded-xl ${
                    alert.active
                      ? isCritical ? 'bg-danger/20' : isHigh ? 'bg-danger/15' : 'bg-warning/15'
                      : 'bg-secondary'
                  }`}>
                    <Icon className={`w-6 h-6 ${
                      alert.active
                        ? isCritical ? 'text-danger animate-pulse' : isHigh ? 'text-danger' : 'text-warning'
                        : 'text-muted-foreground'
                    }`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className={`font-bold ${alert.active ? '' : 'text-muted-foreground'}`}>{t[alert.titleKey]}</h3>
                      {alert.active && (
                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                          isCritical ? 'bg-danger/20 text-danger' : isHigh ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning'
                        }`}>
                          {isCritical ? 'CRITICAL' : isHigh ? 'HIGH' : 'MODERATE'}
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-1 text-muted-foreground">{t[alert.descKey]}</p>
                  </div>
                </div>
                {alert.active && <ChevronRight className="w-5 h-5 mt-1 flex-shrink-0 text-muted-foreground" />}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Alert Detail Modal */}
      <AnimatePresence>
        {selectedAlert && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/85 backdrop-blur-md"
            onClick={() => { setSelectedAlert(null); stopSpeech(); setSpeaking(false); }}
            role="dialog"
            aria-modal="true"
            aria-label="Alert details"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="glass-card p-6 rounded-2xl max-w-lg w-full border-2 border-danger/40 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Danger strip */}
              <div className="h-1 w-full bg-gradient-to-r from-danger via-warning to-danger rounded-full mb-5" />

              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-danger/15">
                    <AlertTriangle className="w-6 h-6 text-danger" />
                  </div>
                  <h3 className="text-xl font-black text-foreground">{t[selectedAlert.titleKey]}</h3>
                </div>
                <button
                  onClick={() => { setSelectedAlert(null); stopSpeech(); setSpeaking(false); }}
                  className="p-1.5 rounded-lg hover:bg-secondary"
                  aria-label="Close alert details"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-muted-foreground mb-5">{t[selectedAlert.descKey]}</p>

              <h4 className="font-bold text-foreground mb-3 flex items-center gap-2 text-sm uppercase tracking-wider">
                <ShieldAlert className="w-4 h-4 text-primary" />
                {t.guidanceTitle}
              </h4>
              <ol className="space-y-2 mb-6">
                {guidanceSteps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/20 text-primary text-xs font-black flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span className="text-sm text-foreground pt-1">{step}</span>
                  </li>
                ))}
              </ol>

              {effectiveSummary && (
                <button
                  onClick={handleSpeak}
                  aria-label={speaking ? 'Stop reading the current situation' : 'Read the current situation aloud'}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl font-bold text-sm uppercase tracking-wider transition-colors ${
                    speaking
                      ? 'bg-danger/20 text-danger hover:bg-danger/30 border border-danger/30'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  }`}
                >
                  {speaking ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  {speaking ? t.stopVoiceAlert : 'Read current situation'}
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
