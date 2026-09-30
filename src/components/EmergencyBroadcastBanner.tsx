import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, Waves, Zap, CloudRain, Volume2, Timer, Siren } from 'lucide-react';
import { type Language, translations, voiceAlertTexts, speakAlert, stopSpeaking } from '@/lib/translations';
import { type ScenarioType } from '@/components/ScenarioSimulation';
import { type RiskLevel } from '@/lib/monitoringData';

interface EmergencyBroadcastBannerProps {
  language: Language;
  riskLevel: RiskLevel;
  activeScenario: ScenarioType;
}

const scenarioConfig: Record<string, { icon: typeof Waves; voiceKey: string; titleKey: string; descKey: string; countdown: number }> = {
  highTide: { icon: Waves, voiceKey: 'highTide', titleKey: 'highTideWarning', descKey: 'highTideDesc', countdown: 900 },
  tsunami: { icon: Zap, voiceKey: 'tsunami', titleKey: 'tsunamiRisk', descKey: 'tsunamiDesc', countdown: 600 },
  flood: { icon: CloudRain, voiceKey: 'flood', titleKey: 'coastalFlood', descKey: 'coastalFloodDesc', countdown: 1200 },
};

const emergencyLabels: Record<Language, { emergency: string; evacuateIn: string; minutes: string; seconds: string; location: string }> = {
  en: { emergency: 'EMERGENCY ALERT', evacuateIn: 'Evacuate within', minutes: 'min', seconds: 'sec', location: 'Location: Juhu Beach, Mumbai' },
  hi: { emergency: 'आपातकालीन चेतावनी', evacuateIn: 'निकासी समय', minutes: 'मिनट', seconds: 'सेकंड', location: 'स्थान: जुहू बीच, मुंबई' },
  mr: { emergency: 'आपत्कालीन सतर्कता', evacuateIn: 'निर्वासन वेळ', minutes: 'मिनिटे', seconds: 'सेकंद', location: 'स्थान: जुहू बीच, मुंबई' },
  gu: { emergency: 'કટોકટી ચેતવણી', evacuateIn: 'ખાલી કરાવવાનો સમય', minutes: 'મિનિટ', seconds: 'સેકન્ડ', location: 'સ્થાન: જુહુ બીચ, મુંબઈ' },
};

export function EmergencyBroadcastBanner({ language, riskLevel, activeScenario }: EmergencyBroadcastBannerProps) {
  const t = translations[language];
  const el = emergencyLabels[language];
  const [dismissed, setDismissed] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const voiceTriggeredRef = useRef<string | null>(null);
  const prevScenarioRef = useRef<ScenarioType>(null);

  const isActive = (activeScenario !== null || riskLevel === 'critical') && !dismissed;
  const config = activeScenario ? scenarioConfig[activeScenario] : null;

  // Reset dismissed state when scenario changes
  useEffect(() => {
    if (activeScenario !== prevScenarioRef.current) {
      setDismissed(false);
      prevScenarioRef.current = activeScenario;
      if (activeScenario && config) {
        setCountdown(config.countdown);
      }
    }
  }, [activeScenario, config]);

  // Countdown timer
  useEffect(() => {
    if (!isActive || countdown <= 0) return;
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [isActive, countdown]);

  // Auto-trigger voice when banner appears
  useEffect(() => {
    if (isActive && activeScenario && voiceTriggeredRef.current !== activeScenario) {
      voiceTriggeredRef.current = activeScenario;
      const voiceKey = scenarioConfig[activeScenario]?.voiceKey;
      if (voiceKey) {
        const text = voiceAlertTexts[language][voiceKey];
        if (text) speakAlert(text, language);
      }
    }
    if (!isActive) {
      voiceTriggeredRef.current = null;
    }
  }, [isActive, activeScenario, language]);

  const handleDismiss = () => {
    stopSpeaking();
    setDismissed(true);
  };

  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;

  const Icon = config?.icon || AlertTriangle;

  if (!isActive) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -100, opacity: 0 }}
        className="fixed top-0 left-0 right-0 z-50"
        role="alert"
        aria-live="assertive"
      >
        <div className="bg-gradient-to-r from-danger via-danger/95 to-danger border-b-2 border-warning/50 shadow-2xl shadow-danger/30">
          {/* Flashing bar */}
          <div className="h-1 bg-warning animate-pulse" />

          <div className="container py-3 sm:py-4">
            <div className="flex items-start gap-3 sm:gap-4">
              {/* Icon */}
              <div className="flex-shrink-0 p-2 rounded-xl bg-white/10 animate-pulse">
                <Siren className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-warning animate-bounce" />
                  <span className="text-xs sm:text-sm font-black text-warning uppercase tracking-wider">
                    ⚠ {el.emergency}
                  </span>
                </div>

                <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {config ? t[config.titleKey] : t.critical}
                </h3>

                <p className="text-white/80 text-xs sm:text-sm mt-1">
                  {config ? t[config.descKey] : t.step1}
                </p>

                <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-2">
                  <span className="text-white/70 text-[11px] sm:text-xs">📍 {el.location}</span>

                  {countdown > 0 && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/20">
                      <Timer className="w-3 h-3 text-warning" />
                      <span className="text-xs font-bold font-mono text-white">
                        {el.evacuateIn}: {String(minutes).padStart(2, '0')}{el.minutes} {String(seconds).padStart(2, '0')}{el.seconds}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-1 text-white/60">
                    <Volume2 className="w-3 h-3 animate-pulse" />
                    <span className="text-[10px]">🔊</span>
                  </div>
                </div>
              </div>

              {/* Dismiss */}
              <button
                onClick={handleDismiss}
                className="flex-shrink-0 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white/80 hover:text-white"
                aria-label="Dismiss alert"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>

          {/* Bottom progress bar */}
          {countdown > 0 && config && (
            <div className="h-1 bg-white/10">
              <motion.div
                className="h-full bg-warning"
                initial={{ width: '100%' }}
                animate={{ width: `${(countdown / config.countdown) * 100}%` }}
                transition={{ duration: 1, ease: 'linear' }}
              />
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
