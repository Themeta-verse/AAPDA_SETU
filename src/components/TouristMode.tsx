import { motion } from 'framer-motion';
import { Eye, MapPin, Globe, Shield, Volume2, ArrowUpFromLine, Phone } from 'lucide-react';
import { type Language, translations, voiceAlertTexts, speakAlert, stopSpeaking } from '@/lib/translations';
import { useState } from 'react';

interface TouristModeProps {
  language: Language;
}

export function TouristMode({ language }: TouristModeProps) {
  const t = translations[language];
  const [speaking, setSpeaking] = useState(false);

  const tips = [
    { icon: Eye, text: t.step1, color: 'text-danger', bg: 'bg-danger/10 border-danger/20' },
    { icon: MapPin, text: t.step2, color: 'text-primary', bg: 'bg-primary/10 border-primary/20' },
    { icon: ArrowUpFromLine, text: t.step3, color: 'text-safe', bg: 'bg-safe/10 border-safe/20' },
    { icon: Phone, text: t.step4, color: 'text-warning', bg: 'bg-warning/10 border-warning/20' },
  ];

  const handleVoice = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    const text = voiceAlertTexts[language].highTide;
    if (text) {
      setSpeaking(true);
      speakAlert(text, language, () => setSpeaking(false));
    }
  };

  return (
    <section className="container py-8">
      <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <Globe className="w-6 h-6 text-ocean" />
        {t.touristMode}
      </h2>
      <p className="text-muted-foreground mb-6 text-sm">{t.touristDesc}</p>

      <div className="glass-card rounded-2xl overflow-hidden border-ocean/20">
        {/* Header */}
        <div className="p-4 border-b border-border bg-ocean/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-ocean" />
              <span className="font-bold text-sm uppercase tracking-wider">Tourist Safety Guide</span>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleVoice}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                speaking
                  ? 'bg-danger/15 text-danger border border-danger/30'
                  : 'bg-primary/15 text-primary border border-primary/30'
              }`}
            >
              <Volume2 className={`w-3.5 h-3.5 ${speaking ? 'animate-pulse' : ''}`} />
              {speaking ? t.stopVoiceAlert : t.playVoiceAlert}
            </motion.button>
          </div>
        </div>

        {/* Steps */}
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tips.map((tip, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={`flex items-start gap-3 p-4 rounded-xl border ${tip.bg}`}
            >
              <div className={`p-2 rounded-lg bg-card/60 ${tip.color}`}>
                <tip.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.step} {i + 1}</p>
                <p className="text-sm font-medium mt-1">{tip.text}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
