import { Database, Globe, Waves, Cloud, Activity } from 'lucide-react';
import { type Language } from '@/lib/translations';
import { statusHasMeasurements } from '@/lib/monitoringData';
import type { SourceStatus } from '@/integrations/adapters/types';

interface DataSourcesFooterProps {
  language: Language;
  fetchedAt: string | null;
  status: SourceStatus;
}

const labels: Record<Language, { dataSources: string; systemHealth: string; operational: string; degraded: string; dataUpdated: string; ago: string; monitoring: string; active: string }> = {
  en: { dataSources: 'Data Sources', systemHealth: 'System Health', operational: 'Operational', degraded: 'Degraded', dataUpdated: 'Data Updated', ago: 'ago', monitoring: 'Monitoring Status', active: 'Active' },
  hi: { dataSources: 'डेटा स्रोत', systemHealth: 'सिस्टम स्वास्थ्य', operational: 'चालू', degraded: 'अवनत', dataUpdated: 'डेटा अपडेट', ago: 'पहले', monitoring: 'निगरानी स्थिति', active: 'सक्रिय' },
  mr: { dataSources: 'डेटा स्रोत', systemHealth: 'सिस्टम आरोग्य', operational: 'कार्यरत', degraded: 'अवनत', dataUpdated: 'डेटा अपडेट', ago: 'पूर्वी', monitoring: 'निरीक्षण स्थिती', active: 'सक्रिय' },
  gu: { dataSources: 'ડેટા સ્ત્રોત', systemHealth: 'સિસ્ટમ આરોગ્ય', operational: 'કાર્યરત', degraded: 'અવનત', dataUpdated: 'ડેટા અપડેટ', ago: 'પહેલાં', monitoring: 'મોનિટરિંગ સ્ટેટસ', active: 'સક્રિય' },
};

function timeAgo(fetchedAt: string | null): string {
  if (!fetchedAt) return '—';
  const parsed = new Date(fetchedAt).getTime();
  if (Number.isNaN(parsed)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

export function DataSourcesFooter({ language, fetchedAt, status }: DataSourcesFooterProps) {
  const l = labels[language];
  const healthy = status === 'live';
  const usable = statusHasMeasurements(status);

  const sources = [
    { name: 'Open-Meteo', desc: 'Weather & Forecast', icon: Cloud, connected: true },
    { name: 'Open-Meteo Marine', desc: 'Wave Height', icon: Waves, connected: true },
    { name: 'USGS', desc: 'Earthquake Feed', icon: Activity, connected: true },
    // Not yet integrated. Listed as pending so the dashboard does not imply
    // an authority we are not actually reading.
    { name: 'INCOIS', desc: 'Not integrated', icon: Globe, connected: false },
    { name: 'IMD', desc: 'Not integrated', icon: Activity, connected: false },
  ];

  return (
    <section className="container py-6">
      <div className="glass-card rounded-xl p-4 sm:p-5">
        {/* Status panel */}
        <div className="flex flex-wrap gap-4 mb-4 pb-4 border-b border-border/50 text-xs">
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${healthy ? 'bg-safe animate-pulse' : usable ? 'bg-warning' : 'bg-muted-foreground'}`} />
            <span className="text-muted-foreground">{l.monitoring}:</span>
            <span className="font-semibold text-foreground uppercase">{status}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{l.dataUpdated}:</span>
            <span className="font-semibold text-primary font-mono">{timeAgo(fetchedAt)} {l.ago}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{l.systemHealth}:</span>
            <span className={`font-semibold ${healthy ? 'text-safe' : usable ? 'text-warning' : 'text-muted-foreground'}`}>
              {healthy ? l.operational : l.degraded}
            </span>
          </div>
        </div>

        {/* Data sources */}
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">{l.dataSources}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {sources.map((s) => (
            <div key={s.name} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50 text-xs">
              <s.icon className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <div>
                <p className={`font-medium ${s.connected ? 'text-foreground' : 'text-muted-foreground'}`}>{s.name}</p>
                <p className="text-muted-foreground text-[10px]">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
