import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Volume2, VolumeX, Bot, Waves, Zap, CloudRain, AlertTriangle, Megaphone } from 'lucide-react';
import { type Language, translations, voiceAlertTexts } from '@/lib/translations';
import { speak, stopSpeech } from '@/voice/speech';
import { type RiskLevel } from '@/lib/monitoringData';

interface VoiceAlertGuideProps {
  language: Language;
  riskLevel: RiskLevel;
}

export function VoiceAlertGuide({ language, riskLevel }: VoiceAlertGuideProps) {
  const t = translations[language];
  const [speaking, setSpeaking] = useState<string | null>(null);

  const alerts = [
    { key: 'highWave', label: t.highWaveWarning, icon: Waves, color: 'text-warning', bg: 'bg-warning/10 border-warning/30', hoverBg: 'hover:bg-warning/20' },
    { key: 'tsunami', label: t.tsunamiRisk, icon: Zap, color: 'text-danger', bg: 'bg-danger/10 border-danger/30', hoverBg: 'hover:bg-danger/20' },
    { key: 'flood', label: t.coastalFlood, icon: CloudRain, color: 'text-primary', bg: 'bg-primary/10 border-primary/30', hoverBg: 'hover:bg-primary/20' },
    { key: 'rain', label: t.heavyRain, icon: AlertTriangle, color: 'text-warning', bg: 'bg-warning/10 border-warning/30', hoverBg: 'hover:bg-warning/20' },
  ];

  const handleSpeak = async (key: string) => {
    if (speaking === key) {
      stopSpeech();
      setSpeaking(null);
      return;
    }
    stopSpeech();
    const text = voiceAlertTexts[language][key];
    if (text) {
      setSpeaking(key);
      // Sample alert read through the single speech engine. These are fixed
      // guide samples, explicitly played by the user — never live state.
      const result = await speak(text, {
        language,
        onEnd: () => setSpeaking(null),
        onError: () => setSpeaking(null),
      });
      if (result.kind !== 'playing') setSpeaking(null);
    }
  };

  return (
    <section className="container py-8" aria-label="Voice alert guidance">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Megaphone className="w-6 h-6 text-primary" />
          {t.voiceGuideTitle}
        </h2>
        <p className="text-muted-foreground mb-6 text-sm">{t.voiceGuideDesc}</p>

        <div className="glass-card rounded-2xl overflow-hidden border-primary/20">
          {/* Bot header */}
          <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="relative flex-shrink-0">
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl bg-gradient-to-br from-primary/30 to-ocean/20 flex items-center justify-center border border-primary/20">
                  <Bot className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
                </div>
                <AnimatePresence>
                  {speaking && (
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                      className="absolute inset-0 rounded-xl sm:rounded-2xl border-2 border-primary"
                    />
                  )}
                </AnimatePresence>
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-sm sm:text-lg truncate">{t.voiceGuideBotName}</h3>
                <div className="flex items-center gap-2 mt-0.5 sm:mt-1">
                  <div className={`w-2 h-2 rounded-full ${speaking ? 'bg-danger animate-pulse' : 'bg-safe'}`} />
                  <span className="text-[10px] sm:text-xs text-muted-foreground">
                    {speaking ? t.voiceGuideSpeaking : t.voiceGuideReady}
                  </span>
                </div>
              </div>
            </div>

            {/* Play Emergency Voice Alert button */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleSpeak('tsunami')}
              className={`hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors ${
                speaking === 'tsunami'
                  ? 'bg-danger/15 text-danger border border-danger/40'
                  : 'bg-danger text-danger-foreground hover:bg-danger/90'
              }`}
            >
              {speaking === 'tsunami' ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              {speaking === 'tsunami' ? t.stopVoiceAlert : 'Play Emergency Voice Alert'}
            </motion.button>
          </div>

          {/* Alert voice cards */}
          <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
            {alerts.map((alert) => {
              const isActive = speaking === alert.key;
              return (
                <motion.button
                  key={alert.key}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSpeak(alert.key)}
                  aria-label={`${isActive ? 'Stop' : 'Play'} ${alert.label} voice alert`}
                  aria-pressed={isActive}
                  className={`flex items-center gap-2 sm:gap-3 p-3 sm:p-4 rounded-xl border-2 transition-all text-left ${alert.bg} ${alert.hoverBg} ${
                    isActive ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
                  }`}
                >
                  <div className={`p-2.5 rounded-xl ${isActive ? 'bg-primary/20' : 'bg-card/50'}`}>
                    {isActive ? (
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ repeat: Infinity, duration: 0.8 }}
                      >
                        <VolumeX className="w-5 h-5 text-danger" />
                      </motion.div>
                    ) : (
                      <alert.icon className={`w-5 h-5 ${alert.color}`} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{alert.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {isActive ? t.stopVoiceAlert : t.playVoiceAlert}
                    </p>
                  </div>
                  <Volume2 className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary animate-pulse' : 'text-muted-foreground'}`} />
                </motion.button>
              );
            })}
          </div>

          {/* Mobile emergency button */}
          <div className="p-3 sm:hidden border-t border-border">
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => handleSpeak('tsunami')}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold uppercase tracking-wider ${
                speaking === 'tsunami'
                  ? 'bg-danger/15 text-danger border border-danger/40'
                  : 'bg-danger text-danger-foreground'
              }`}
            >
              {speaking === 'tsunami' ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              {speaking === 'tsunami' ? t.stopVoiceAlert : 'Play Emergency Voice Alert'}
            </motion.button>
          </div>

          {/* Speaking visualization */}
          <AnimatePresence>
            {speaking && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-3 pb-3 sm:px-5 sm:pb-5">
                  <div className="p-4 rounded-xl bg-primary/5 border border-primary/15">
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 rounded-lg bg-primary/20 mt-0.5">
                        <Bot className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-bold text-primary mb-1 uppercase tracking-wider">{t.voiceGuideBotName}</p>
                        <p className="text-sm text-foreground leading-relaxed">
                          {voiceAlertTexts[language][speaking]}
                        </p>
                      </div>
                    </div>
                    {/* Sound wave visualization */}
                    <div className="flex items-center justify-center gap-0.5 sm:gap-1 mt-3">
                      {Array.from({ length: 24 }).map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{ height: [4, Math.random() * 24 + 4, 4] }}
                          transition={{ repeat: Infinity, duration: 0.5 + Math.random() * 0.5, delay: i * 0.04 }}
                          className="w-1 rounded-full bg-primary/40"
                          style={{ height: 4 }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </section>
  );
}
