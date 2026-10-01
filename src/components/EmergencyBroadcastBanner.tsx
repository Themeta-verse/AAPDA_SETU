import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, X, Siren, Radio, MapPin } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import { type RiskLevelOrUnknown } from '@/lib/monitoringData';

interface EmergencyBroadcastBannerProps {
  language: Language;
  /**
   * Presentation tier of the canonical risk verdict, or `null` when no verdict
   * could be reached. The banner must never treat `null` as a critical state.
   */
  riskLevel: RiskLevelOrUnknown;
  /**
   * True only when an official IMD or INCOIS bulletin was actually READ and
   * reported an active warning. This is the single condition under which this
   * application may use authority language such as "evacuation ordered".
   */
  officialWarningActive: boolean | null;
  /** Short factual reason for the current state, from the risk engine. */
  reason: string | null;
  /** Where the monitoring point is. */
  locationLabel: string;
}

const LABELS: Record<Language, {
  modelCritical: string;
  officialWarning: string;
  notAnOrder: string;
  unverified: string;
}> = {
  en: {
    modelCritical: 'HIGH-RISK COASTAL CONDITIONS',
    officialWarning: 'OFFICIAL WARNING IN FORCE',
    notAnOrder:
      'This is a model-derived reading from published measurements. It is not an evacuation order. Follow NDMA and municipal instructions.',
    unverified:
      'Official IMD and INCOIS bulletins could not be read, so whether an authority has issued an advisory is unknown.',
  },
  hi: {
    modelCritical: 'उच्च-जोखिम तटीय स्थितियां',
    officialWarning: 'आधिकारिक चेतावनी लागू',
    notAnOrder:
      'यह प्रकाशित मापों से प्राप्त मॉडल-आधारित स्थिति है। यह निकासी आदेश नहीं है। एनडीएमए और नगरपालिका के निर्देशों का पालन करें।',
    unverified:
      'आधिकारिक IMD और INCOIS बुलेटिन पढ़े नहीं जा सके, इसलिए क्या कोई चेतावनी जारी है यह अज्ञात है।',
  },
  mr: {
    modelCritical: 'उच्च-जोखीम किनारी परिस्थिती',
    officialWarning: 'अधिकृत इशारा लागू',
    notAnOrder:
      'हे प्रकाशित मापांवरून मिळालेले मॉडेलवर आधारित नोंद आहे. हे निर्वासन आदेश नाही. एनडीएमए व नगरपालिकेच्या सूचनांचे पालन करा.',
    unverified:
      'अधिकृत IMD व INCOIS तपशील वाचता आले नाहीत, त्यामुळे इशारा जारी आहे का हे अज्ञात आहे.',
  },
  gu: {
    modelCritical: 'ઉચ્ચ-જોખમ દરિયાકિનારી સ્થિતિ',
    officialWarning: 'અધિકૃત ચેતવણી લાગુ',
    notAnOrder:
      'આ પ્રકાશિત માપદાંશોમાંથી મળેલી મોડેલ-આધારિત સ્થિતિ છે. આ સ્થળાંતર આદેશ નથી. NDMA અને નગરપાલિકાની સૂચનોનું પાલન કરો.',
    unverified:
      'અધિકૃત IMD અને INCOIS બુલેટિન વાંચી શકાયા નથી, તેથી ચેતવણી જારી છે કે નહીં તે અજાણ છે.',
  },
};

/**
 * Top-of-page emergency banner.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * This banner previously:
 *   - displayed "Evacuate within 15:00" on a countdown that counted down from a
 *     hard-coded constant. No authority sets a deadline this application can
 *     know about, so the countdown instructed people to evacuate on a timer the
 *     app invented.
 *   - auto-played canned speech ("Emergency. Tsunami risk alert... Evacuate
 *     immediately") whenever it appeared, including when it appeared because a
 *     TRAINING SCENARIO was selected.
 *   - used the word "EMERGENCY ALERT" for a purely model-derived state.
 *
 * Now it:
 *   - only distinguishes model-derived high risk from an authority-issued
 *     warning, and says which one it is;
 *   - states plainly that a model reading is not an evacuation order;
 *   - states that official bulletins are unreadable when that is the case,
 *     rather than implying an all-clear;
 *   - never speaks by itself. Voice is a user action, in one place, driven by
 *     the canonical generator.
 */
export function EmergencyBroadcastBanner({
  language,
  riskLevel,
  officialWarningActive,
  reason,
  locationLabel,
}: EmergencyBroadcastBannerProps) {
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const t = translations[language];
  const labels = LABELS[language];

  const isOfficial = officialWarningActive === true;
  const isCriticalModel = !isOfficial && riskLevel === 'critical';

  if (!isOfficial && !isCriticalModel) return null;

  // Dismissing is scoped to the condition that was dismissed, so a genuinely
  // new and different alert is not silently suppressed by an old dismissal.
  const conditionKey = isOfficial ? `official:${reason ?? 'warning'}` : `model:${riskLevel}`;
  if (dismissedFor === conditionKey) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={conditionKey}
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -100, opacity: 0 }}
        className="fixed top-0 left-0 right-0 z-50"
        role="alert"
        aria-live="assertive"
      >
        <div className="bg-gradient-to-r from-danger via-danger/95 to-danger border-b-2 border-warning/50 shadow-2xl shadow-danger/30">
          <div className="h-1 bg-warning animate-pulse" />

          <div className="container py-3">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 p-2 rounded-xl bg-white/10">
                {isOfficial ? (
                  <Radio className="w-6 h-6 text-white" />
                ) : (
                  <Siren className="w-6 h-6 text-white" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  <span className="text-xs sm:text-sm font-black text-warning uppercase tracking-wider">
                    {isOfficial ? labels.officialWarning : labels.modelCritical}
                  </span>
                </div>

                {reason && (
                  <p className="text-white text-sm font-bold">{reason}</p>
                )}

                <p className="text-white/80 text-xs mt-1">
                  {isOfficial ? (
                    t.step1
                  ) : (
                    labels.notAnOrder
                  )}
                </p>

                {!isOfficial && officialWarningActive === null && (
                  <p className="text-warning/90 text-[11px] mt-1">{labels.unverified}</p>
                )}

                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <span className="text-white/70 text-[11px] flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {locationLabel}
                  </span>
                </div>
              </div>

              <button
                onClick={() => setDismissedFor(conditionKey)}
                className="flex-shrink-0 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white/80 hover:text-white"
                aria-label={t.close ?? 'Dismiss alert'}
              >
                <X className="w-4 h-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
