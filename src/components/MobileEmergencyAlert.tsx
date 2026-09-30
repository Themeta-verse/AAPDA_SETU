import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, ChevronRight } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import { type RiskLevel } from '@/lib/monitoringData';

interface MobileEmergencyAlertProps {
  language: Language;
  riskLevel: RiskLevel;
  onViewAlerts: () => void;
}

export function MobileEmergencyAlert({ language, riskLevel, onViewAlerts }: MobileEmergencyAlertProps) {
  const t = translations[language];
  const [dismissed, setDismissed] = useState(false);

  const isEmergency = riskLevel === 'critical' || riskLevel === 'high';

  if (!isEmergency || dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -100, opacity: 0 }}
        className="md:hidden fixed top-14 left-0 right-0 z-40 p-3"
      >
        <div className={`rounded-xl p-4 border ${
          riskLevel === 'critical' ? 'bg-danger/20 border-danger/40 glow-danger' : 'bg-warning/20 border-warning/40 glow-warning'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1">
              <AlertTriangle className={`w-6 h-6 flex-shrink-0 animate-pulse ${
                riskLevel === 'critical' ? 'text-danger' : 'text-warning'
              }`} />
              <div>
                <p className={`text-sm font-bold ${riskLevel === 'critical' ? 'text-danger' : 'text-warning'}`}>
                  {t.mobileAlertTitle}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {riskLevel === 'critical' ? t.critical : t.high} — {t.juhuBeach}
                </p>
              </div>
            </div>
            <button onClick={() => setDismissed(true)} className="p-1 rounded hover:bg-secondary">
              <X className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={() => { onViewAlerts(); setDismissed(true); }}
            className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
          >
            {t.mobileAlertAction}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
