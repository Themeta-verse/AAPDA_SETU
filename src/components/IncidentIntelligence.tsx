import { useState, useMemo, useEffect } from 'react';
import {
  AlertTriangle,
  Camera,
  CloudOff,
  Loader2,
  Lock,
  MapPin,
  MapPinOff,
  RefreshCw,
  ShieldAlert,
  Waves,
  Construction,
  FileWarning,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Layers,
  ArrowRight,
  Send,
  Check,
  X,
  History,
  Info,
  Truck,
  ChevronDown,
  ChevronUp,
  AlertOctagon,
  LifeBuoy,
  ShieldCheck,
} from 'lucide-react';
import { type Language } from '@/lib/translations';
import {
  useIncidentPhoto,
  useIncidents,
  type Incident,
} from '@/hooks/useIncidents';
import { useAppRole } from '@/hooks/useAppRole';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import {
  type IncidentClientLike,
  verifyIncidentReport,
  rejectIncidentReport,
  resolveIncidentReport,
  dispatchIncidentReport,
  fetchIncidentAuditLogs,
  type IncidentAuditLog,
} from '@/integrations/supabase/incidents';
import {
  useResources,
  useResourceAllocations,
  useResourceMutations,
  useResourceSchemaAvailability,
  type Resource,
  type ResourceAllocation,
  type AllocationStatus,
} from '@/hooks/useResources';
import { clusterIncidents, type IncidentCluster } from '@/lib/incidentClustering';
import { deriveIncidentDemand, type IncidentDemand } from '@/lib/incidentDemand';

interface IncidentIntelligenceProps {
  language: Language;
  user: User | null;
  /** Injectable for tests. */
  client?: IncidentClientLike;
}

const labels: Record<
  Language,
  {
    title: string;
    desc: string;
    refresh: string;
    refreshing: string;
    loading: string;

    empty: string;
    emptyDesc: string;
    offline: string;
    offlineDesc: string;
    denied: string;
    deniedDesc: string;
    error: string;
    unauth: string;
    unauthDesc: string;
    degraded: string;
    typeLabel: string;
    descLabel: string;
    timeLabel: string;
    noLocation: string;
    noPhoto: string;
    viewPhoto: string;
    loadingPhoto: string;
    photoDenied: string;
    photoError: string;
    malformed: string;
    unknownType: string;
    noDescription: string;
    lastUpdated: string;
    photoExpires: string;
    flooding: string;
    highWaves: string;
    blockedRoads: string;
    other: string;
  }
