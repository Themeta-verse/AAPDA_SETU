import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Waves, WifiOff } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { type Language, translations } from '@/lib/translations';
import { statusHasMeasurements } from '@/lib/monitoringData';
import type { NormalizedMarine } from '@/hooks/useWeatherData';

interface TideForecastProps {
  language: Language;
  marine: NormalizedMarine;
  isCoastal?: boolean;
  locationName?: string;
}

const STATUS_TEXT = {
  live: 'Live marine data — Open-Meteo Marine',
  stale: 'Stale marine data — last successful read is over 5 minutes old',
  unavailable: 'No marine data available',
  offline: 'Offline — showing the last received marine reading',
} as const;

function formatHour(iso: string): string {
  // Source timestamps are `YYYY-MM-DDTHH:mm` in the source timezone with no
  // offset, so we slice rather than parse (parsing would shift them to UTC).
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(iso);
  return match ? `${match[2]}:${match[3]}` : iso;
}

export function TideForecast({ language, marine, isCoastal = true, locationName }: TideForecastProps) {
  const t = translations[language];
  const { status } = marine;

  if (!isCoastal) {
    return (
      <section className="container py-8" aria-label="Marine wave forecast">
        <div className="glass-card rounded-2xl p-6 border-border">
          <div className="flex flex-col items-center justify-center text-center gap-2 py-4">
            <Waves className="w-8 h-8 text-muted-foreground/40" />
            <h3 className="text-base font-bold text-foreground">
              Marine & Wave Monitoring — Not Applicable (Inland Zone)
            </h3>
            <p className="text-xs text-muted-foreground max-w-lg">
              Sea state, wave height, and tide forecasts are specific to coastal zones. For {locationName || 'inland urban areas'}, the platform actively monitors heavy precipitation, storm winds, urban waterlogging, and seismic hazards.
            </p>
            <span className="mt-2 px-2.5 py-0.5 rounded-full bg-secondary text-[10px] text-muted-foreground font-mono">
              STATUS: NOT APPLICABLE (INLAND)
            </span>
          </div>
        </div>
      </section>
    );
  }

  const data = useMemo(
    () =>
      marine.hourly.map((point) => ({
        hour: formatHour(point.time),
        waveHeight: point.waveHeight,
      })),
    [marine.hourly]
  );

  const heights = data.map((d) => d.waveHeight);
  const maxWave = heights.length ? Math.max(...heights) : null;
  const minWave = heights.length ? Math.min(...heights) : null;
  const avgWave = heights.length
    ? heights.reduce((sum, h) => sum + h, 0) / heights.length
    : null;

  // The chart renders only when freshness says we may present readings AND
  // the source actually sent a wave series. Either missing means no chart.
  const hasChart = data.length > 0 && statusHasMeasurements(status);

  return (
    <section className="container py-8" aria-label="Marine wave forecast">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Waves className="w-6 h-6 text-primary" />
          {t.waveForecastTitle}
          {status === 'live' && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-safe/10 border border-safe/20 text-[10px] text-safe font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-safe animate-pulse" />
              LIVE
            </span>
          )}
          {status === 'stale' && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-warning/10 border border-warning/20 text-[10px] text-warning font-medium">
              STALE
            </span>
          )}
          {(status === 'unavailable' || status === 'offline') && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-secondary border border-border text-[10px] text-muted-foreground font-medium flex items-center gap-1">
              {status === 'offline' && <WifiOff className="w-3 h-3" />}
              {status === 'offline' ? 'OFFLINE' : 'UNAVAILABLE'}
            </span>
          )}
        </h2>
        <p className="text-muted-foreground mb-6 text-sm">{STATUS_TEXT[status]}</p>

        {hasChart ? (
          <>
            <div className="glass-card rounded-2xl p-4 sm:p-6 border-primary/20">
              {/* Legend */}
              <div className="flex flex-wrap gap-3 sm:gap-4 mb-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-2 rounded-sm bg-primary/60" />
                  <span className="text-muted-foreground">{t.waveHeight}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-2 rounded-sm bg-warning/40" />
                  <span className="text-muted-foreground">{t.waveForecastHigh}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-2 rounded-sm bg-danger/40" />
                  <span className="text-muted-foreground">{t.critical}</span>
                </div>
              </div>

              {/* Chart */}
              <div className="w-full h-[220px] sm:h-[280px] md:h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="waveFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 20%, 22%)" strokeOpacity={0.5} />
                    <ReferenceArea y1={3.5} y2={Math.max(maxWave ?? 0, 4.5)} fill="hsl(38, 92%, 50%)" fillOpacity={0.08} />
                    <ReferenceArea y1={4.0} y2={Math.max(maxWave ?? 0, 4.5)} fill="hsl(0, 72%, 51%)" fillOpacity={0.1} />
                    <ReferenceLine y={3.5} stroke="hsl(38, 92%, 50%)" strokeDasharray="4 4" strokeOpacity={0.7} label={{ value: '3.5m', position: 'right', fill: 'hsl(38, 92%, 50%)', fontSize: 10 }} />
                    <ReferenceLine y={4.0} stroke="hsl(0, 72%, 51%)" strokeDasharray="4 4" strokeOpacity={0.7} label={{ value: '4.0m', position: 'right', fill: 'hsl(0, 72%, 51%)', fontSize: 10 }} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fill: 'hsl(215, 15%, 55%)', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fill: 'hsl(215, 15%, 55%)', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      domain={[
                        Math.floor((minWave ?? 0) * 2) / 2,
                        Math.ceil((maxWave ?? 1) * 2) / 2,
                      ]}
                      unit="m"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(215, 25%, 14%)',
                        border: '1px solid hsl(215, 20%, 22%)',
                        borderRadius: '0.75rem',
                        fontSize: '12px',
                        color: 'hsl(210, 40%, 96%)',
                      }}
                      formatter={(value: number) => [`${value}m`, t.waveHeight]}
                      labelFormatter={(label) => `${t.waveForecastTitle}: ${label}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="waveHeight"
                      name={t.waveHeight}
                      stroke="hsl(199, 89%, 48%)"
                      strokeWidth={2}
                      fill="url(#waveFill)"
                      dot={false}
                      activeDot={{ r: 4, fill: 'hsl(199, 89%, 48%)', stroke: 'hsl(215, 25%, 14%)', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-4 pt-4 border-t border-border">
                <div className="text-center">
                  <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">{t.waveForecastHigh}</p>
                  <p className="text-lg sm:text-xl font-bold font-mono text-warning">{maxWave?.toFixed(1)}m</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">{t.waveForecastLow}</p>
                  <p className="text-lg sm:text-xl font-bold font-mono text-safe">{minWave?.toFixed(1)}m</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">{t.waveForecastAvg}</p>
                  <p className="text-lg sm:text-xl font-bold font-mono text-primary">
                    {avgWave?.toFixed(1)}m
                  </p>
                </div>
              </div>
            </div>

            {status === 'stale' && (
              <div className="mt-4 p-3 rounded-xl bg-warning/10 border border-warning/20 text-xs text-warning">
                These wave heights are from an earlier successful read and may no longer reflect current conditions.
              </div>
            )}
          </>
        ) : (
          <div className="glass-card rounded-2xl p-8 border-border">
            <div className="flex flex-col items-center justify-center text-center gap-3 py-8">
              <Waves className="w-10 h-10 text-muted-foreground/50" />
              <p className="text-sm font-semibold text-foreground">
                {status === 'offline' ? 'Offline — no marine data' : 'No marine wave data available'}
              </p>
              <p className="text-xs text-muted-foreground max-w-md">
                {status === 'offline'
                  ? 'This device reports no network connection. Marine readings cannot be fetched until connectivity returns.'
                  : 'The Open-Meteo Marine source did not return usable wave measurements. No values are shown rather than estimated ones. Retry shortly.'}
              </p>
              {marine.error && (
                <p className="text-[10px] font-mono text-muted-foreground/70 break-all max-w-md">
                  {marine.error.kind}: {marine.error.message}
                </p>
              )}
            </div>
          </div>
        )}

        {marine.fetchedAt && (
          <p className="mt-3 text-[10px] font-mono text-muted-foreground/70">
            Last read: {marine.fetchedAt}
          </p>
        )}
      </motion.div>
    </section>
  );
}