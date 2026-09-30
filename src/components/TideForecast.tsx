import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { type Language, translations } from '@/lib/translations';
import { type MarineHourlyData } from '@/hooks/useWeatherData';

interface TideForecastProps {
  language: Language;
  marineHourly?: MarineHourlyData[];
  tideStatus: 'live' | 'stale' | 'unavailable' | 'offline';
}

export function TideForecast({ language, marineHourly, tideStatus = 'unavailable' }: TideForecastProps) {
  const t = translations[language];

  const data = useMemo(() => {
    if (marineHourly && marineHourly.length > 0) {
      return marineHourly.map((d) => {
        const date = new Date(d.time);
        return {
          hour: `${String(date.getHours()).padStart(2, '0')}:00`,
          tide: d.waveHeight,
        };
      });
    }
    return [];
  }, [marineHourly]);

  const maxTide = data.length > 0 ? Math.max(...data.map(d => d.tide)) : 0;
  const minTide = data.length > 0 ? Math.min(...data.map(d => d.tide)) : 0;

  return (
    <section className="container py-8" aria-label="Tide and wave forecast">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-primary" />
          {t.tideForecastTitle}
          {(tideStatus === 'live' || tideStatus === 'stale') && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-safe/10 border border-safe/20 text-[10px] text-safe font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-safe animate-pulse" />
              LIVE
            </span>
          )}
        </h2>
        <p className="text-muted-foreground mb-6 text-sm">
          {tideStatus === 'live'
            ? 'Real-time wave height data from Open-Meteo Marine API'
            : tideStatus === 'stale'
            ? 'Stale wave height data'
            : 'No wave height data available'}
        </p>

        <div className="glass-card rounded-2xl p-4 sm:p-6 border-primary/20">
          {/* Legend */}
          <div className="flex flex-wrap gap-3 sm:gap-4 mb-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-2 rounded-sm bg-primary/60" />
              <span className="text-muted-foreground">{t.waveHeight}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-2 rounded-sm bg-warning/40" />
              <span className="text-muted-foreground">{t.moderate}</span>
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
                  <linearGradient id="tideFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 20%, 22%)" strokeOpacity={0.5} />
                <ReferenceArea y1={3.5} y2={Math.max(maxTide, 4.5)} fill="hsl(38, 92%, 50%)" fillOpacity={0.08} />
                <ReferenceArea y1={4.0} y2={Math.max(maxTide, 4.5)} fill="hsl(0, 72%, 51%)" fillOpacity={0.1} />
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
                  domain={[Math.floor(minTide * 2) / 2, Math.ceil(maxTide * 2) / 2]}
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
                  labelFormatter={(label) => `${t.tideForecastTitle}: ${label}`}
                />
                <Area
                  type="monotone"
                  dataKey="tide"
                  stroke="hsl(199, 89%, 48%)"
                  strokeWidth={2}
                  fill="url(#tideFill)"
                  dot={false}
                  activeDot={{ r: 4, fill: 'hsl(199, 89%, 48%)', stroke: 'hsl(215, 25%, 14%)', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-4 pt-4 border-t border-border">
            <div className="text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">{t.waveHeight}</p>
              <p className="text-lg sm:text-xl font-bold font-mono text-warning">{maxTide.toFixed(1)}m</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">{t.min}</p>
              <p className="text-lg sm:text-xl font-bold font-mono text-safe">{minTide.toFixed(1)}m</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider"></p>
              <p className="text-lg sm:text-xl font-bold font-mono text-primary">
                {(data.reduce((s, d) => s + d.tide, 0) / data.length).toFixed(1)}m
              </p>
            </div>
          </div>
        </div>

        {/* Data status indicator */}
        {(tideStatus === 'unavailable' || tideStatus === 'offline') && (
          <div className="mt-4 p-3 rounded-xl bg-secondary/30 text-xs text-muted-foreground">
            {tideStatus === 'unavailable'
              ? 'No live wave height data. Check connection or try again later.'
              : 'Offline mode: showing cached data if available'}
          </div>
        )}
      </motion.div>
    </section>
  );
}
