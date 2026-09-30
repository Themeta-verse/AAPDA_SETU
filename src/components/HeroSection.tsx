import { motion } from 'framer-motion';
import { Shield, MapPin, Activity, AlertTriangle, Radio, Wifi, Radar, Signal } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import { type RiskLevel } from '@/lib/monitoringData';

interface HeroSectionProps {
  language: Language;
  riskLevel: RiskLevel;
  clock: Date;
  onViewAlerts: () => void;
  isSimulation?: boolean;
}

export function HeroSection({ language, riskLevel, clock, onViewAlerts, isSimulation }: HeroSectionProps) {
  const t = translations[language];
  const riskKey = riskLevel === 'critical' ? 'critical' : riskLevel === 'high' ? 'high' : riskLevel === 'moderate' ? 'moderate' : 'safe';
  const riskLabel = t[riskKey];

  const statusColor = riskLevel === 'safe' ? 'bg-safe' : riskLevel === 'moderate' ? 'bg-warning' : 'bg-danger';
  const statusBorder = riskLevel === 'safe' ? 'border-safe/30' : riskLevel === 'moderate' ? 'border-warning/30' : 'border-danger/30';
  const riskTextColor = riskLevel === 'critical' ? 'text-danger' : riskLevel === 'high' ? 'text-danger' : riskLevel === 'moderate' ? 'text-warning' : 'text-safe';

  return (
    <section className="relative overflow-hidden min-h-[480px]">
      {/* Radar sweep background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/8 via-ocean/5 to-transparent" />

        {/* Radar circles */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          {[300, 500, 700].map((size, i) => (
            <motion.div
              key={size}
              className="absolute rounded-full border border-primary/10"
              style={{
                width: size, height: size,
                left: -size / 2, top: -size / 2,
              }}
              initial={{ opacity: 0.1 }}
              animate={{ opacity: [0.05, 0.15, 0.05] }}
              transition={{ duration: 4, delay: i * 0.8, repeat: Infinity }}
            />
          ))}
          {/* Radar sweep line */}
          <motion.div
            className="absolute w-[350px] h-[1px] origin-left"
            style={{ left: 0, top: 0, background: 'linear-gradient(90deg, hsl(var(--primary) / 0.4), transparent)' }}
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          />
        </div>

        {/* Wave layers */}
        <svg className="absolute bottom-0 left-0 w-[200%] h-40 ocean-wave-1 opacity-[0.07]" viewBox="0 0 1440 120" preserveAspectRatio="none">
          <path d="M0,40 C360,100 720,0 1080,60 C1260,90 1380,30 1440,50 L1440,120 L0,120Z" fill="hsl(var(--primary))" />
        </svg>
        <svg className="absolute bottom-0 left-0 w-[200%] h-32 ocean-wave-2 opacity-[0.05]" viewBox="0 0 1440 120" preserveAspectRatio="none">
          <path d="M0,80 C240,20 480,100 720,50 C960,0 1200,80 1440,40 L1440,120 L0,120Z" fill="hsl(var(--ocean-light))" />
        </svg>

        {/* Ambient glow */}
        <div className="absolute w-[500px] h-[500px] -top-40 -left-40 rounded-full bg-primary/10 blur-3xl animate-pulse" />
        <div className="absolute w-[400px] h-[400px] -bottom-20 -right-20 rounded-full bg-ocean/10 blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="container relative pt-10 pb-14">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto"
        >
          {/* Authority status bar */}
          <div className="flex items-center justify-center gap-2 sm:gap-3 mb-8 flex-wrap">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${statusBorder} bg-card/60 backdrop-blur-sm`}>
              <div className={`w-2.5 h-2.5 rounded-full ${statusColor} animate-pulse`} />
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">{t.systemActive}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5 backdrop-blur-sm">
              <Radar className="w-3.5 h-3.5 text-primary animate-spin" style={{ animationDuration: '4s' }} />
              <span className="text-xs font-mono text-primary font-semibold">{t.liveMonitoring}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card/60 backdrop-blur-sm">
              <Signal className="w-3.5 h-3.5 text-safe" />
              <span className="text-xs text-muted-foreground font-medium">{t.monitoringMode}: LIVE</span>
            </div>
            {isSimulation && (
              <motion.div
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-danger/50 bg-danger/15"
              >
                <Radio className="w-3.5 h-3.5 text-danger" />
                <span className="text-xs font-bold uppercase text-danger">{t.scenarioActive}</span>
              </motion.div>
            )}
          </div>

          {/* Title block */}
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-primary/15 border border-primary/25">
              <Shield className="w-8 h-8 sm:w-10 sm:h-10 text-primary" />
            </div>
            <div className="text-left">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-foreground">
                {t.title}
              </h1>
              <p className="text-sm sm:text-base font-semibold text-primary/80 tracking-wide">{t.subtitle}</p>
            </div>
          </div>
          <p className="text-muted-foreground text-xs sm:text-sm md:text-base mb-8 max-w-2xl mx-auto px-4">{t.tagline}</p>

          {/* Live stats strip */}
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 mb-8">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              <span className="text-xs sm:text-sm font-medium text-foreground">{t.juhuBeach}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-card/60 border border-border">
              <span className="text-xs sm:text-sm font-mono text-primary">{clock.toLocaleTimeString()}</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border-2 ${statusBorder} ${
              riskLevel === 'critical' ? 'bg-danger/15 animate-pulse' : riskLevel === 'high' ? 'bg-danger/10' : riskLevel === 'moderate' ? 'bg-warning/10' : 'bg-safe/10'
            }`}>
              <AlertTriangle className={`w-4 h-4 ${riskTextColor}`} />
              <span className={`text-xs sm:text-sm font-bold uppercase tracking-wide ${riskTextColor}`}>{riskLabel}</span>
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onViewAlerts}
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm uppercase tracking-wider hover:bg-primary/90 transition-all shadow-lg shadow-primary/25"
          >
            <AlertTriangle className="w-4 h-4" />
            {t.viewAlerts}
          </motion.button>
        </motion.div>
      </div>
    </section>
  );
}
