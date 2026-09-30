import { useState, useRef } from 'react';
import { type Language } from '@/lib/translations';
import { useMonitoring } from '@/hooks/useMonitoring';
import { useAuth } from '@/hooks/useAuth';
import { getAlerts, type MonitoringData } from '@/lib/monitoringData';
import { LanguageSelector } from '@/components/LanguageSelector';
import { ThemeToggle } from '@/components/ThemeToggle';
import { HeroSection } from '@/components/HeroSection';
import { MonitoringDashboard } from '@/components/MonitoringDashboard';
import { AlertCardsSection } from '@/components/AlertCardsSection';
import { MockDrill } from '@/components/MockDrill';
import { ScenarioSimulation, type ScenarioType, getScenarioData } from '@/components/ScenarioSimulation';
import { EvacuationMap } from '@/components/EvacuationMap';
import { GovernmentGuidelines } from '@/components/GovernmentGuidelines';
import { EmergencyContacts } from '@/components/EmergencyContacts';
import { Chatbot } from '@/components/Chatbot';
import { TouristMode } from '@/components/TouristMode';
import { MobileEmergencyAlert } from '@/components/MobileEmergencyAlert';
import { VoiceAlertGuide } from '@/components/VoiceAlertGuide';
import { TideForecast } from '@/components/TideForecast';
import { EmergencyBroadcastBanner } from '@/components/EmergencyBroadcastBanner';
import { LocationTracker } from '@/components/LocationTracker';
import { CitizenReporting } from '@/components/CitizenReporting';
import { IncidentIntelligence } from '@/components/IncidentIntelligence';
import { DataSourcesFooter } from '@/components/DataSourcesFooter';
import { LogOut, User } from 'lucide-react';

const Index = () => {
  const [language, setLanguage] = useState<Language>('en');
  const { data, alerts, clock, marine, earthquakes, sourceStatus } = useMonitoring(8000);
  const { user, signOut } = useAuth();
  const alertsRef = useRef<HTMLDivElement>(null);
  const [activeScenario, setActiveScenario] = useState<ScenarioType>(null);

  const scrollToAlerts = () => {
    alertsRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const activeData: MonitoringData = activeScenario ? getScenarioData(activeScenario)! : data;
  const activeAlerts = activeScenario ? getAlerts(activeData) : alerts;

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'User';

  return (
    <div className="min-h-screen bg-background" role="main">
      {/* Emergency Broadcast Banner */}
      <EmergencyBroadcastBanner
        language={language}
        riskLevel={activeData.riskLevel}
        activeScenario={activeScenario}
      />

      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border" role="banner">
        <div className="container flex items-center justify-between h-14">
          <span className="font-bold text-primary text-sm tracking-wide">🌊 BAYWATCH</span>
          <div className="flex items-center gap-2">
            {/* Live data indicator */}
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
            {/* User info */}
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

      {/* Mobile emergency alert */}
      <MobileEmergencyAlert
        language={language}
        riskLevel={activeData.riskLevel}
        onViewAlerts={scrollToAlerts}
      />

      <HeroSection
        language={language}
        riskLevel={activeData.riskLevel}
        clock={clock}
        onViewAlerts={scrollToAlerts}
        isSimulation={!!activeScenario}
        sourceStatus={sourceStatus}
      />

      <MonitoringDashboard data={activeData} language={language} clock={clock} marine={marine} earthquakes={earthquakes} />

      {/* GPS Location & Distance */}
      <LocationTracker language={language} riskLevel={activeData.riskLevel} />

      <TideForecast language={language} marine={marine} />

      <div ref={alertsRef}>
        <AlertCardsSection alerts={activeAlerts} language={language} />
      </div>

      <ScenarioSimulation
        language={language}
        activeScenario={activeScenario}
        onSimulate={setActiveScenario}
      />

      <VoiceAlertGuide language={language} riskLevel={activeData.riskLevel} />

      <MockDrill language={language} />

      <EvacuationMap language={language} />

      {/* Citizen Reporting */}
      <CitizenReporting language={language} userId={user?.id} />

      {/* Operational incident view. The component itself checks the role claim
          and renders an explicit access notice for non-operational users, so
          it is always mounted and always states which view you are seeing. */}
      <IncidentIntelligence language={language} user={user} />

      <TouristMode language={language} />

      <GovernmentGuidelines language={language} />

      <EmergencyContacts language={language} />

      {/* Data Sources & System Status */}
      <DataSourcesFooter
        language={language}
        fetchedAt={marine.fetchedAt}
        status={sourceStatus}
      />

      {/* Footer */}
      <footer className="container py-8 text-center text-xs text-muted-foreground border-t border-border mt-2" role="contentinfo">
        <p className="font-semibold text-foreground mb-1">BayWatch – Juhu Coastal Disaster Alert System</p>
        <p>Multilingual coastal disaster alert platform © {new Date().getFullYear()}</p>
        <p className="mt-1">For educational and awareness purposes. Always follow official NDMA guidelines.</p>
        <p className="mt-2 text-[10px] text-muted-foreground/60">
          Data: Open-Meteo · Open-Meteo Marine · USGS
        </p>
      </footer>

      <Chatbot language={language} monitoringData={activeData} />
    </div>
  );
};

export default Index;
