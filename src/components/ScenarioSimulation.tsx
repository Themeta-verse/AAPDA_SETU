import { motion } from 'framer-motion';
import { Waves, Zap, CloudRain, RotateCcw, Radio, AlertTriangle, GraduationCap } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import { speak } from '@/voice/speech';

/**
 * Training scenarios.
 *
 * These are EXERCISES, not observations. Every value they use is invented for
 * teaching, which is legitimate only while it is impossible to mistake them for
 * real conditions.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * This component previously exported `getScenarioData()`, and `Index` used it to
 * REPLACE the live monitoring snapshot. Selecting "Simulate Tsunami" therefore
 * made the hero, the mobile emergency banner, the location panel and the voice
 * guide all report a tsunami that had not happened, and auto-played a canned
 * evacuation announcement. A drill was silently impersonating the real feed.
 *
 * Now a scenario is a self-contained, clearly labelled drill card. It never
 * reaches the operational risk state, the header, or the command center, and
 * any speech it produces announces itself as a drill.
 */
export type ScenarioType = 'highWave' | 'tsunami' | 'flood' | null;

interface ScenarioSimulationProps {
  language: Language;
  activeScenario: ScenarioType;
  onSimulate: (scenario: ScenarioType) => void;
}

/**
 * The invented conditions shown inside a drill card.
 *
 * Named to make their status unmistakable at every call site. Nothing here is
 * ever merged into application state.
 */
interface DrillCondition {
  scenario: Exclude<ScenarioType, null>;
  icon: typeof Waves;
  title: string;
  description: string;
  /** Values used only to render the drill card. Never exported to state. */
  readings: { label: string; value: string }[];
  spokenLine: string;
}

const DRILL_READINGS: Record<
  Exclude<ScenarioType, null>,
  { label: string; value: string }[]
> = {
  highWave: [
    { label: 'Significant wave height', value: '4.8 m' },
    { label: 'Sustained wind', value: '22 km/h' },
    { label: 'Rain probability', value: '45 %' },
  ],
  tsunami: [
    { label: 'Significant wave height', value: '5.0 m' },
    { label: 'Sustained wind', value: '35 km/h' },
    { label: 'Rain probability', value: '30 %' },
  ],
  flood: [
    { label: 'Significant wave height', value: '3.8 m' },
    { label: 'Sustained wind', value: '18 km/h' },
    { label: 'Rain probability', value: '92 %' },
  ],
};

const DRILL_TEXT: Record<Language, Record<Exclude<ScenarioType, null>, string>> = {
  en: {
    highWave:
      'This is a training exercise, not a real alert. In a high wave event, move away from the shoreline immediately and follow instructions from the authorities.',
    tsunami:
      'This is a training exercise, not a real alert. In a tsunami event, move inland or to higher ground at once and follow official instructions only.',
    flood:
      'This is a training exercise, not a real alert. In a coastal flood, avoid low-lying areas and do not walk through flowing water.',
  },
  hi: {
    highWave:
      'यह एक प्रशिक्षण अभ्यास है, वास्तविक चेतावनी नहीं। उच्च लहर की स्थिति में तुरंत समुद्र तट से दूर जाएं और अधिकारियों के निर्देशों का पालन करें।',
    tsunami:
      'यह एक प्रशिक्षण अभ्यास है, वास्तविक चेतावनी नहीं। सुनामी की स्थिति में तुरंत अंतर्देशीय या ऊंचे स्थान पर जाएं और केवल आधिकारिक निर्देशों का पालन करें।',
    flood:
      'यह एक प्रशिक्षण अभ्यास है, वास्तविक चेतावनी नहीं। तटीय बाढ़ में निचले इलाकों से बचें और बहते पानी में न चलें।',
  },
  mr: {
    highWave:
      'हा प्रशिक्षण अभ्यास आहे, खरेखरा इशारा नाही. उच्च लाटाच्या परिस्थितीत लगेच किनाऱ्यापासून दूर जा आणि अधिकाऱ्यांच्या सूचनांचे पालन करा.',
    tsunami:
      'हा प्रशिक्षण अभ्यास आहे, खरेखरा इशारा नाही. त्सुनामीच्या परिस्थितीत लगेच अंतर्देशीय किंवा उंच ठिकाणी जा आणि फक्त अधिकृत सूचनांचे पालन करा.',
    flood:
      'हा प्रशिक्षण अभ्यास आहे, खरेखरा इशारा नाही. किनारपट्टी पूरात सखल भाग टाळा आणि वाहणाऱ्या पाण्यातून चालू नका.',
  },
  gu: {
    highWave:
      'આ તાલીમાનો કસોટો છે, ખરેખરી ચેતવણી નથી. ઊંચી લાવણ્યની સ્થિતિમાં તરત દરિયાકાંઠેથી દૂર જાઓ અને અધિકારીઓની સૂચનોનું પાલન કરો.',
    tsunami:
      'આ તાલીમાનો કસોટો છે, ખરેખરી ચેતવણી નથી. સુનામીની સ્થિતિમાં તરત અંદરની તરફ કે ઊંચા સ્થાને જાઓ અને ફક્ત અધિકૃત સૂચનોનું પાલન કરો.',
    flood:
      'આ તાલીમાનો કસોટો છે, ખરેખરી ચેતવણી નથી. દરિયાકાંઠાના પૂરમાં નીચા વિસ્તારો ટાળો અને વહેતા પાણીમાંથી ન ચાલો.',
  },
};

