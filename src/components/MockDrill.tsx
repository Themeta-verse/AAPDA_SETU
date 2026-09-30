import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, RotateCcw, CheckCircle, AlertTriangle, ChevronRight } from 'lucide-react';
import { type Language, translations, voiceAlertTexts, speakAlert } from '@/lib/translations';

interface MockDrillProps {
  language: Language;
}

export function MockDrill({ language }: MockDrillProps) {
  const t = translations[language];
  const [started, setStarted] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [complete, setComplete] = useState(false);

  const steps = [t.drillStep1, t.drillStep2, t.drillStep3, t.drillStep4, t.drillStep5];

  const start = () => {
    setStarted(true);
    setCurrentStep(0);
    setComplete(false);
    speakAlert(voiceAlertTexts[language].tsunami, language);
  };

  const next = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(s => s + 1);
    } else {
      setComplete(true);
    }
  };

  const restart = () => {
    setStarted(false);
    setCurrentStep(0);
    setComplete(false);
  };

  return (
    <section className="container py-8" aria-label="Mock drill simulator">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Play className="w-6 h-6 text-primary" />
        {t.mockDrillTitle}
      </h2>
      <p className="text-muted-foreground mb-6">{t.mockDrillDesc}</p>

      {!started ? (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={start}
          className="flex items-center gap-3 px-6 py-4 rounded-xl bg-warning/20 text-warning border border-warning/30 font-semibold hover:bg-warning/30 transition-colors"
        >
          <AlertTriangle className="w-5 h-5" />
          {t.startMockDrill}
        </motion.button>
      ) : (
        <div className="glass-card p-6 rounded-2xl border-warning/30">
          <div className="flex items-center gap-2 mb-4 text-warning">
            <AlertTriangle className="w-5 h-5 animate-pulse" />
            <span className="font-semibold text-sm">{t.drillScenario}</span>
          </div>

          <div className="space-y-3 mb-6">
            {steps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0.3 }}
                animate={{ opacity: i <= currentStep ? 1 : 0.3 }}
                className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                  i === currentStep && !complete ? 'bg-primary/10 border border-primary/20' :
                  i < currentStep || complete ? 'bg-safe/10' : ''
                }`}
              >
                <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  i < currentStep || complete ? 'bg-safe text-safe-foreground' :
                  i === currentStep ? 'bg-primary text-primary-foreground' :
                  'bg-secondary text-muted-foreground'
                }`}>
                  {i < currentStep || complete ? <CheckCircle className="w-4 h-4" /> : i + 1}
                </span>
                <span className="text-sm pt-1">{step}</span>
              </motion.div>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {complete ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center"
              >
                <p className="text-safe font-semibold mb-4">✅ {t.drillComplete}</p>
                <button onClick={restart} className="flex items-center gap-2 mx-auto px-4 py-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80">
                  <RotateCcw className="w-4 h-4" />
                  {t.restartDrill}
                </button>
              </motion.div>
            ) : (
              <button
                onClick={next}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
              >
                {t.nextStep}
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
