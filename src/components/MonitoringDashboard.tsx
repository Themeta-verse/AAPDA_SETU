import { motion } from 'framer-motion';
import { Waves, Wind, CloudRain, Anchor, Gauge, Thermometer, Compass, Activity, BarChart3, Radio } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import { type MonitoringData, riskColors, statusHasMeasurements } from '@/lib/monitoringData';
import { type NormalizedMarine } from '@/hooks/useWeatherData';
import { type EarthquakeState } from '@/hooks/useEarthquakeData';
import { RiskLegend } from './RiskLegend';

interface MonitoringDashboardProps {
  data: MonitoringData;
  language: Language;
  clock: Date;
  alertIssuedTime?: Date;
  marine?: NormalizedMarine;
  earthquakes?: EarthquakeState;
  locationName?: string;
  isCoastal?: boolean;
}

/**
 * Render a measurement without fabricating a value. `null` becomes an explicit
 * em dash so an unavailable reading never looks like `0`.
 */
function reading(value: number | null, unit = ''): string {
  return value === null ? '—' : `${value}${unit}`;
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

export function MonitoringDashboard({
  data,
  language,
  clock,
  alertIssuedTime,
  marine,
  earthquakes,
  locationName,
  isCoastal = true,
}: MonitoringDashboardProps) {
  const t = translations[language];
  const hasData = statusHasMeasurements(data.status);

  // Gauge raw values are numeric-only; a missing reading contributes no fill
  // rather than a zero that reads as a healthy measurement.
  const gauge = (value: number | null) => (value === null ? 0 : value);

  const metrics = [
    {
      icon: Waves,
      label: t.waveHeight,
      value: isCoastal ? reading(data.waveHeight, 'm') : 'N/A (Inland)',
      raw: isCoastal ? gauge(data.waveHeight) : 0,
      max: 6,
      warn: isCoastal && data.waveHeight !== null && data.waveHeight > 3.5,
      critical: isCoastal && data.waveHeight !== null && data.waveHeight > 4.0,
    },
    {
      icon: Wind,
      label: t.windSpeed,
      value: reading(data.windSpeed, ' km/h'),
      raw: gauge(data.windSpeed),
      max: 60,
      warn: data.windSpeed !== null && data.windSpeed > 20,
      critical: data.windSpeed !== null && data.windSpeed > 30,
    },
    {
      icon: CloudRain,
      label: t.rainProbability,
      value: reading(data.rainProbability, '%'),
      raw: gauge(data.rainProbability),
      max: 100,
      warn: data.rainProbability !== null && data.rainProbability > 60,
      critical: data.rainProbability !== null && data.rainProbability > 80,
    },
    {
      icon: Anchor,
      label: t.seaCondition,
      value: isCoastal ? (data.seaCondition ? t[data.seaCondition] : '—') : 'N/A (Inland)',
      raw: isCoastal
        ? data.seaCondition === 'veryRough'
          ? 90
          : data.seaCondition === 'rough'
            ? 60
            : data.seaCondition === 'calm'
              ? 20
              : 0
        : 0,
      max: 100,
      warn: isCoastal && data.seaCondition === 'rough',
      critical: isCoastal && data.seaCondition === 'veryRough',
    },
    ...(marine
      ? [
          {
            icon: Thermometer,
            label: 'Temperature',
            value: reading(marine.temperature, '°C'),
            raw: gauge(marine.temperature),
            max: 50,
            warn: marine.temperature !== null && marine.temperature > 40,
            critical: marine.temperature !== null && marine.temperature > 45,
          },
          {
            icon: BarChart3,
            label: 'Pressure',
            value: reading(marine.pressure, ' hPa'),
            raw: marine.pressure === null ? 0 : Math.max(0, 1050 - marine.pressure),
            max: 60,
            warn: marine.pressure !== null && marine.pressure < 1005,
            critical: marine.pressure !== null && marine.pressure < 995,
          },
          ...(isCoastal
            ? [
                {
                  icon: Compass,
                  label: 'Wave Dir / Period',
                  value: `${reading(marine.waveDirection, '°')} / ${reading(marine.wavePeriod, 's')}`,
                  raw: gauge(marine.wavePeriod),
                  max: 20,
                  warn: false,
                  critical: false,
                },
              ]
            : []),
        ]
      : []),
  ];

  const riskLabel = data.riskLevel === 'critical' ? t.critical : data.riskLevel === 'high' ? t.high : data.riskLevel === 'moderate' ? t.moderate : t.safe;
  const issuedTime = alertIssuedTime || new Date(clock.getTime() - 25000);

  // Without measurements there is no risk verdict to show. Rendering the
  // placeholder `safe` value as a green all-clear would be a false claim.
  const riskColor = !hasData ? 'hsl(var(--muted-foreground))' : data.riskLevel === 'safe' ? 'hsl(var(--safe))' : data.riskLevel === 'moderate' ? 'hsl(var(--warning))' : 'hsl(var(--danger))';
  const riskTone = !hasData ? 'text-muted-foreground' : data.riskLevel === 'safe' ? 'text-safe' : data.riskLevel === 'moderate' ? 'text-warning' : 'text-danger';
  const statusTone = data.status === 'live' ? 'text-safe' : data.status === 'stale' ? 'text-warning' : 'text-muted-foreground';

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
              <div className={`w-2.5 h-2.5 rounded-full ${data.status === 'live' ? 'bg-safe animate-pulse' : data.status === 'stale' ? 'bg-warning' : 'bg-muted-foreground'}`} />
              <span className="text-muted-foreground uppercase tracking-wider font-semibold">{t.currentStatus}:</span>
              <span className={`font-bold uppercase ${statusTone}`}>{t.systemActive}</span>
            </div>
            <div className="flex items-center gap-2">
              <Radio className="w-3 h-3 text-primary" />
              <span className="text-muted-foreground uppercase tracking-wider font-semibold">{t.location}:</span>
              <span className="font-bold text-foreground">{locationName || t.juhuBeach}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground uppercase tracking-wider font-semibold">{t.riskLevel}:</span>
              <span className={`font-black uppercase tracking-wide ${riskTone}`}>
                {hasData ? riskLabel : 'NO DATA'}
              </span>
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
                  value={hasData ? (data.riskLevel === 'critical' ? 95 : data.riskLevel === 'high' ? 75 : data.riskLevel === 'moderate' ? 50 : 15) : 0}
                  max={100}
                  color={riskColor}
                  size={72}
                />
                <div className={`absolute inset-0 flex items-center justify-center text-xs font-black ${riskTone}`}>
                  {!hasData
                    ? '?'
                    : data.riskLevel === 'critical'
                      ? '!'
                      : data.riskLevel === 'high'
                        ? '!!'
                        : data.riskLevel === 'moderate'
                          ? '~'
                          : '✓'}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{t.riskLevel}</p>
                <p className={`text-2xl font-black ${riskTone}`}>
                  {hasData ? riskLabel : 'NO DATA'}
                </p>
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
                <p className={`text-2xl font-black font-mono ${m.critical ? 'text-danger' : m.warn ? 'text-warning' : hasData ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {m.value}
                </p>
              </motion.div>
            );
          })}
        </div>

        {/* Earthquake Activity — USGS Earthquake Hazards Program feed */}
        {earthquakes && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-6"
          >
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Activity className="w-5 h-5 text-warning" />
                Seismic Activity — Indian Ocean Region
              </h3>
              {earthquakes.status === 'live' && (
                <span className="px-2 py-0.5 rounded-full bg-safe/10 border border-safe/20 text-[10px] text-safe font-medium">LIVE</span>
              )}
              {earthquakes.status === 'stale' && (
                <span className="px-2 py-0.5 rounded-full bg-warning/10 border border-warning/20 text-[10px] text-warning font-medium">STALE</span>
              )}
              {(earthquakes.status === 'unavailable' || earthquakes.status === 'offline') && (
                <span className="px-2 py-0.5 rounded-full bg-secondary border border-border text-[10px] text-muted-foreground font-medium">
                  {earthquakes.status.toUpperCase()}
                </span>
              )}
              {earthquakes.tsunamiFlag === true && (
                <span className="px-2 py-0.5 rounded-full bg-danger/20 border border-danger/30 text-[10px] text-danger font-medium">
                  USGS TSUNAMI FLAG SET
                </span>
              )}
            </div>

            <p className="text-xs text-muted-foreground mb-3">
              Source: {earthquakes.source.label}
              {earthquakes.source.url && (
                <>
                  {' '}
                  —{' '}
                  <a
                    href={earthquakes.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    official real-time GeoJSON feed
                  </a>
                </>
              )}
              {earthquakes.feedGeneratedAt && (
                <span className="ml-2 font-mono">feed generated {new Date(earthquakes.feedGeneratedAt).toLocaleString()}</span>
              )}
            </p>

            {earthquakes.status !== 'live' && earthquakes.status !== 'stale' ? (
              <div className="glass-card rounded-xl p-5 border-border text-center">
                <p className="text-sm font-semibold text-foreground">
                  {earthquakes.status === 'offline' ? 'Offline — no earthquake data' : 'No earthquake data available'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  The USGS feed could not be read. No events are shown rather than estimated ones.
                </p>
                {earthquakes.error && (
                  <p className="text-[10px] font-mono text-muted-foreground/70 mt-2 break-all">
                    {earthquakes.error.kind}: {earthquakes.error.message}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/70 mt-2">
                  Tsunami status: unknown — USGS could not be read
                </p>
              </div>
            ) : earthquakes.events.length === 0 ? (
              <div className="glass-card rounded-xl p-5 border-border text-center">
                <p className="text-sm font-semibold text-foreground">No earthquakes reported in this region in the past 24 hours</p>
                <p className="text-xs text-muted-foreground mt-1">
                  The USGS feed was read successfully — it reported {earthquakes.totalInFeed} event
                  {earthquakes.totalInFeed === 1 ? '' : 's'} worldwide, none inside the monitored
                  region. Tsunami status: none flagged.
                </p>
              </div>
            ) : (
              <>
                <div className="glass-card rounded-xl p-4 border-border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border uppercase tracking-wider">
                        <th className="text-left pb-2 pr-4 font-semibold">Magnitude</th>
                        <th className="text-left pb-2 pr-4 font-semibold">Location</th>
                        <th className="text-left pb-2 pr-4 font-semibold">Time</th>
                        <th className="text-left pb-2 pr-4 font-semibold">Depth</th>
                        <th className="text-left pb-2 font-semibold">Tsunami</th>
                      </tr>
                    </thead>
                    <tbody>
                      {earthquakes.events.slice(0, 5).map((eq) => (
                        <tr key={eq.id} className="border-b border-border/30">
                          <td className={`py-2.5 pr-4 font-mono font-black ${
                            eq.magnitude === null
                              ? 'text-muted-foreground'
                              : eq.magnitude >= 6
                                ? 'text-danger'
                                : eq.magnitude >= 4
                                  ? 'text-warning'
                                  : 'text-foreground'
                          }`}>
                            {eq.magnitude === null ? 'M—' : `M${eq.magnitude.toFixed(1)}`}
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {eq.eventUrl ? (
                              <a href={eq.eventUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary hover:underline">
                                {eq.place ?? '—'}
                              </a>
                            ) : (
                              (eq.place ?? '—')
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground font-mono">
                            {eq.occurredAt ? new Date(eq.occurredAt).toLocaleString() : '—'}
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground font-mono">
                            {eq.depthKm === null ? '—' : `${eq.depthKm.toFixed(1)} km`}
                          </td>
                          <td className="py-2.5 font-mono">
                            {eq.tsunami === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : eq.tsunami ? (
                              <span className="text-danger font-bold">YES</span>
                            ) : (
                              <span className="text-muted-foreground">NO</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {earthquakes.rejectedCount > 0 && (
                  <p className="text-[10px] text-muted-foreground/70 mt-2">
                    {earthquakes.rejectedCount} malformed record
                    {earthquakes.rejectedCount === 1 ? ' was' : 's were'} discarded by validation;
                    the remaining {earthquakes.events.length} event
                    {earthquakes.events.length === 1 ? '' : 's'} shown are real USGS records.
                  </p>
                )}
              </>
            )}
          </motion.div>
        )}
      </motion.div>
    </section>
  );
}
