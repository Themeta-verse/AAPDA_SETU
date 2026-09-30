import { type Language, translations } from '@/lib/translations';

interface RiskLegendProps {
  language: Language;
}

export function RiskLegend({ language }: RiskLegendProps) {
  const t = translations[language];

  const levels = [
    { color: 'bg-safe', border: 'border-safe/30', label: t.safe, desc: t.riskSafeDesc },
    { color: 'bg-warning', border: 'border-warning/30', label: t.moderate, desc: t.riskModerateDesc },
    { color: 'bg-danger', border: 'border-danger/30', label: t.critical, desc: t.riskCriticalDesc },
  ];

  return (
    <div className="glass-card rounded-xl p-4 border-border">
      <h3 className="text-sm font-semibold mb-3">{t.riskLegend}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {levels.map((l, i) => (
          <div key={i} className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${l.border} bg-card/50`}>
            <div className={`w-3 h-3 rounded-full ${l.color} flex-shrink-0 mt-0.5`} />
            <div>
              <p className="text-xs font-semibold">{l.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{l.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
