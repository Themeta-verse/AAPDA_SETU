import { useState, useRef, useMemo } from 'react';
import { type Language } from '@/lib/translations';
import { useMonitoring } from '@/hooks/useMonitoring';
import { CoastalIntelligenceProvider } from '@/hooks/CoastalIntelligenceProvider';
import { useAuth } from '@/hooks/useAuth';
import { getAlerts } from '@/lib/monitoringData';
import { LanguageSelector } from '@/components/LanguageSelector';
import { ThemeToggle } from '@/components/ThemeToggle';
import { HeroSection } from '@/components/HeroSection';
import { MonitoringDashboard } from '@/components/MonitoringDashboard';
import { AlertCardsSection } from '@/components/AlertCardsSection';
import { MockDrill } from '@/components/MockDrill';
import { ScenarioSimulation, type ScenarioType } from '@/components/ScenarioSimulation';
import { EvacuationMap } from '@/components/EvacuationMap';
import { GovernmentGuidelines } from '@/components/GovernmentGuidelines';
import { EmergencyContacts } from '@/components/EmergencyContacts';
import { Chatbot } from '@/components/Chatbot';
import { TouristMode } from '@/components/TouristMode';
import { MobileEmergencyAlert } from '@/components/MobileEmergencyAlert';
import { WaveForecast } from '@/components/WaveForecast';
import { EmergencyBroadcastBanner } from '@/components/EmergencyBroadcastBanner';
import { LocationTracker } from '@/components/LocationTracker';
import { CitizenReporting } from '@/components/CitizenReporting';
import { IncidentIntelligence } from '@/components/IncidentIntelligence';
import { CoastalCommandCenter } from '@/components/CoastalCommandCenter';
import { DataSourcesFooter } from '@/components/DataSourcesFooter';
import { LogOut, User } from 'lucide-react';

/**
 * Page composition.
 *
 * SECTION ORDER IS DELIBERATE
 * ---------------------------
 * The page is ordered by what a user needs first when they are worried, not by
 * when each component happened to be written. The order is:
 *
 *   1. current state          banner + hero, one unambiguous verdict
 *   2. official warnings      can an authority be issuing something?
 *   3. live conditions        what the instruments are actually reading
 *   4. forecast               what is expected over the next 48 hours
 *   5. risk drivers / alerts  why the verdict is what it is
 *   6. drill + scenario       practice, clearly marked as simulation
 *   7. reporting + response   contribute, route, reach a human
 *   8. guidance               what to actually do about it
 *   9. provenance             where every number came from
 *
 * Previously this was 22 undifferentiated sections stacked in import order, so
 * the authoritative risk verdict appeared below eight unrelated panels.
 *
 * SCENARIO HANDLING
 * -----------------
 * `ScenarioSimulation` renders its own overlay and no longer injects synthetic
 * readings. Nothing else here is fed a fabricated `MonitoringData`, so a drill
 * cannot contaminate the live verdict on this page.
 */
const Index = () => {
  // The provider MUST wrap the content: `useMonitoring` (and everything below)
  // reads the single shared pipeline via `useSharedCoastalIntelligence`, which
  // throws outside a provider. Calling the hook in this outer component would
  // run before any provider exists in the tree and crash every signed-in load.
  return (
    <CoastalIntelligenceProvider>
      <IndexContent />
    </CoastalIntelligenceProvider>
  );
};

