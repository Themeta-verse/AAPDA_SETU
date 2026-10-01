import { motion } from 'framer-motion';
import { Waves, Zap, CloudRain, RotateCcw, Radio, AlertTriangle } from 'lucide-react';
import { type Language, translations, voiceAlertTexts } from '@/lib/translations';
import { speak } from '@/voice/speech';
import { type MonitoringData } from '@/lib/monitoringData';

/**
 * Simulated scenarios use the same identifiers as live alerts so the banner,
 * cards and voice scripts stay in sync. `highWave` is wave height, not tide.
 */
export type ScenarioType = 'highWave' | 'tsunami' | 'flood' | null;

interface ScenarioSimulationProps {
  language: Language;
  activeScenario: ScenarioType;
  onSimulate: (scenario: ScenarioType) => void;
}

export function getScenarioData(scenario: ScenarioType): MonitoringData | null {
  switch (scenario) {
    case 'highWave':
      return { waveHeight: 4.8, windSpeed: 22, rainProbability: 45, seaCondition: 'rough', riskLevel: 'critical', status: 'live' };
    case 'tsunami':
      return { waveHeight: 5.0, windSpeed: 35, rainProbability: 30, seaCondition: 'veryRough', riskLevel: 'critical', status: 'live' };
    case 'flood':
      return { waveHeight: 3.8, windSpeed: 18, rainProbability: 92, seaCondition: 'rough', riskLevel: 'critical', status: 'live' };
    default:
      return null;
  }
}

export function ScenarioSimulation({ language, activeScenario, onSimulate }: ScenarioSimulationProps) {
  const t = translations[language];

  const scenarios = [
    { id: 'highWave' as ScenarioType, label: t.simulateHighWave, icon: Waves, color: 'text-warning', bg: 'bg-warning/10 border-warning/30 hover:bg-warning/20' },
    { id: 'tsunami' as ScenarioType, label: t.simulateTsunami, icon: Zap, color: 'text-danger', bg: 'bg-danger/10 border-danger/30 hover:bg-danger/20' },
    { id: 'flood' as ScenarioType, label: t.simulateFlood, icon: CloudRain, color: 'text-primary', bg: 'bg-primary/10 border-primary/30 hover:bg-primary/20' },
  ];

  const handleSimulate = (scenario: ScenarioType) => {
    onSimulate(scenario);
    if (scenario) {
      // Drill narration for an explicitly started simulation, played through
      // the single speech engine. This text describes the DRILL, never live
      // conditions — live alerts are built from observed state elsewhere.
      const voiceKey = scenario === 'highWave' ? 'highWave' : scenario === 'tsunami' ? 'tsunami' : 'flood';
      const text = voiceAlertTexts[language][voiceKey];
      if (text) void speak(text, { language });
    }
  };

  return (
    <section className="container py-8" aria-label="Disaster scenario simulation">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Radio className="w-6 h-6 text-warning" />
          {t.scenarioTitle}
        </h2>
        <p className="text-muted-foreground mb-6 text-sm">{t.scenarioDesc}</p>

        {activeScenario && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mb-4 p-4 rounded-xl border border-danger/40 bg-danger/10 flex items-center gap-3"
          >
            <AlertTriangle className="w-5 h-5 text-danger animate-pulse" />
            <span className="text-sm font-semibold text-danger">{t.scenarioActive}</span>
          </motion.div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {scenarios.map((s) => (
            <motion.button
              key={s.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleSimulate(s.id)}
              className={`flex items-center gap-3 p-4 rounded-xl border font-medium text-sm transition-colors ${s.bg} ${
                activeScenario === s.id ? 'ring-2 ring-offset-2 ring-offset-background ring-danger' : ''
              }`}
            >
              <s.icon className={`w-5 h-5 ${s.color}`} />
              {s.label}
            </motion.button>
          ))}

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleSimulate(null)}
            className="flex items-center gap-3 p-4 rounded-xl border border-border bg-secondary/50 hover:bg-secondary font-medium text-sm text-muted-foreground transition-colors"
          >
            <RotateCcw className="w-5 h-5" />
            {t.resetScenario}
          </motion.button>
        </div>
      </motion.div>
    </section>
  );
}
