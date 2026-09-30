import { motion } from 'framer-motion';
import { ShieldCheck, CheckCircle } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';

interface GovernmentGuidelinesProps {
  language: Language;
}

export function GovernmentGuidelines({ language }: GovernmentGuidelinesProps) {
  const t = translations[language];

  const tips = [t.govTip1, t.govTip2, t.govTip3, t.govTip4, t.govTip5, t.govTip6];

  return (
    <section className="container py-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-safe" />
          {t.govGuidelines}
        </h2>
        <p className="text-muted-foreground mb-6 text-sm">{t.govGuidelinesDesc}</p>

        <div className="glass-card rounded-2xl p-6 border-safe/20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {tips.map((tip, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="flex items-start gap-3 p-3 rounded-lg bg-safe/5 border border-safe/10"
              >
                <CheckCircle className="w-5 h-5 text-safe flex-shrink-0 mt-0.5" />
                <span className="text-sm">{tip}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}