> = {
  en: {
    title: 'Incident Intelligence',
    desc: 'Live view of citizen-submitted incidents. Access is enforced by the database, not this screen.',
    loading: 'Loading incidents...',

    refresh: 'Refresh',
    refreshing: 'Refreshing...',
    empty: 'No incidents to display',
    emptyDesc: 'The database returned zero reports for your account. Reports appear here as soon as citizens submit them.',
    offline: 'Network unavailable',
    offlineDesc: 'Reports could not be loaded. Check your connection and refresh.',
    denied: 'Access denied',
    deniedDesc: 'The database refused this request. Only responders and admins can read operational incident data.',
    error: 'Could not load incidents',
    unauth: 'Sign in required',
    unauthDesc: 'You must be signed in before incident data can be requested.',
    degraded: 'Some records are incomplete',
    typeLabel: 'Incident type',
    descLabel: 'Description',
    timeLabel: 'Reported',
    noLocation: 'Location not provided',
    noPhoto: 'No photo attached',
    viewPhoto: 'View photo',
    loadingPhoto: 'Loading photo...',
    photoDenied: 'Photo access denied',
    photoError: 'Photo could not be loaded',
    malformed: 'Incomplete record',
    unknownType: 'Unrecognized type',
    noDescription: 'No description provided',
    lastUpdated: 'Last updated',
    photoExpires: 'Link expires in 5 minutes',
    flooding: 'Flooding',
    highWaves: 'High Waves',
    blockedRoads: 'Blocked Roads',
    other: 'Other',
  },
  hi: {
    title: 'घटना सूचना',
    desc: 'नागरिकों द्वारा दी गई घटनाओं का लाइव दृश्य। पहुँच डेटाबेस द्वारा नियंत्रित है, इस स्क्रीन द्वारा नहीं।',
    loading: 'घटनाएँ लोड हो रही हैं...',

    refresh: 'ताज़ा करें',
    refreshing: 'ताज़ा हो रहा है...',
    empty: 'दिखाने के लिए कोई घटना नहीं',
    emptyDesc: 'आपके खाते के लिए डेटाबेस ने शून्य रिपोर्ट लौटाईं। नागरिकों द्वारा रिपोर्ट करते ही यहाँ दिखाई देंगी।',
    offline: 'नेटवर्क उपलब्ध नहीं',
    offlineDesc: 'रिपोर्ट लोड नहीं हो सकीं। कनेक्शन जाँचें और ताज़ा करें।',
    denied: 'पहुँच अस्वीकृत',
    deniedDesc: 'डेटाबेस ने यह अनुरोध अस्वीकार कर दिया। केवल प्रतिक्रियादाता और व्यवस्थापक ऑपरेशनल डेटा पढ़ सकते हैं।',
    error: 'घटनाएँ लोड नहीं हो सकीं',
    unauth: 'साइन इन आवश्यक',
    unauthDesc: 'घटना डेटा माँगने से पहले आपको साइन इन करना होगा।',
    degraded: 'कुछ रिकॉर्ड अधूरे हैं',
    typeLabel: 'घटना प्रकार',
    descLabel: 'विवरण',
    timeLabel: 'रिपोर्ट किया',
    noLocation: 'स्थान प्रदान नहीं किया गया',
    noPhoto: 'कोई फोटो संलग्न नहीं',
    viewPhoto: 'फोटो देखें',
    loadingPhoto: 'फोटो लोड हो रहा है...',
    photoDenied: 'फोटो पहुँच अस्वीकृत',
    photoError: 'फोटो लोड नहीं हो सका',
    malformed: 'अधूरा रिकॉर्ड',
    unknownType: 'अपरिचित प्रकार',
    noDescription: 'कोई विवरण प्रदान नहीं',
    lastUpdated: 'अंतिम अद्यतन',
    photoExpires: 'लिंक 5 मिनट में समाप्त',
    flooding: 'बाढ़',
    highWaves: 'ऊंची लहरें',
    blockedRoads: 'अवरुद्ध सड़कें',
    other: 'अन्य',
  },
  mr: {
    title: 'घटना माहिती',
    desc: 'नागरिकांनी सादर केलेल्या घटनांचा थेट दृश्य. प्रवेश डेटाबेसद्वारे नियंत्रित आहे, या स्क्रीनद्वारे नाही.',
    loading: 'घटना लोड होत आहेत...',

    refresh: 'ताजे करा',
    refreshing: 'ताजे होत आहे...',
    empty: 'दाखवण्यासाठी कोणतेही घटना नाही',
    emptyDesc: 'तुमच्या खात्यासाठी डेटाबेसने शून्य अहवाल दिले. नागरिक अहवाल दिल्यावर ते येथे दिसतील.',
    offline: 'नेटवर्क उपलब्ध नाही',
    offlineDesc: 'अहवाल लोड होऊ शकले नाहीत. कनेक्शन तपासा आणि ताजे करा.',
    denied: 'प्रवेश नाकारला',
    deniedDesc: 'डेटाबेसने हे विनंती नाकारली. फक्त प्रतिसाद देणारे आणि प्रशासक कार्यक्रम डेटा वाचू शकतात.',
    error: 'घटना लोड होऊ शकल्या नाहीत',
    unauth: 'साइन इन आवश्यक',
    unauthDesc: 'घटना डेटा मागण्यापूर्वी तुम्ही साइन इन करणे आवश्यक आहे.',
    degraded: 'काही नोंदी अपूर्ण आहेत',
    typeLabel: 'घटना प्रकार',
    descLabel: 'वर्णन',
    timeLabel: 'अहवाल दिला',
    noLocation: 'ठिकाण दिलेले नाही',
    noPhoto: 'कोणताही फोटो जोडलेला नाही',
    viewPhoto: 'फोटो पहा',
    loadingPhoto: 'फोटो लोड होत आहे...',
    photoDenied: 'फोटो प्रवेश नाकारला',
    photoError: 'फोटो लोड होऊ शकला नाही',
    malformed: 'अपूर्ण नोंद',
    unknownType: 'अओळखी प्रकार',
    noDescription: 'कोणतेही वर्णन दिलेले नाही',
    lastUpdated: 'शेवटचे अद्ययावत',
    photoExpires: 'लिंक 5 मिनिटांत संपेल',
    flooding: 'पूर',
    highWaves: 'उंच लाटा',
    blockedRoads: 'अवरोधित रस्ते',
    other: 'इतर',
  },
  gu: {
    title: 'ઘટના માહિતી',
    desc: 'નાગરિકો દ્વારા આપેલી ઘટનાઓનું જીવંત દૃશ્ય. પ્રવેશ ડેટાબેસ દ્વારા નિયંત્રિત છે, આ સ્ક્રીન દ્વારા નહીં.',
    loading: 'ઘટનાઓ લોડ થઈ રહી છે...',

    refresh: 'તાજું કરો',
    refreshing: 'તાજું થઈ રહ્યું છે...',
    empty: 'બતાવવા માટે કોઈ ઘટના નથી',
    emptyDesc: 'તમારા ખાતા માટે ડેટાબેસે શૂન્ય અહેવાલ પાછા આપ્યા. નાગરિકો અહેવાલ આપશે ત્યારે તે અહીં દેખાશે.',
    offline: 'નેટવર્ક ઉપલબ્ધ નથી',
    offlineDesc: 'અહેવાલ લોડ થઈ શક્યા નથી. કનેક્શન તપાસો અને તાજું કરો.',
    denied: 'પ્રવેશ નિરાકર્યો',
    deniedDesc: 'ડેટાબેસે આ વિનંતી નકારી. ફક્ત પ્રતિભાવિતો અને વ્યવસ્થાપકો જ કાર્યક્રમ ડેટા વાંચી શકે.',
    error: 'ઘટનાઓ લોડ થઈ શકી નથી',
    unauth: 'સાઇન ઇન જરૂરી',
    unauthDesc: 'ઘટના ડેટા માંગતા પહેલાં તમારે સાઇન ઇન કરવું પડશે.',
    degraded: 'કેટલીક રેકોર્ડ અધૂરા છે',
    typeLabel: 'ઘટના પ્રકાર',
    descLabel: 'વર્ણન',
    timeLabel: 'અહેવાલ આપ્યો',
    noLocation: 'સ્થાન આપવામાં આવ્યું નથી',
    noPhoto: 'કોઈ ફોટો જોડ્યો નથી',
    viewPhoto: 'ફોટો જુઓ',
    loadingPhoto: 'ફોટો લોડ થઈ રહ્યો છે...',
    photoDenied: 'ફોટો પ્રવેશ નિરાકર્યો',
    photoError: 'ફોટો લોડ થઈ શક્યો નથી',
    malformed: 'અધૂરો રેકોર્ડ',
    unknownType: 'અજાણ્યું પ્રકાર',
    noDescription: 'કોઈ વર્ણન આપવામાં આવ્યું નથી',
    lastUpdated: 'છેલ્લે અપડેટ',
    photoExpires: 'લિંક 5 મિનિટમાં સમાપ્ત થશે',
    flooding: 'પૂર',
    highWaves: 'ઊંચા મોજા',
    blockedRoads: 'અવરોધિત રસ્તા',
    other: 'અન્ય',
  },
};

