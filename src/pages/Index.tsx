import { useState, useRef } from 'react';
import { type Language } from '@/lib/translations';
import { useMonitoring } from '@/hooks/useMonitoring';
import { useAuth } from '@/hooks/useAuth';
import { useSMSAlert } from '@/hooks/useSMSAlert';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useOfflineIncidentQueue } from '@/hooks/useOfflineIncidentQueue';
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
import { LogOut, User, Bell, CheckCircle, AlertCircle, FlaskConical, RefreshCw, Wifi, WifiOff, Clock, Upload } from 'lucide-react';

const Index = () => {
  const [language, setLanguage] = useState<Language>('en');
  const { data, alerts, clock, marine, earthquakes, sourceStatus } = useMonitoring(8000);
  const { user, signOut } = useAuth();
  const { isMonitoring, lastAlertSent, lastAlertEvent, lastAlertTestMode, error: smsError, clearError, testSMSAlert, riskZones } = useSMSAlert();
  const { isOnline, status: connectionStatus } = useNetworkStatus();
  const { stats: queueStats } = useOfflineIncidentQueue();
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
            {/* Network status indicator */}
            <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-colors"
              style={{
                backgroundColor: connectionStatus === 'online' ? 'hsl(var(--safe) / 0.1)' :
                  connectionStatus === 'reconnecting' ? 'hsl(var(--warning) / 0.1)' :
                  'hsl(var(--muted) / 0.1)',
                borderColor: connectionStatus === 'online' ? 'hsl(var(--safe) / 0.3)' :
                  connectionStatus === 'reconnecting' ? 'hsl(var(--warning) / 0.3)' :
                  'hsl(var(--border))',
                color: connectionStatus === 'online' ? 'hsl(var(--safe))' :
                  connectionStatus === 'reconnecting' ? 'hsl(var(--warning))' :
                  'hsl(var(--muted-foreground))',
              }}
            >
              {connectionStatus === 'online' ? (
                <Wifi className={`w-3 h-3 ${connectionStatus === 'online' ? 'animate-pulse' : ''}`} />
              ) : connectionStatus === 'reconnecting' ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <WifiOff className="w-3 h-3" />
              )}
              {connectionStatus === 'online' ? 'ONLINE' : connectionStatus === 'reconnecting' ? 'RECONNECTING' : 'OFFLINE'}
            </div>
            {/* Offline Incident Queue indicator */}
            {user && (queueStats.queued > 0 || queueStats.syncing > 0 || queueStats.failed > 0) && (
              <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 border border-primary/30 text-[10px] font-medium text-primary">
                <Clock className="w-3 h-3" />
                {queueStats.queued + queueStats.syncing + queueStats.failed}
              </div>
            )}
            {/* SMS Alert monitoring indicator */}
            {user && (
              <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-colors"
                style={{
                  backgroundColor: isMonitoring ? 'hsl(var(--primary) / 0.1)' : 'hsl(var(--muted) / 0.1)',
                  borderColor: isMonitoring ? 'hsl(var(--primary) / 0.3)' : 'hsl(var(--border))',
                  color: isMonitoring ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                }}
              >
                <Bell className={`w-3 h-3 ${isMonitoring ? 'animate-pulse' : ''}`} />
                {isMonitoring ? 'SMS ALERT ON' : 'SMS ALERT OFF'}
              </div>
            )}
            {/* SMS Test Button (development only) */}
            {user && import.meta.env.DEV && riskZones.length > 0 && (
              <button
                onClick={() => testSMSAlert(riskZones[0].id)}
                className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 border border-primary/30 text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors"
                title="Test SMS Alert (TEST MODE - no real SMS sent)"
                aria-label="Trigger test SMS alert"
              >
                <FlaskConical className="w-3 h-3" />
                TEST SMS
              </button>
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

      {/* Mobile emergency alert */}
      <MobileEmergencyAlert
        language={language}
        riskLevel={activeData.riskLevel}
        onViewAlerts={scrollToAlerts}
      />

      {/* SMS Alert Status Toast */}
      {(lastAlertSent || smsError) && (
        <div className="fixed top-20 left-4 right-4 md:left-auto md:right-4 md:w-80 z-40">
          <div className={`glass-card p-3 rounded-xl border-2 animate-slide-in ${
            smsError ? 'border-danger/30 bg-danger/5' : 'border-safe/30 bg-safe/5'
          }`}>
            <div className="flex items-start gap-2">
              {smsError ? (
                <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
              ) : (
                <CheckCircle className="w-5 h-5 text-safe flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  {smsError ? 'SMS Alert Failed' : 'SMS Alert Sent'}
                  {lastAlertTestMode && !smsError && (
                    <span className="px-1.5 py-0.5 text-[9px] font-mono bg-primary/20 text-primary rounded border border-primary/30">
                      TEST MODE
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {smsError
                    ? smsError
                    : `Last alert: ${lastAlertEvent} at ${lastAlertSent.toLocaleTimeString()}`}
                </p>
              </div>
              <button
                onClick={clearError}
                className="p-1 rounded hover:bg-secondary text-muted-foreground"
                aria-label="Dismiss"
              >
                <AlertCircle className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

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
