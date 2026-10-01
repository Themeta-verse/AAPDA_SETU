import { useState, useRef, useMemo } from 'react';
import { type Language } from '@/lib/translations';
import { useMonitoring } from '@/hooks/useMonitoring';
import { CoastalIntelligenceProvider } from '@/hooks/CoastalIntelligenceProvider';
import { useAuth } from '@/hooks/useAuth';
import { useAppRole } from '@/hooks/useAppRole';
import { useSMSAlert } from '@/hooks/useSMSAlert';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useOfflineIncidentQueue } from '@/hooks/useOfflineIncidentQueue';
import { useUrbanContext } from '@/hooks/useUrbanContext';
import { getAlerts, type MonitoringData } from '@/lib/monitoringData';
import { LocationSelector } from '@/components/LocationSelector';
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
import { WaveForecast } from '@/components/WaveForecast';
import { EmergencyBroadcastBanner } from '@/components/EmergencyBroadcastBanner';
import { LocationTracker } from '@/components/LocationTracker';
import { CitizenReporting } from '@/components/CitizenReporting';
import { IncidentIntelligence } from '@/components/IncidentIntelligence';
import { ResourceCommandCenter } from '@/components/ResourceCommandCenter';
import { OperationalUserManagement } from '@/components/OperationalUserManagement';
import { DataSourcesFooter } from '@/components/DataSourcesFooter';
import { LogOut, User, Bell, CheckCircle, AlertCircle, FlaskConical, RefreshCw, Wifi, WifiOff, Clock, Upload, Shield, Radio } from 'lucide-react';

const Index = () => {
  // The provider MUST wrap the content: `useMonitoring` (and everything below)
  // reads the single shared pipeline via `useSharedCoastalIntelligence`, which
  // throws outside a provider. Calling the hook above the provider renders a
  // blank page for every signed-in load instead of the dashboard.
  return (
    <CoastalIntelligenceProvider>
      <IndexContent />
    </CoastalIntelligenceProvider>
  );
};