export function ScenarioSimulation({ language, activeScenario, onSimulate }: ScenarioSimulationProps) {
  const t = translations[language];
  const drillText = DRILL_TEXT[language];

  const scenarios: DrillCondition[] = [
    {
      scenario: 'highWave',
      icon: Waves,
      title: t.simulateHighWave,
      description: drillText.highWave,
      readings: DRILL_READINGS.highWave,
      spokenLine: drillText.highWave,
    },
    {
      scenario: 'tsunami',
      icon: Zap,
      title: t.simulateTsunami,
      description: drillText.tsunami,
      readings: DRILL_READINGS.tsunami,
      spokenLine: drillText.tsunami,
    },
    {
      scenario: 'flood',
      icon: CloudRain,
      title: t.simulateFlood,
      description: drillText.flood,
      readings: DRILL_READINGS.flood,
      spokenLine: drillText.flood,
    },
  ];

  /**
   * Speak the drill script. Every drill line begins by announcing that it is a
   * training exercise, so a drill can never be mistaken over a loudspeaker for a
   * real alert.
   */
  const handleSimulate = (scenario: ScenarioType) => {
    onSimulate(scenario);
    if (!scenario) return;
    void speak(drillText[scenario], { language });
  };

  return (
    <section className="container py-8" aria-label="Disaster scenario training drill">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-warning" />
          {t.scenarioTitle}
        </h2>

        {/* Unmissable statement that these numbers are invented. */}
        <div className="flex items-start gap-2.5 p-3 rounded-lg border border-warning/40 bg-warning/10 mb-4">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-warning/90">
            <span className="font-bold uppercase tracking-wide">Training exercise.</span> The
            readings below are invented for practice. They are not observations, they are not
            connected to any source, and they never affect the risk level, alerts or forecast
            shown anywhere else on this page.
          </p>
        </div>

        <p className="text-muted-foreground mb-6 text-sm">{t.scenarioDesc}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {scenarios.map((s) => {
            const isActive = activeScenario === s.scenario;
            return (
              <motion.button
                key={s.scenario}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleSimulate(s.scenario)}
                aria-pressed={isActive}
                className={`flex flex-col items-start gap-2 p-4 rounded-xl border font-medium text-sm text-left transition-colors ${
                  isActive
                    ? 'border-warning bg-warning/20'
                    : 'border-border bg-secondary/40 hover:bg-secondary'
                }`}
              >
                <span className="flex items-center gap-2">
                  <s.icon className="w-5 h-5 text-warning" />
                  {s.title}
                </span>
                {isActive && (
                  <span className="text-[10px] uppercase tracking-wider font-bold text-warning">
                    {t.scenarioActive}
                  </span>
                )}
              </motion.button>
            );
          })}

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

        {activeScenario && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-4 rounded-xl border-2 border-warning/50 bg-warning/5 overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-warning/30 bg-warning/10">
              <Radio className="w-4 h-4 text-warning" />
              <span className="text-xs font-bold uppercase tracking-wider text-warning">
                {t.scenarioActive} — simulated values
              </span>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-warning/20">
              {DRILL_READINGS[activeScenario].map((r) => (
                <div key={r.label} className="bg-background px-4 py-3">
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {r.label}
                  </dt>
                  <dd className="text-lg font-bold font-mono text-warning mt-0.5">{r.value}</dd>
                </div>
              ))}
            </dl>
          </motion.div>
        )}
      </motion.div>
    </section>
  );
}