const IndexContent = () => {
  const [language, setLanguage] = useState<Language>('en');
  const {
    data,
    alerts,
    clock,
    marine,
    earthquakes,
    sourceStatus,
    tsunamiRisk,
    assessment,
  } = useMonitoring(8000);
  const { user, signOut } = useAuth();
  const alertsRef = useRef<HTMLDivElement>(null);
  const [activeScenario, setActiveScenario] = useState<ScenarioType>(null);

  const scrollToAlerts = () => {
    alertsRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // The USGS tsunami flag is authoritative and tri-state. Passing it through
  // unchanged is what keeps the alert cards from inferring a tsunami out of
  // wave height and wind.
  const alertsWithTsunami = getAlerts(data, tsunamiRisk);

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'User';
  const isSimulation = activeScenario !== null;

  // The banner states the single dimension that drove the verdict, rather than a
  // synthesised sentence. Null when nothing resolved, so the banner falls back to
  // its own unknown-state wording instead of inventing a cause.
  const drivingReason = useMemo(() => {
    const order: Record<string, number> = { severe: 3, high: 2, elevated: 1 };
    const resolved = Object.values(assessment.dimensions)
      .filter((d) => order[d.state] !== undefined)
      .sort((a, b) => order[b.state] - order[a.state]);
    const top = resolved[0];
    if (!top) return null;
    // `basis` is the rule's own factual statement of what it inspected.
    return top.triggered[0]?.basis ?? top.label;
  }, [assessment]);

  return (
      <div className="min-h-screen bg-background" role="main">
      {/* 1. CURRENT STATE ------------------------------------------------- */}
      <EmergencyBroadcastBanner
        language={language}
        riskLevel={data.riskLevel}
        officialWarningActive={assessment.officialWarningActive}
        reason={drivingReason}
        locationLabel="Juhu Beach, Mumbai"
      />

      <header
        className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border"
        role="banner"
      >
        <div className="container flex items-center justify-between h-14">
          <span className="font-bold text-primary text-sm tracking-wide">🌊 BAYWATCH</span>
          <div className="flex items-center gap-2">
            {marine.status === 'live' && (
              <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full bg-safe/10 border border-safe/20 text-[10px] text-safe font-medium">
                <div className="w-1.5 h-1.5 rounded-full bg-safe animate-pulse" />
                LIVE
              </div>
            )}
            {marine.status === 'stale' && (
              <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full bg-warning/10 border border-warning/20 text-[10px] text-warning font-medium">
                STALE
              </div>
            )}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-secondary text-xs">
              <User className="w-3 h-3 text-primary" />
              <span className="text-muted-foreground max-w-[100px] truncate">{userName}</span>
            </div>
            <ThemeToggle />
            <LanguageSelector language={language} onChange={setLanguage} />
            <button
              onClick={signOut}
              className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <MobileEmergencyAlert
        language={language}
        riskLevel={data.riskLevel}
        onViewAlerts={scrollToAlerts}
      />

      <HeroSection
        language={language}
        riskLevel={data.riskLevel ?? 'safe'}
        clock={clock}
        onViewAlerts={scrollToAlerts}
        isSimulation={isSimulation}
        sourceStatus={sourceStatus}
      />

      {/* The command center owns the full operational picture: current state,
          official warnings, live conditions, forecast, risk drivers, the
          explanation, data quality, voice, notifications, events and
          provenance, in that order. */}
      <CoastalCommandCenter language={language} />

      {/* 3. LIVE CONDITIONS ---------------------------------------------- */}
      <MonitoringDashboard
        data={data}
        language={language}
        clock={clock}
        marine={marine}
        earthquakes={earthquakes}
      />

      {/* 4. FORECAST ----------------------------------------------------- */}
      <WaveForecast language={language} marine={marine} />

      {/* 5. RISK DRIVERS ------------------------------------------------- */}
      <div ref={alertsRef}>
        <AlertCardsSection alerts={alertsWithTsunami} language={language} />
      </div>

      {/* 6. DRILL AND SCENARIO ------------------------------------------ */}
      <MockDrill language={language} />
      <ScenarioSimulation
        language={language}
        activeScenario={activeScenario}
        onSimulate={setActiveScenario}
      />

      {/* 7. REPORTING AND RESPONSE ------------------------------------- */}
      <CitizenReporting language={language} userId={user?.id} />

      <LocationTracker language={language} riskLevel={data.riskLevel} />
      <EvacuationMap language={language} />

      {/* Operational incident view. The component checks the role claim itself
          and renders an explicit access notice for non-operational users, so it
          is always mounted and always states which view is being shown. */}
      <IncidentIntelligence language={language} user={user} />

      <TouristMode language={language} />

      {/* 8. GUIDANCE ----------------------------------------------------- */}
      <GovernmentGuidelines language={language} />
      <EmergencyContacts language={language} />

      {/* 9. PROVENANCE --------------------------------------------------- */}
      <DataSourcesFooter
        language={language}
        fetchedAt={marine.fetchedAt}
        status={sourceStatus}
      />

      <footer
        className="container py-8 text-center text-xs text-muted-foreground border-t border-border mt-2"
        role="contentinfo"
      >
        <p className="font-semibold text-foreground mb-1">BayWatch – Juhu Coastal Disaster Alert System</p>
        <p>Multilingual coastal disaster alert platform © {new Date().getFullYear()}</p>
        <p className="mt-1">For educational and awareness purposes. Always follow official NDMA guidelines.</p>
        <p className="mt-2 text-[10px] text-muted-foreground/60">
          Data: Open-Meteo · Open-Meteo Marine · USGS · routing by OSRM and Overpass
        </p>
      </footer>

      <Chatbot language={language} monitoringData={data} />
      </div>
  );
};

export default Index;
