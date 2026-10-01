import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Waves, WifiOff } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { type Language, translations } from '@/lib/translations';
import { statusHasMeasurements } from '@/lib/monitoringData';
import { formatForecastHourLabel, formatInstantInSourceTimezone } from '@/lib/sourceTime';
import { LIVE_MAX_AGE_MS, STALE_MAX_AGE_MS } from '@/integrations/adapters/freshness';
import type { NormalizedMarine } from '@/hooks/useWeatherData';

interface WaveForecastProps {
  language: Language;
  marine: NormalizedMarine;
}

/**
 * Status copy. STALE explicitly cites the real threshold rather than claiming
 * "over 5 minutes", which is the LIVE window and not the STALE one.
 */
const STATUS_TEXT = {
  live: 'Live wave data — Open-Meteo Marine',
  stale: `Stale wave data — last successful read is over ${Math.round(LIVE_MAX_AGE_MS / 60000)} minutes old`,
  unavailable: 'No wave data available',
  offline: 'Offline — showing the last received wave reading',
} as const;

export function WaveForecast({ language, marine }: WaveForecastProps) {
  const t = translations[language];
  const { status } = marine;

  const data = useMemo(
    () =>
      marine.hourly.map((point) => ({
        hour: formatForecastHourLabel(point.time),
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

  /**
   * Render one statistic.
   *
   * A null statistic renders an explicit em dash and muted styling. The previous
   * `${maxWave?.toFixed(1)}m` produced the bare string "m" for a null value —
   * a coloured, green "Min  m" tile that reads as a real measurement.
   */
  const stat = (value: number | null) =>
    value === null ? (
      <span className="text-muted-foreground" title="Source did not publish this value">
        —
      </span>
    ) : (
      `${value.toFixed(1)}m`
    );

  // The chart renders only when freshness says we may present readings AND
  // the source actually sent a wave series. Either missing means no chart.
  const hasChart = data.length > 0 && statusHasMeasurements(status);

  // Keep the reference bands above the data and above the HIGH threshold even
  // when the observed maximum is well below it, so the bands stay meaningful.
  const chartTop = Math.max(maxWave ?? 0, 4.5);
  const yDomain: [number, number] = [
    Math.max(0, Math.floor((minWave ?? 0) * 2) / 2),
    Math.ceil(chartTop * 2) / 2,
  ];

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
                    <ReferenceArea y1={3.5} y2={chartTop} fill="hsl(38, 92%, 50%)" fillOpacity={0.08} />
                    <ReferenceArea y1={4.0} y2={chartTop} fill="hsl(0, 72%, 51%)" fillOpacity={0.1} />
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
                      domain={yDomain}
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
                  <p className="text-lg sm:text-xl font-bold font-mono text-warning">{stat(maxWave)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">{t.waveForecastLow}</p>
                  <p className="text-lg sm:text-xl font-bold font-mono text-safe">{stat(minWave)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">{t.waveForecastAvg}</p>
                  <p className="text-lg sm:text-xl font-bold font-mono text-primary">
                    {stat(avgWave)}
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
                {status === 'offline' ? 'Offline — no wave data' : 'No wave data available'}
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
            Last read: {formatInstantInSourceTimezone(marine.fetchedAt)} IST
          </p>
        )}
      </motion.div>
    </section>
  );
}