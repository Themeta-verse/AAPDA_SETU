import { motion } from 'framer-motion';
import { Phone, Siren, Cross, ShieldAlert } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';

interface EmergencyContactsProps {
  language: Language;
}

export function EmergencyContacts({ language }: EmergencyContactsProps) {
  const t = translations[language];

  const contacts = [
    { label: t.police, number: '100', icon: Siren, bg: 'bg-primary/10 border-primary/30', iconColor: 'text-primary' },
    { label: t.ambulance, number: '108', icon: Cross, bg: 'bg-danger/10 border-danger/30', iconColor: 'text-danger' },
    { label: t.disasterHelpline, number: '112', icon: Phone, bg: 'bg-warning/10 border-warning/30', iconColor: 'text-warning' },
  ];

  return (
    <section className="container py-8" aria-label="Emergency contacts">
      <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <ShieldAlert className="w-6 h-6 text-danger" />
        {t.emergencyContacts}
      </h2>
      <p className="text-muted-foreground text-sm mb-6">Tap to call. Available 24/7 for emergencies.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {contacts.map((c, i) => (
          <motion.a
            key={i}
            href={`tel:${c.number}`}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`glass-card p-5 rounded-xl flex items-center gap-4 border-2 ${c.bg} transition-all group`}
            aria-label={`Call ${c.label}: ${c.number}`}
          >
            <div className={`p-3.5 rounded-xl bg-card/60 ${c.iconColor}`}>
              <c.icon className="w-7 h-7" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{c.label}</p>
              <p className="text-3xl font-black font-mono group-hover:text-primary transition-colors">{c.number}</p>
            </div>
          </motion.a>
        ))}
      </div>
    </section>
  );
}
