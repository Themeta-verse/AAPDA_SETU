import { motion } from 'framer-motion';
import { Waves, Wind, CloudRain, Anchor, Gauge, Thermometer, Compass, Activity, BarChart3, Radio } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import { type MonitoringData, riskColors } from '@/lib/monitoringData';
import { type WeatherData } from '@/hooks/useWeatherData';
import { type EarthquakeEvent } from '@/hooks/useEarthquakeData';
import { RiskLegend } from './RiskLegend';

interface MonitoringDashboardProps {
  data: MonitoringData;
  language: Language;
  clock: Date;
  alertIssuedTime?: Date;
  weather?: WeatherData;
  earthquakes?: EarthquakeEvent[];
}

function GaugeRing({ value, max, color, size = 64 }: { value: number; max: number; color: string; size?: number }) {
  const pct = Math.min(value / max, 1);
  const r = (size - 8) / 2;
  const circumference = 2 * Math.PI * r;
  const strokeDashoffset = circumference * (1 - pct);

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="4" />
      <motion.circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color}
        strokeWidth="4" strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
    </svg>
  );
}

export function MonitoringDashboard({ data, language, clock, alertIssuedTime, weather, earthquakes }: MonitoringDashboardProps) {
  const t = translations[language];

  const metrics = [
    { icon: Waves, label: t.tideLevel, value: `${data.tideLevel}m`, raw: data.tideLevel, max: 6, warn: data.tideLevel > 3.5, critical: data.tideLevel > 4.0 },
    { icon: Wind, label: t.windSpeed, value: `${data.windSpeed} km/h`, raw: data.windSpeed, max: 60, warn: data.windSpeed > 20, critical: data.windSpeed > 30 },
    { icon: CloudRain, label: t.rainProbability, value: `${data.rainProbability}%`, raw: data.rainProbability, max: 100, warn: data.rainProbability > 60, critical: data.rainProbability > 80 },
    { icon: Anchor, label: t.seaCondition, value: t[data.seaCondition], raw: data.seaCondition === 'veryRough' ? 90 : data.seaCondition === 'rough' ? 60 : 20, max: 100, warn: data.seaCondition === 'rough', critical: data.seaCondition === 'veryRough' },
    ...(weather ? [
      { icon: Thermometer, label: 'Temperature', value: `${weather.temperature}°C`, raw: weather.temperature, max: 50, warn: weather.temperature > 40, critical: weather.temperature > 45 },
      { icon: BarChart3, label: 'Pressure', value: `${weather.pressure} hPa`, raw: Math.max(0, 1050 - weather.pressure), max: 60, warn: weather.pressure < 1005, critical: weather.pressure < 995 },
      { icon: Compass, label: 'Wave Dir / Period', value: `${weather.waveDirection}° / ${weather.wavePeriod}s`, raw: weather.wavePeriod, max: 20, warn: false, critical: false },
    ] : []),
  ];

  const riskLabel = data.riskLevel === 'critical' ? t.critical : data.riskLevel === 'high' ? t.high : data.riskLevel === 'moderate' ? t.moderate : t.safe;
  const issuedTime = alertIssuedTime || new Date(clock.getTime() - 25000);

  const riskColor = data.riskLevel === 'safe' ? 'hsl(var(--safe))' : data.riskLevel === 'moderate' ? 'hsl(var(--warning))' : 'hsl(var(--danger))';

  return (
    <section id="monitoring" className="container py-8" aria-label="Monitoring dashboard">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <Gauge className="w-6 h-6 text-primary" />
          {t.monitoring}
        </h2>

        {/* Command center status banner */}
        <div className={`glass-card p-5 mb-5 border-2 ${riskColors[data.riskLevel]} rounded-2xl relative overflow-hidden`} aria-live="polite">
          {/* Scanline overlay */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none scanline-bg" />

          {/* Top status bar */}
          <div className="flex flex-wrap gap-3 mb-4 pb-4 border-b border-border/50 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-safe animate-pulse" />
              <span className="text-muted-foreground uppercase tracking-wider font-semibold">{t.currentStatus}:</span>
              <span className="font-bold text-safe">{t.systemActive}</span>
            </div>
            <div className="flex items-center gap-2">
              <Radio className="w-3 h-3 text-primary" />
              <span className="text-muted-foreground uppercase tracking-wider font-semibold">{t.location}:</span>
              <span className="font-bold text-foreground">{t.juhuBeach}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground uppercase tracking-wider font-semibold">{t.riskLevel}:</span>
              <span className={`font-black uppercase tracking-wide ${
                data.riskLevel === 'safe' ? 'text-safe' : data.riskLevel === 'moderate' ? 'text-warning' : 'text-danger'
              }`}>{riskLabel}</span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-muted-foreground uppercase tracking-wider font-semibold">{t.lastUpdated}:</span>
              <span className="font-bold text-primary font-mono">{clock.toLocaleTimeString()}</span>
            </div>
          </div>

          {/* Big risk indicator */}
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                <GaugeRing
                  value={data.riskLevel === 'critical' ? 95 : data.riskLevel === 'high' ? 75 : data.riskLevel === 'moderate' ? 50 : 15}
                  max={100}
                  color={riskColor}
                  size={72}
                />
                <div className={`absolute inset-0 flex items-center justify-center text-xs font-black ${
                  data.riskLevel === 'safe' ? 'text-safe' : data.riskLevel === 'moderate' ? 'text-warning' : 'text-danger'
                }`}>
                  {data.riskLevel === 'critical' ? '!' : data.riskLevel === 'high' ? '!!' : data.riskLevel === 'moderate' ? '~' : '✓'}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{t.riskLevel}</p>
                <p className={`text-2xl font-black ${
                  data.riskLevel === 'safe' ? 'text-safe' : data.riskLevel === 'moderate' ? 'text-warning' : 'text-danger'
                }`}>{riskLabel}</p>
              </div>
            </div>
            <div className="text-right font-mono text-xs text-muted-foreground space-y-1">
              <div>
                <span className="uppercase tracking-wider text-[10px]">{t.alertIssued}</span>
                <p className="text-foreground font-semibold">{issuedTime.toLocaleTimeString()}</p>
              </div>
              <div>
                <p className="text-foreground">{clock.toLocaleDateString()}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Risk Legend */}
        <div className="mb-5">
          <RiskLegend language={language} />
        </div>

        {/* Metric cards with gauge rings */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {metrics.map((m, i) => {
            const gaugeColor = m.critical ? 'hsl(var(--danger))' : m.warn ? 'hsl(var(--warning))' : 'hsl(var(--primary))';
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className={`glass-card p-4 rounded-xl relative overflow-hidden ${
                  m.critical ? 'border-danger/40 glow-danger' : m.warn ? 'border-warning/40 glow-warning' : 'border-border'
                }`}
              >
                {/* Mini gauge in corner */}
                <div className="absolute -top-1 -right-1 opacity-30">
                  <GaugeRing value={typeof m.raw === 'number' ? m.raw : 0} max={m.max} color={gaugeColor} size={48} />
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <div className={`p-1.5 rounded-lg ${m.critical ? 'bg-danger/15' : m.warn ? 'bg-warning/15' : 'bg-primary/15'}`}>
                    <m.icon className={`w-4 h-4 ${m.critical ? 'text-danger' : m.warn ? 'text-warning' : 'text-primary'}`} />
                  </div>
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">{m.label}</span>
                </div>
                <p className={`text-2xl font-black font-mono ${
                  m.critical ? 'text-danger' : m.warn ? 'text-warning' : 'text-foreground'
                }`}>
                  {m.value}
                </p>
              </motion.div>
            );
          })}
        </div>

        {/* Earthquake Activity */}
        {earthquakes && earthquakes.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-6"
          >
            <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
              <Activity className="w-5 h-5 text-warning" />
              Seismic Activity – Indian Ocean Region
            </h3>
            <div className="glass-card rounded-xl p-4 border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border uppercase tracking-wider">
                    <th className="text-left pb-2 pr-4 font-semibold">Magnitude</th>
                    <th className="text-left pb-2 pr-4 font-semibold">Location</th>
                    <th className="text-left pb-2 font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {earthquakes.slice(0, 5).map((eq) => (
                    <tr key={eq.id} className="border-b border-border/30">
                      <td className={`py-2.5 pr-4 font-mono font-black ${
                        eq.magnitude >= 6 ? 'text-danger' : eq.magnitude >= 4 ? 'text-warning' : 'text-foreground'
                      }`}>
                        M{eq.magnitude.toFixed(1)}
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{eq.place}</td>
                      <td className="py-2.5 text-muted-foreground font-mono">{new Date(eq.time).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </motion.div>
    </section>
  );
}