const IndexContent = () => {
  const [language, setLanguage] = useState<Language>('en');
  const urban = useUrbanContext();
  const { data, alerts, clock, marine, earthquakes, sourceStatus, assessment, tsunamiRisk } = useMonitoring(8000);
  const { user, loading: authLoading, signOut } = useAuth();
  const { role, isOperational, isResolving } = useAppRole(user);
  const { isMonitoring, lastAlertSent, lastAlertEvent, lastAlertTestMode, error: smsError, clearError, testSMSAlert, riskZones } = useSMSAlert();
  const { isOnline, status: connectionStatus } = useNetworkStatus();
  const { stats: queueStats } = useOfflineIncidentQueue();
  const alertsRef = useRef<HTMLDivElement>(null);
  const [activeScenario, setActiveScenario] = useState<ScenarioType>(null);
  // Role-specific workspace state:
  // - Operational users (responder, admin) enter the OPERATIONAL WORKSPACE as their PRIMARY experience.
  // - Citizens enter the PUBLIC CITIZEN DASHBOARD as their experience.
  // - Operational users can optionally preview the citizen view, but their primary workspace is always operational.
  const [previewCitizenView, setPreviewCitizenView] = useState<boolean>(false);
  const isOperationalWorkspace = isOperational && !previewCitizenView;

  // Development-only diagnostic trace (as requested in Step 1)
  if (import.meta.env.DEV && user) {
    console.log('[BayWatch Role/Workspace Routing Diagnostic]', {
      email: user.email,
      app_metadata: user.app_metadata,
      app_metadata_role: user.app_metadata?.role,
      resolvedRole: role,
      isOperational,
      isAdmin: role === 'admin',
      isSignedIn: !!user,
      isResolving,
      authLoading,
      chosenWorkspace: isOperationalWorkspace ? 'OPERATIONAL ADMINISTRATION/RESPONSE WORKSPACE' : 'CITIZEN DASHBOARD',
    });
  }

  // The banner states the single dimension that drove the verdict, rather than
  // a synthesised sentence. Null when nothing resolved, so the banner falls
  // back to its own unknown-state wording instead of inventing a cause.
  // Declared before any early return: hooks must run in the same order on
  // every render, including the role-resolution loading state below.
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

  // STEP 4: Prevent premature rendering of citizen dashboard while role is still resolving.
  // Once confirmed operational (admin or responder), authorization resolution is complete.
  if (authLoading || (user && isResolving && !isOperational)) {
    return (
      <div
        className="min-h-screen bg-background flex flex-col items-center justify-center p-4"
        data-testid="role-resolution-loading"
      >
        <div className="flex flex-col items-center text-center space-y-4 max-w-sm">
          <div className="relative">
            <div className="w-12 h-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <Shield className="w-5 h-5 text-primary absolute inset-0 m-auto" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-foreground tracking-wide uppercase">
              Verifying Authorization
            </h2>
            <p className="text-xs text-muted-foreground">
              Resolving operational workspace permissions...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const scrollToAlerts = () => {
    alertsRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const activeData: MonitoringData = activeScenario ? getScenarioData(activeScenario)! : data;
  // The USGS tsunami flag is authoritative and tri-state. Passing it through
  // unchanged is what keeps the alert cards from inferring a tsunami out of
  // wave height and wind.
  const activeAlerts = activeScenario ? getAlerts(activeData, tsunamiRisk) : alerts;

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'User';
  const displayLocation = urban.context.zoneName
    ? `${urban.context.zoneName} (${urban.context.city})`
    : urban.context.city;

  return (
    <div className="min-h-screen bg-background">
      {/* Emergency Broadcast Banner */}
      <EmergencyBroadcastBanner
        language={language}
        riskLevel={activeData.riskLevel}
        officialWarningActive={assessment.officialWarningActive}
        reason={drivingReason}
        locationLabel={displayLocation}
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
            {/* Operational Navigation Link */}
            {isOperational && (
              <button
                onClick={() => {
                  setPreviewCitizenView(false);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors shadow-sm ${
                  !previewCitizenView
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20'
                }`}
                title={`Operational Workspace (${role})`}
                data-testid="operational-nav-badge"
              >
                <Shield className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Operations ·</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-background/20 font-mono uppercase">
                  {role}
                </span>
              </button>
            )}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-secondary text-xs">
              <User className="w-3 h-3 text-primary" />
              <span className="text-muted-foreground max-w-[100px] truncate">{userName}</span>
            </div>
            <LocationSelector
              context={urban.context}
              cities={urban.cities}
              cityZones={urban.cityZones}
              isGpsActive={urban.isGpsActive}
              onSelectCity={urban.setCity}
              onSelectZone={urban.setZone}
              onToggleGps={urban.toggleGps}
            />
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

      {/* Preview mode banner when operational users view public citizen dashboard */}
      {isOperational && previewCitizenView && (
        <div className="bg-primary/10 border-b border-primary/20 py-2.5 px-4" data-testid="preview-mode-banner">
          <div className="container flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-bold text-[10px] tracking-wide uppercase">
                Preview Mode
              </span>
              <span className="text-muted-foreground text-[11px]">
                Previewing Public Citizen Dashboard as <strong className="text-foreground uppercase">{role}</strong>
              </span>
            </div>
            <button
              onClick={() => {
                setPreviewCitizenView(false);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm flex items-center gap-1.5"
              data-testid="return-operational-btn"
            >
              <Radio className="w-3.5 h-3.5" />
              Return to Operational Workspace
            </button>
          </div>
        </div>
      )}

      {/* Mobile emergency alert */}
      <MobileEmergencyAlert
        language={language}
        riskLevel={activeData.riskLevel}
        onViewAlerts={scrollToAlerts}
        locationName={displayLocation}
      />

      {/* SMS Alert Status Toast */}
      {(lastAlertSent || smsError) && (
        <div className="fixed top-20 left-4 right-4 md:left-auto md:right-4 md:w-80 z-40">
          <div className={`glass-card p-3 rounded-xl border-2 animate-slide-in ${
            smsError ? 'border-danger/30 bg-danger/5' : 'border-safe/30 bg-safe/5'
              }`} data-testid="threat-level">
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

      {isOperationalWorkspace ? (
        <main className="container space-y-8 py-6" data-testid="operational-workspace">
          {/* Operations Hub Breadcrumb & Info */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-card border border-primary/20 shadow-sm">
            <div>
              <div className="flex items-center gap-2 text-primary font-semibold text-xs uppercase tracking-wider">
                <Radio className="w-4 h-4 animate-pulse" />
                <span data-testid="workspace-role-indicator">
                  {role === 'admin'
                    ? 'OPERATIONAL ADMINISTRATION WORKSPACE · ADMIN CONSOLE'
                    : 'OPERATIONAL RESPONSE WORKSPACE · RESPONDER CONSOLE'}
                </span>
              </div>
              <h1 className="text-2xl font-black text-foreground mt-1">
                {role === 'admin'
                  ? 'Municipal Disaster Operations & Resource Administration'
                  : 'Tactical Disaster Response & Resource Command Center'}
              </h1>
              <p className="text-xs text-muted-foreground mt-1">
                Active Ward / Zone: <strong className="text-foreground">{displayLocation}</strong> · Persistent Supabase authorization
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setPreviewCitizenView(true);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="px-3.5 py-2 rounded-xl border border-border bg-secondary text-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors flex items-center gap-1.5"
                data-testid="preview-citizen-btn"
                title="Preview what citizens see on the public dashboard"
              >
                <span>Preview Public Citizen Dashboard</span>
                <span>→</span>
              </button>
            </div>
          </div>

          {/* Operational Quick Metrics / Status Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl border border-border bg-card/60">
              <span className="text-[11px] text-muted-foreground uppercase font-medium">Urban Scope</span>
              <p className="text-xs font-bold text-foreground mt-1 truncate" title={displayLocation}>
                {displayLocation}
              </p>
            </div>
            <div className="p-3.5 rounded-xl border border-border bg-card/60">
              <span className="text-[11px] text-muted-foreground uppercase font-medium">Threat Level</span>
              <p className={`text-xs font-bold mt-1 uppercase ${
                activeData.riskLevel === 'high' || activeData.riskLevel === 'critical'
                  ? 'text-danger'
                  : activeData.riskLevel === 'moderate'
                  ? 'text-warning'
                  : 'text-safe'
              }`}>
                {activeData.riskLevel}
              </p>
            </div>
            <div className="p-3.5 rounded-xl border border-border bg-card/60">
              <span className="text-[11px] text-muted-foreground uppercase font-medium">Network Link</span>
              <p className="text-xs font-bold text-foreground mt-1 flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${connectionStatus === 'online' ? 'bg-safe' : 'bg-warning'}`} />
                {connectionStatus.toUpperCase()}
              </p>
            </div>
            <div className="p-3.5 rounded-xl border border-border bg-card/60">
              <span className="text-[11px] text-muted-foreground uppercase font-medium">SMS Dispatch</span>
              <p className="text-xs font-bold text-foreground mt-1">
                {isMonitoring ? 'ACTIVE' : 'STANDBY'}
              </p>
            </div>
          </div>

          {/* Operational Resource Command Center directly at top */}
          <ResourceCommandCenter
            language={language}
            user={user}
            riskZones={riskZones}
            currentRiskLevel={activeData.riskLevel}
          />

          {/* Administrator-Only: Operational User & Role Management */}
          {role === 'admin' && (
            <OperationalUserManagement language={language} user={user} />
          )}

          {/* Incident Intelligence */}
          <IncidentIntelligence language={language} user={user} />

          {/* Evacuation Map */}
          <EvacuationMap
            language={language}
            zoneName={urban.context.zoneName}
            cityName={urban.context.city}
            wardName={urban.context.ward || undefined}
            centerLat={urban.context.latitude}
            centerLon={urban.context.longitude}
            isCoastal={urban.context.isCoastal}
            safeLocations={urban.safeLocations}
          />

          {/* Emergency Contacts */}
          <EmergencyContacts language={language} />
        </main>
      ) : (
        <main data-testid="citizen-dashboard">
          <HeroSection
            language={language}
            riskLevel={activeData.riskLevel}
            clock={clock}
            onViewAlerts={scrollToAlerts}
            isSimulation={!!activeScenario}
            sourceStatus={sourceStatus}
            locationName={displayLocation}
          />

          <MonitoringDashboard
            data={activeData}
            language={language}
            clock={clock}
            marine={marine}
            earthquakes={earthquakes}
            locationName={displayLocation}
            isCoastal={urban.context.isCoastal}
          />

          {/* GPS Location & Distance */}
          <LocationTracker
            language={language}
            riskLevel={activeData.riskLevel}
            zoneName={urban.context.zoneName}
            targetLat={urban.context.latitude}
            targetLon={urban.context.longitude}
            nearestSafeLocation={urban.safeLocations[0] || null}
          />

          <WaveForecast
            language={language}
            marine={marine}
            isCoastal={urban.context.isCoastal}
            locationName={displayLocation}
          />

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

          <EvacuationMap
            language={language}
            zoneName={urban.context.zoneName}
            cityName={urban.context.city}
            wardName={urban.context.ward || undefined}
            centerLat={urban.context.latitude}
            centerLon={urban.context.longitude}
            isCoastal={urban.context.isCoastal}
            safeLocations={urban.safeLocations}
          />

          {/* Citizen Reporting */}
          <CitizenReporting language={language} userId={user?.id} />

          <TouristMode language={language} />

          <GovernmentGuidelines language={language} />

          <EmergencyContacts language={language} />
        </main>
      )}

      {/* Data Sources & System Status */}
      <DataSourcesFooter
        language={language}
        fetchedAt={marine.fetchedAt}
        status={sourceStatus}
      />

      {/* Footer */}
      <footer className="container py-8 text-center text-xs text-muted-foreground border-t border-border mt-2" role="contentinfo">
        <p className="font-semibold text-foreground mb-1">BayWatch – Urban Disaster Intelligence & Response</p>
        <p>Multilingual urban & coastal disaster alert platform © {new Date().getFullYear()}</p>
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