const typeIcon: Record<string, typeof Waves> = {
  flooding: Waves,
  high_waves: Waves,
  blocked_roads: Construction,
  other: FileWarning,
};

function formatTimestamp(isoString: string | null): string | null {
  if (!isoString) return null;
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

export function IncidentIntelligence({
  language,
  user,
  client,
}: IncidentIntelligenceProps) {
  const t = labels[language];
  const { role, isOperational } = useAppRole(user);
  const isSignedIn = !!user;

  const { state, incidents, refetch, isRefreshing } = useIncidents(user, {
    client,
    enabled: isSignedIn,
  });

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'clusters'>('list');
  const [actionError, setActionError] = useState<string | null>(null);

  // Operational Resources & Allocations
  const { resources, refetch: refetchResources } = useResources({
    user,
    client,
    enabled: isOperational,
  });
  const { allocations, refetch: refetchAllocations } = useResourceAllocations({
    user,
    client,
    enabled: isOperational,
  });
  const { createAllocation, updateAllocation } = useResourceMutations({
    user,
    client,
  });
  const { schemaAvailable } = useResourceSchemaAvailability({
    user,
    client,
    enabled: isOperational,
  });

  const typeNames: Record<string, string> = {
    flooding: t.flooding,
    high_waves: t.highWaves,
    blocked_roads: t.blockedRoads,
    other: t.other,
  };

  // Filtered incidents
  const filteredIncidents = useMemo(() => {
    let list = incidents;
    if (statusFilter !== 'all') {
      list = incidents.filter((inc) => (inc.status ?? 'unverified') === statusFilter);
    }
    // Urgent Citizen SOS records sort to the top
    return [...list].sort((a, b) => {
      if (a.isSos && !b.isSos) return -1;
      if (!a.isSos && b.isSos) return 1;
      return 0;
    });
  }, [incidents, statusFilter]);

  // Duplicate Clusters
  const clusters = useMemo(() => {
    return clusterIncidents(filteredIncidents);
  }, [filteredIncidents]);

  // Operational verification action
  const handleVerify = async (incidentId: string, notes?: string) => {
    if (!user) return;
    setActionError(null);
    const activeClient = client ?? (supabase as unknown as IncidentClientLike);
    const res = await verifyIncidentReport({ client: activeClient }, {
      incidentId,
      verifiedBy: user.id,
      notes,
    });
    if (res.ok) {
      refetch();
    } else {
      setActionError(res.error?.message ?? 'Failed to verify incident');
    }
  };

  // Operational rejection action
  const handleReject = async (incidentId: string, reason: string) => {
    if (!user) return;
    setActionError(null);
    const activeClient = client ?? (supabase as unknown as IncidentClientLike);
    const res = await rejectIncidentReport({ client: activeClient }, {
      incidentId,
      rejectedBy: user.id,
      reason,
    });
    if (res.ok) {
      refetch();
    } else {
      setActionError(res.error?.message ?? 'Failed to reject incident');
    }
  };

  // Operational resolution action
  const handleResolve = async (incidentId: string, notes?: string) => {
    if (!user) return;
    setActionError(null);
    const activeClient = client ?? (supabase as unknown as IncidentClientLike);
    const res = await resolveIncidentReport({ client: activeClient }, {
      incidentId,
      resolvedBy: user.id,
      notes,
    });
    if (res.ok) {
      refetch();
    } else {
      setActionError(res.error?.message ?? 'Failed to resolve incident');
    }
  };

  // Operational resource dispatch action
  const handleDispatchResource = async (
    incidentId: string,
    resourceId: string,
    quantity: number
  ) => {
    if (!user) return;
    setActionError(null);
    try {
      const activeClient = client ?? (supabase as unknown as IncidentClientLike);
      const allocRes = await createAllocation({
        resourceId,
        incidentId,
        zoneId: null,
        quantity,
        status: 'deployed',
      });

      if (!allocRes.ok) {
        setActionError('Failed to allocate resource: backend database error');
        return;
      }

      await dispatchIncidentReport(
        { client: activeClient },
        {
          incidentId,
          dispatchedBy: user.id,
          notes: `Tactical resource deployed (Qty: ${quantity})`,
        }
      );

      refetch();
      refetchAllocations();
      refetchResources();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to dispatch resource');
    }
  };

  // Operational resource status update (e.g. deployed -> completed / arrived)
  const handleUpdateAllocation = async (
    allocationId: string,
    status: AllocationStatus,
    incidentId: string
  ) => {
    if (!user) return;
    setActionError(null);
    try {
      const activeClient = client ?? (supabase as unknown as IncidentClientLike);
      const res = await updateAllocation({
        allocationId,
        status,
        deployedBy: user.id,
      });

      if (!res.ok) {
        setActionError('Failed to update allocation state');
        return;
      }

      if (typeof activeClient.from === 'function') {
        try {
          await activeClient.from('incident_audit_logs').insert({
            incident_id: incidentId,
            performed_by: user.id,
            action: status === 'completed' ? 'resource_arrived' : `resource_${status}`,
            previous_status: 'dispatched',
            new_status: 'dispatched',
            notes: `Resource assignment transitioned to ${status.toUpperCase()}`,
          });
        } catch {
          // Non-blocking
        }
      }

      refetch();
      refetchAllocations();
      refetchResources();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update resource allocation');
    }
  };

  const renderBody = () => {
    switch (state.kind) {
      case 'loading':
        return (
          <div
            className="flex items-center justify-center py-12"
            role="status"
            data-testid="incident-loading"
          >
            <Loader2 className="w-6 h-6 animate-spin text-primary" aria-hidden="true" />
            <span className="ml-2 text-sm text-muted-foreground">{t.loading}</span>
          </div>
        );

      case 'unauthenticated':
        return (
          <StateMessage
            testId="incident-unauth"
            icon={Lock}
            title={t.unauth}
            description={t.unauthDesc}
          />
        );

      case 'offline':
        return (
          <StateMessage
            testId="incident-offline"
            icon={CloudOff}
            title={t.offline}
            description={t.offlineDesc}
          />
        );

      case 'denied':
        return (
          <StateMessage
            testId="incident-denied"
            icon={Lock}
            title={t.denied}
            description={`${t.deniedDesc} (${state.error.message})`}
          />
        );

      case 'error':
        return (
          <StateMessage
            testId="incident-error"
            icon={ShieldAlert}
            title={t.error}
            description={state.error.message}
          />
        );

      case 'empty':
        return (
          <StateMessage
            testId="incident-empty"
            icon={AlertTriangle}
            title={t.empty}
            description={t.emptyDesc}
          />
        );

      case 'ready':
      case 'degraded':
        return (
          <>
            {state.kind === 'degraded' && (
              <p
                className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 mb-4"
                role="status"
                data-testid="incident-degraded"
              >
                {t.degraded} ({state.malformedCount})
              </p>
            )}

            {actionError && (
              <p
                className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 mb-4"
                role="alert"
              >
                Action Error: {actionError}
              </p>
            )}

            {/* Operational Controls & Filter Bar */}
            {isOperational && (
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-border/50 text-xs">
                {/* Status Filters */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground font-semibold mr-1">Status:</span>
                  {[
                    { id: 'all', label: `All (${incidents.length})` },
                    { id: 'unverified', label: `Unverified (${incidents.filter((i) => (i.status ?? 'unverified') === 'unverified').length})` },
                    { id: 'verified', label: `Verified (${incidents.filter((i) => i.status === 'verified').length})` },
                    { id: 'dispatched', label: `Dispatched (${incidents.filter((i) => i.status === 'dispatched').length})` },
                    { id: 'resolved', label: `Resolved (${incidents.filter((i) => i.status === 'resolved').length})` },
                    { id: 'rejected', label: `Rejected (${incidents.filter((i) => i.status === 'rejected').length})` },
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() => setStatusFilter(filter.id)}
                      className={`px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                        statusFilter === filter.id
                          ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                          : 'bg-card hover:bg-secondary border-border text-muted-foreground'
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                {/* View Mode: List vs Duplicate Clusters */}
                <div className="flex items-center gap-1.5 p-1 rounded-lg bg-secondary border border-border">
                  <button
                    onClick={() => setViewMode('list')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                      viewMode === 'list'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Reports ({filteredIncidents.length})
                  </button>
                  <button
                    onClick={() => setViewMode('clusters')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors flex items-center gap-1 ${
                      viewMode === 'clusters'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Layers className="w-3 h-3 text-primary" />
                    <span>Clusters ({clusters.length})</span>
                  </button>
                </div>
              </div>
            )}

            {/* List or Clustered View */}
            {viewMode === 'clusters' ? (
              <div className="space-y-4" data-testid="incident-clusters-list">
                {clusters.map((cluster) => (
                  <div
                    key={cluster.clusterId}
                    className="rounded-xl border border-primary/20 bg-card/60 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-border/50">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/20 text-primary border border-primary/30 uppercase">
                          Cluster: {cluster.incidentType}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {cluster.reportCount} Duplicate Report{cluster.reportCount > 1 ? 's' : ''} (500m / 2h threshold)
                        </span>
                      </div>
                      {cluster.centerLatitude && cluster.centerLongitude && (
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {cluster.centerLatitude.toFixed(4)}°N, {cluster.centerLongitude.toFixed(4)}°E
                        </span>
                      )}
                    </div>

                    <ul className="space-y-2">
                      {cluster.reports.map((incident) => (
                        <IncidentCard
                          key={incident.id}
                          incident={incident}
                          language={language}
                          typeNames={typeNames}
                          client={client}
                          isOperational={isOperational}
                          user={user}
                          resources={resources}
                          allocations={allocations}
                          schemaAvailable={schemaAvailable}
                          onVerify={handleVerify}
                          onReject={handleReject}
                          onResolve={handleResolve}
                          onDispatchResource={handleDispatchResource}
                          onUpdateAllocation={handleUpdateAllocation}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="space-y-3" data-testid="incident-list">
                {filteredIncidents.map((incident) => (
                  <IncidentCard
                    key={incident.id}
                    incident={incident}
                    language={language}
                    typeNames={typeNames}
                    client={client}
                    isOperational={isOperational}
                    user={user}
                    resources={resources}
                    allocations={allocations}
                    schemaAvailable={schemaAvailable}
                    onVerify={handleVerify}
                    onReject={handleReject}
                    onResolve={handleResolve}
                    onDispatchResource={handleDispatchResource}
                    onUpdateAllocation={handleUpdateAllocation}
                  />
                ))}
              </ul>
            )}
          </>
        );

      default:
        return null;
    }
  };

  const showRefresh = isOperational && isSignedIn;

  if (!isOperational || !isSignedIn) {
    return (
      <section className="container py-8" aria-label={t.title} data-testid="incident-intelligence">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-primary" aria-hidden="true" />
              {t.title}
            </h2>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">{t.desc}</p>
          </div>
        </div>
        <div className="glass-card rounded-2xl p-5 sm:p-6" data-testid="incident-role-notice">
          <StateMessage
            testId="incident-denied"
            icon={Lock}
            title={!isSignedIn ? t.unauth : t.denied}
            description={!isSignedIn ? t.unauthDesc : t.deniedDesc}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="container py-8" aria-label={t.title} data-testid="incident-intelligence">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-primary" aria-hidden="true" />
            {t.title}
          </h2>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">{t.desc}</p>
        </div>

        {showRefresh && (
          <button
            onClick={refetch}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 disabled:opacity-60 transition-colors"
            data-testid="incident-refresh"
          >
            {isRefreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
            )}
            {isRefreshing ? t.refreshing : t.refresh}
          </button>
        )}
      </div>

      <div className="glass-card rounded-2xl p-5 sm:p-6">{renderBody()}</div>

      {showRefresh &&
        state.kind !== 'loading' &&
        state.kind !== 'unauthenticated' &&
        'fetchedAt' in state &&
        state.fetchedAt && (
          <p className="text-xs text-muted-foreground mt-3" data-testid="incident-fetched-at">
            {t.lastUpdated}: {formatTimestamp(state.fetchedAt)}
          </p>
        )}
    </section>
  );
}

function StateMessage({
  testId,
  icon: Icon,
  title,
  description,
}: {
  testId: string;
  icon: typeof Lock;
  title: string;
  description: string;
}) {
  return (
    <div
      className="flex flex-col items-center text-center py-10 px-4"
      role="status"
      data-testid={testId}
    >
      <Icon className="w-8 h-8 text-muted-foreground mb-3" aria-hidden="true" />
      <p className="font-semibold text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-md">{description}</p>
    </div>
  );
}

interface IncidentCardProps {
  incident: Incident;
  language: Language;
  typeNames: Record<string, string>;
  client?: IncidentClientLike;
  isOperational?: boolean;
  user?: User | null;
  resources?: Resource[];
  allocations?: ResourceAllocation[];
  schemaAvailable?: boolean | null;
  onVerify?: (id: string, notes?: string) => Promise<void>;
  onReject?: (id: string, reason: string) => Promise<void>;
  onResolve?: (id: string, notes?: string) => Promise<void>;
  onDispatchResource?: (incidentId: string, resourceId: string, quantity: number) => Promise<void>;
  onUpdateAllocation?: (allocationId: string, status: AllocationStatus, incidentId: string) => Promise<void>;
}

function IncidentCard({
  incident,
  language,
  typeNames,
  client,
  isOperational = false,
  user,
  resources = [],
  allocations = [],
  schemaAvailable,
  onVerify,
  onReject,
  onResolve,
  onDispatchResource,
  onUpdateAllocation,
}: IncidentCardProps) {
  const t = labels[language];
  const { photo, load } = useIncidentPhoto();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [verifyNotes, setVerifyNotes] = useState('');
  const [showVerifyForm, setShowVerifyForm] = useState(false);

  // Tactical Dispatch State
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');
  const [dispatchQty, setDispatchQty] = useState<number>(1);
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [updatingAllocId, setUpdatingAllocId] = useState<string | null>(null);

  // Authoritative Case File Audit Trail State
  const [showAuditLogs, setShowAuditLogs] = useState<boolean>(false);
  const [auditLogs, setAuditLogs] = useState<IncidentAuditLog[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState<boolean>(false);

  const Icon = incident.type ? typeIcon[incident.type] ?? FileWarning : FileWarning;
  const reportedAt = formatTimestamp(incident.createdAt);

  const status = incident.status;
  const demand = (status === 'verified' || status === 'dispatched') ? deriveIncidentDemand(incident) : null;
  const evidenceStatus = incident.evidenceStatus;

  // Filter real allocations linked to this incident
  const linkedAllocations = useMemo(
    () => allocations.filter((a) => a.incidentId === incident.id),
    [allocations, incident.id]
  );

  // Filter available resources with positive inventory
  const availableResources = useMemo(
    () => resources.filter((r) => r.status === 'available' && r.availableQuantity > 0),
    [resources]
  );

  // Auto-select first available resource if current selection is empty
  useEffect(() => {
    if (!selectedResourceId && availableResources.length > 0) {
      setSelectedResourceId(availableResources[0].id);
    }
  }, [availableResources, selectedResourceId]);

  const selectedResource = useMemo(
    () => availableResources.find((r) => r.id === selectedResourceId),
    [availableResources, selectedResourceId]
  );

  const toggleAuditLogs = async () => {
    const nextState = !showAuditLogs;
    setShowAuditLogs(nextState);
    if (nextState) {
      setLoadingAuditLogs(true);
      try {
        const activeClient = client ?? (supabase as unknown as IncidentClientLike);
        const res = await fetchIncidentAuditLogs({ client: activeClient }, incident.id);
        if (res.logs) {
          setAuditLogs(res.logs);
        }
      } finally {
        setLoadingAuditLogs(false);
      }
    }
  };

  const handleDispatch = async () => {
    if (!selectedResourceId || !onDispatchResource) return;
    setIsDispatching(true);
    setDispatchError(null);
    try {
      await onDispatchResource(incident.id, selectedResourceId, dispatchQty);
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : 'Dispatch failed');
    } finally {
      setIsDispatching(false);
    }
  };

  const handleStatusTransition = async (allocationId: string, nextStatus: AllocationStatus) => {
    if (!onUpdateAllocation) return;
    setUpdatingAllocId(allocationId);
    try {
      await onUpdateAllocation(allocationId, nextStatus, incident.id);
    } finally {
      setUpdatingAllocId(null);
    }
  };

  return (
    <li
      className={`rounded-xl border p-4 transition-colors ${
        incident.isSos
          ? 'border-red-500/50 bg-red-950/20 shadow-md shadow-red-950/20'
          : 'border-border bg-background/40'
      }`}
      data-testid="incident-card"
      data-incident-id={incident.id}
    >
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${incident.isSos ? 'text-red-500' : 'text-primary'}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {/* Header Row: ID + SOS Badge + Type + Status Badges */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground uppercase font-semibold">
                #AS-{(incident.id || '').slice(0, 8).toUpperCase()}
              </span>

              {incident.isSos && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider uppercase bg-red-600 text-white animate-pulse shadow-sm shadow-red-950/40 flex items-center gap-1">
                  <AlertOctagon className="w-3 h-3" />
                  <span>URGENT SOS: {incident.sosType ?? 'EMERGENCY'}</span>
                </span>
              )}

              <p className="font-semibold text-foreground text-sm">
                {incident.type ? typeNames[incident.type] : t.unknownType}
              </p>
              {incident.type === null && incident.rawType && (
                <p className="text-xs text-muted-foreground/80 font-mono break-all">
                  {incident.rawType}
                </p>
              )}
            </div>

            {/* Status Badges */}
            <div className="flex items-center gap-1.5">
              {/* Evidence Status Badge */}
              {evidenceStatus && (
                <span
                  className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border ${
                    evidenceStatus === 'SUFFICIENT'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                      : evidenceStatus === 'PARTIAL'
                      ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20'
                      : 'bg-slate-500/10 text-slate-500 border-slate-500/20'
                  }`}
                  title="Evidence quality: photo, verified coordinates, and clear description"
                >
                  Evidence: {evidenceStatus}
                </span>
              )}

              {/* Operational Lifecycle Status Badge */}
              {status && (
                <span
                  className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border ${
                    status === 'verified'
                      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30'
                      : status === 'dispatched'
                      ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30'
                      : status === 'resolved'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                      : status === 'rejected'
                      ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30'
                      : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30'
                  }`}
                  data-testid={`incident-status-${status}`}
                >
                  {status === 'unverified' ? 'PENDING REVIEW' : status.toUpperCase()}
                </span>
              )}
            </div>
          </div>

          <p className="text-sm text-muted-foreground mt-1 break-words">
            {incident.description ?? t.noDescription}
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" aria-hidden="true" />
              <span>{t.typeLabel}: {incident.type ? typeNames[incident.type] : t.unknownType}</span>
            </span>

            <span className="flex items-center gap-1">
              {incident.hasCoordinates ? (
                <MapPin className="w-3 h-3 text-safe" aria-hidden="true" />
              ) : (
                <MapPinOff className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
              )}
              {incident.hasCoordinates ? (
                <span data-testid="incident-coordinates">
                  {incident.latitude?.toFixed(4)}, {incident.longitude?.toFixed(4)}
                </span>
              ) : (
                <span data-testid="incident-no-location">{t.noLocation}</span>
              )}
            </span>

            {reportedAt && (
              <span>
                {t.timeLabel}: <span data-testid="incident-created-at">{reportedAt}</span>
              </span>
            )}
          </div>

          {/* Operational Workflow Metadata: Rejection reason or Verification notes */}
          {incident.rejectionReason && (
            <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
              <strong>Rejection Reason:</strong> {incident.rejectionReason} (Original citizen evidence preserved)
            </div>
          )}

          {incident.verificationNotes && (
            <div className="mt-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-600 dark:text-blue-400">
              <strong>Verification Notes:</strong> {incident.verificationNotes}
            </div>
          )}

          {demand && (
            <div className="mt-2 p-2.5 rounded-lg bg-primary/10 border border-primary/20 text-xs space-y-1">
              <div className="flex items-center justify-between font-semibold text-foreground">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                  Tactical Demand Generated
                </span>
                <span className="text-[10px] font-mono uppercase bg-primary/20 text-primary px-1.5 py-0.2 rounded">
                  Priority {demand.priority}
                </span>
              </div>
              <p className="text-muted-foreground text-[11px]">{demand.rationale}</p>
            </div>
          )}

          {/* Operational Verification Actions for Responders */}
          {isOperational && status === 'unverified' && (
            <div className="mt-3 pt-3 border-t border-border/50 flex flex-wrap items-center gap-2">
              {!showVerifyForm && !showRejectForm && (
                <>
                  <button
                    onClick={() => {
                      if (incident.isSos) {
                        if (onVerify) onVerify(incident.id, 'Citizen emergency SOS acknowledged by Incident Command');
                      } else {
                        setShowVerifyForm(true);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-sm ${
                      incident.isSos
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-safe text-safe-foreground hover:bg-safe/90'
                    }`}
                    data-testid={`verify-btn-${incident.id}`}
                  >
                    {incident.isSos ? (
                      <>
                        <AlertOctagon className="w-3.5 h-3.5" />
                        <span>Acknowledge SOS</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Verify Report</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setShowRejectForm(true)}
                    className="px-3 py-1.5 rounded-lg border border-border bg-secondary hover:bg-destructive/10 text-muted-foreground hover:text-destructive font-medium text-xs transition-colors flex items-center gap-1"
                    data-testid={`reject-btn-${incident.id}`}
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </>
              )}

              {/* Inline Verify Form */}
              {showVerifyForm && (
                <div className="w-full flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Verification notes (optional)..."
                    value={verifyNotes}
                    onChange={(e) => setVerifyNotes(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-background text-xs"
                  />
                  <button
                    onClick={async () => {
                      if (onVerify) await onVerify(incident.id, verifyNotes);
                      setShowVerifyForm(false);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-safe text-safe-foreground font-semibold text-xs"
                  >
                    Confirm Verify
                  </button>
                  <button
                    onClick={() => setShowVerifyForm(false)}
                    className="px-2 py-1.5 rounded-lg bg-secondary text-xs"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Inline Reject Form */}
              {showRejectForm && (
                <div className="w-full flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Reason for rejection (required)..."
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-background text-xs"
                  />
                  <button
                    onClick={async () => {
                      if (!rejectReason.trim()) return;
                      if (onReject) await onReject(incident.id, rejectReason);
                      setShowRejectForm(false);
                    }}
                    disabled={!rejectReason.trim()}
                    className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground font-semibold text-xs disabled:opacity-50"
                  >
                    Confirm Reject
                  </button>
                  <button
                    onClick={() => setShowRejectForm(false)}
                    className="px-2 py-1.5 rounded-lg bg-secondary text-xs"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* FEATURE 1: Incident Command & Resource Dispatch (For Verified / Dispatched Incidents) */}
          {isOperational && (status === 'verified' || status === 'dispatched') && (
            <div className="mt-3 pt-3 border-t border-border/50 space-y-3" data-testid={`incident-command-panel-${incident.id}`}>
              <div className="p-3 rounded-xl bg-card border border-primary/20 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-primary" />
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                      Resource Command & Dispatch
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                    {linkedAllocations.length} Assigned Resource{linkedAllocations.length === 1 ? '' : 's'}
                  </span>
                </div>

                {/* Already Dispatched Resources */}
                {linkedAllocations.length > 0 ? (
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                      Operational Deployments:
                    </span>
                    <div className="space-y-1">
                      {linkedAllocations.map((alloc) => {
                        const matchedRes = resources.find((r) => r.id === alloc.resourceId);
                        const resName = matchedRes ? `${matchedRes.name} (${matchedRes.resourceType})` : `Resource #${alloc.resourceId.slice(0, 6)}`;
                        const isDeployed = alloc.status === 'deployed';
                        const isCompleted = alloc.status === 'completed';

                        return (
                          <div
                            key={alloc.id}
                            className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-background/60 border border-border text-xs"
                            data-testid={`allocation-row-${alloc.id}`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">{resName}</span>
                              <span className="text-[11px] text-muted-foreground">Qty: {alloc.quantity}</span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border ${
                                  isDeployed
                                    ? 'bg-purple-500/10 text-purple-400 border-purple-500/30 animate-pulse'
                                    : isCompleted
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                    : 'bg-secondary text-muted-foreground border-border'
                                }`}
                              >
                                {isDeployed ? 'DISPATCHED / EN ROUTE' : isCompleted ? 'ARRIVED / ON SCENE' : (alloc.status || 'pending').toUpperCase()}
                              </span>
                            </div>

                            {/* Operational Transition: DISPATCHED -> ARRIVED (completed) */}
                            {isDeployed && (
                              <button
                                onClick={() => handleStatusTransition(alloc.id, 'completed')}
                                disabled={updatingAllocId === alloc.id}
                                className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[11px] flex items-center gap-1 transition-colors disabled:opacity-50"
                                data-testid={`mark-arrived-btn-${alloc.id}`}
                              >
                                {updatingAllocId === alloc.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Check className="w-3 h-3" />
                                )}
                                <span>Mark Arrived / On Scene</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    No resources currently assigned to this incident.
                  </p>
                )}

                {/* Dispatch Resource Action */}
                {schemaAvailable === false ? (
                  <div
                    className="p-2.5 rounded-lg bg-warning/10 border border-warning/30 text-xs text-warning"
                    data-testid="resource-not-configured-notice"
                  >
                    <strong>Resource Management Not Configured:</strong> The resource-management database tables are not present in the current database. Field dispatching is unavailable while incident tracking and verification remain fully active.
                  </div>
                ) : (
                  <div className="pt-2 border-t border-border/50">
                    {availableResources.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No operational resources currently available in inventory.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={selectedResourceId}
                          onChange={(e) => {
                            setSelectedResourceId(e.target.value);
                            setDispatchQty(1);
                          }}
                          className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          data-testid={`select-resource-${incident.id}`}
                        >
                          {availableResources.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} ({r.resourceType}) — Available: {r.availableQuantity}
                            </option>
                          ))}
                        </select>

                        <div className="flex items-center gap-1">
                          <label htmlFor={`dispatch-qty-${incident.id}`} className="text-[11px] text-muted-foreground">Qty:</label>
                          <input
                            id={`dispatch-qty-${incident.id}`}
                            type="number"
                            min={1}
                            max={selectedResource?.availableQuantity ?? 1}
                            value={dispatchQty}
                            onChange={(e) =>
                              setDispatchQty(
                                Math.min(
                                  selectedResource?.availableQuantity ?? 1,
                                  Math.max(1, parseInt(e.target.value) || 1)
                                )
                              )
                            }
                            className="w-16 px-2 py-1.5 rounded-lg border border-border bg-background text-xs text-center"
                          />
                        </div>

                        <button
                          onClick={handleDispatch}
                          disabled={isDispatching || !selectedResourceId}
                          className="px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground font-semibold text-xs hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
                          data-testid={`dispatch-btn-${incident.id}`}
                        >
                          {isDispatching ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Truck className="w-3.5 h-3.5" />
                          )}
                          <span>Dispatch Resource</span>
                        </button>
                      </div>
                    )}

                    {dispatchError && (
                      <p className="text-xs text-danger mt-1.5">{dispatchError}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Operational Resolution Button */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  onClick={async () => {
                    if (onResolve) await onResolve(incident.id, 'Hazard mitigated by operational response team');
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 transition-colors flex items-center gap-1.5 shadow-sm"
                  data-testid={`resolve-btn-${incident.id}`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Mark Incident Resolved</span>
                </button>
              </div>
            </div>
          )}

          {/* Authoritative Case File & Audit Trail (Collapsible) */}
          {isOperational && (
            <div className="mt-3 pt-2 border-t border-border/40">
              <button
                type="button"
                onClick={toggleAuditLogs}
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                data-testid={`toggle-audit-btn-${incident.id}`}
              >
                <History className="w-3.5 h-3.5 text-primary" />
                <span>Case File & Audit Trail</span>
                {showAuditLogs ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>

              {showAuditLogs && (
                <div
                  className="mt-2.5 p-3 rounded-xl bg-card/60 border border-border space-y-2 text-xs"
                  data-testid={`audit-log-drawer-${incident.id}`}
                >
                  <div className="flex items-center justify-between pb-1.5 border-b border-border/40 font-mono text-[11px] text-muted-foreground">
                    <span>Case Reference: #AS-{(incident.id || '').slice(0, 8).toUpperCase()}</span>
                    <span>Authoritative Log</span>
                  </div>

                  {loadingAuditLogs ? (
                    <div className="flex items-center gap-2 py-3 justify-center text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span>Loading case history...</span>
                    </div>
                  ) : auditLogs.length === 0 ? (
                    <p className="text-muted-foreground italic py-1">
                      No operational audit events recorded for this case yet.
                    </p>
                  ) : (
                    <ol className="relative border-l border-border/60 ml-2 space-y-2.5 my-2">
                      {auditLogs.map((log) => (
                        <li key={log.id} className="ml-3.5">
                          <span className="absolute -left-1 mt-1 w-2 h-2 rounded-full bg-primary" />
                          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                            <span className="font-semibold text-foreground uppercase tracking-wide">
                              {log.action}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(log.createdAt).toLocaleString()}
                            </span>
                          </div>
                          {log.previousStatus || log.newStatus ? (
                            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                              Status: {log.previousStatus ?? 'initial'} → {log.newStatus}
                            </p>
                          ) : null}
                          {log.notes && (
                            <p className="text-muted-foreground mt-0.5">{log.notes}</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          )}

          {incident.malformed && (
            <p
              className="text-xs text-warning mt-2"
              data-testid="incident-malformed"
            >
              {t.malformed}
            </p>
          )}
        </div>
      </div>

      {/* Photo. Nothing is rendered until an authorized viewer asks for a
          short-lived signed URL. */}
      <div className="mt-3 pl-8">
        {!incident.photoPath ? (
          <p className="text-xs text-muted-foreground" data-testid="incident-no-photo">
            {t.noPhoto}
          </p>
        ) : (
          <>
            <button
              onClick={() => load(incident.photoPath as string, client)}
              disabled={photo.isLoading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-secondary text-xs font-medium hover:bg-secondary/80 disabled:opacity-60 transition-colors"
              data-testid="incident-view-photo"
            >
              {photo.isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {photo.isLoading ? t.loadingPhoto : t.viewPhoto}
            </button>

            {photo.error && (
              <p
                className="text-xs text-danger mt-2"
                role="alert"
                data-testid="incident-photo-error"
              >
                {photo.error.kind === 'permission-denied'
                  ? t.photoDenied
                  : t.photoError}{' '}
                ({photo.error.message})
              </p>
            )}

            {photo.url && (
              <div className="mt-2" data-testid="incident-photo">
                <img
                  src={photo.url}
                  alt={incident.description ?? 'Incident photo'}
                  className="max-w-xs rounded-lg border border-border"
                />
                <p className="text-[10px] text-muted-foreground mt-1">{t.photoExpires}</p>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export default IncidentIntelligence;

