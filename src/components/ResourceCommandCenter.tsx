import React, { useState, useMemo } from 'react';
import {
  Shield,
  Truck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Wrench,
  RefreshCw,
  Plus,
  Filter,
  Search,
  Lock,
  CloudOff,
  Radio,
  FileText,
  Building,
  Anchor,
  Activity,
  Layers,
  MapPin,
  ChevronDown,
  Clock,
  Check,
  X,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { type Language } from '@/lib/translations';
import { useAuth } from '@/hooks/useAuth';
import { useAppRole } from '@/hooks/useAppRole';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useIncidents, type Incident } from '@/hooks/useIncidents';
import {
  useResources,
  useResourceAllocations,
  useResourceAuditLogs,
  useResourceCompatibility,
  useResourceMutations,
  type Resource,
  type ResourceAllocation,
  type ResourceType,
  type ResourceStatus,
  type AllocationStatus,
  type SuggestedAllocation,
  computeRuleBasedRecommendations,
} from '@/hooks/useResources';
import { RESOURCE_TYPES, RESOURCE_STATUSES, clearSchemaAvailabilityCache } from '@/integrations/supabase/resources';
import type { RiskZone } from '@/hooks/useSMSAlert';

import type { SupabaseClient, User } from '@supabase/supabase-js';

interface ResourceCommandCenterProps {
  language: Language;
  user?: User | null;
  riskZones?: RiskZone[];
  currentRiskLevel?: 'safe' | 'moderate' | 'high' | 'critical';
  client?: SupabaseClient;
}

const labels: Record<
  Language,
  {
    title: string;
    subtitle: string;
    refresh: string;
    refreshing: string;
    totalResources: string;
    available: string;
    allocated: string;
    deployed: string;
    maintenance: string;
    unavailable: string;
    inventory: string;
    activeDemand: string;
    recommendations: string;
    allocationsList: string;
    auditTrail: string;
    filterByType: string;
    filterByStatus: string;
    filterByZone: string;
    searchPlaceholder: string;
    allTypes: string;
    allStatuses: string;
    allZones: string;
    addResource: string;
    allocateBtn: string;
    approve: string;
    reject: string;
    deploy: string;
    release: string;
    quantity: string;
    availableQty: string;
    locationZone: string;
    status: string;
    reason: string;
    rulePriority: string;
    emptyInventory: string;
    emptyInventoryDesc: string;
    emptyAllocations: string;
    emptyAllocationsDesc: string;
    emptyRecommendations: string;
    emptyRecommendationsDesc: string;
    noDemand: string;
    noDemandDesc: string;
    offlineNotice: string;
    offlineDesc: string;
    denied: string;
    deniedDesc: string;
    incident: string;
    selectIncident: string;
    selectResource: string;
    selectQuantity: string;
    confirmAllocation: string;
    cancel: string;
    resourceName: string;
    resourceType: string;
    saveResource: string;
    suggestedAllocations: string;
    actionRequiresConnection: string;
    rejectionReasonPrompt: string;
  }
> = {
  en: {
    title: 'Urban Resource Command Center',
    subtitle: 'Real-time urban resource capacity, deterministic allocation recommendations, and municipal deployment control.',
    refresh: 'Refresh',
    refreshing: 'Updating...',
    totalResources: 'Total Resources',
    available: 'Available',
    allocated: 'Allocated',
    deployed: 'Deployed',
    maintenance: 'Maintenance',
    unavailable: 'Unavailable',
    inventory: 'Resource Inventory',
    activeDemand: 'Active Demand Overview',
    recommendations: 'Suggested Allocations',
    allocationsList: 'Live Deployments & Allocations',
    auditTrail: 'Operational Audit Log',
    filterByType: 'Filter by Type',
    filterByStatus: 'Filter by Status',
    filterByZone: 'Filter by Zone',
    searchPlaceholder: 'Search resources by name, ward, or zone...',
    allTypes: 'All Resource Types',
    allStatuses: 'All Statuses',
    allZones: 'All Zones',
    addResource: 'Register Resource',
    allocateBtn: 'Allocate Resource',
    approve: 'Approve',
    reject: 'Reject',
    deploy: 'Deploy',
    release: 'Complete / Release',
    quantity: 'Total Qty',
    availableQty: 'Available Qty',
    locationZone: 'Ward / Zone / Location',
    status: 'Operational State',
    reason: 'Rule Justification',
    rulePriority: 'Priority',
    emptyInventory: 'No resource inventory is available',
    emptyInventoryDesc: 'No emergency response resources are registered in the system database yet.',
    emptyAllocations: 'No active allocations recorded',
    emptyAllocationsDesc: 'Allocated or deployed resources will appear here once approved by operational responders.',
    emptyRecommendations: 'No allocation recommendations pending',
    emptyRecommendationsDesc: 'All verified incidents currently have sufficient resources or no compatible available capacity was matched.',
    noDemand: 'No active incident demand registered',
    noDemandDesc: 'The system has zero active verified incidents requiring emergency resource dispatch at this time.',
    offlineNotice: 'Connection Offline (Read-Only Mode)',
    offlineDesc: 'Viewing cached resource data. Creating or updating resource allocations requires an active network connection.',
    denied: 'Operational Access Required',
    deniedDesc: 'Resource management is restricted to authorized responders and administrators. Citizens have view-only situational awareness.',
    incident: 'Target Incident',
    selectIncident: 'Select an active incident',
    selectResource: 'Select an available resource',
    selectQuantity: 'Select allocation quantity',
    confirmAllocation: 'Confirm Allocation',
    cancel: 'Cancel',
    resourceName: 'Resource Name',
    resourceType: 'Resource Type',
    saveResource: 'Save Resource to Inventory',
    suggestedAllocations: 'Rule-Based Allocation Recommendations',
    actionRequiresConnection: 'Action requires an online network connection.',
    rejectionReasonPrompt: 'Optional rejection reason:',
  },
  hi: {
    title: 'शहरी संसाधन कमांड सेंटर',
    subtitle: 'वास्तविक समय शहरी संसाधन क्षमता, नियतात्मक आवंटन सिफारिशें और नगरपालिका तैनाती नियंत्रण।',
    refresh: 'ताज़ा करें',
    refreshing: 'अपडेट हो रहा है...',
    totalResources: 'कुल संसाधन',
    available: 'उपलब्ध',
    allocated: 'आवंटित',
    deployed: 'तैनात',
    maintenance: 'रखरखाव',
    unavailable: 'अनुपलब्ध',
    inventory: 'संसाधन इन्वेंटरी',
    activeDemand: 'सक्रिय मांग अवलोकन',
    recommendations: 'सुझाए गए आवंटन',
    allocationsList: 'सक्रिय तैनाती और आवंटन',
    auditTrail: 'ऑपरेशनल ऑडिट लॉग',
    filterByType: 'प्रकार से फ़िल्टर करें',
    filterByStatus: 'स्थिति से फ़िल्टर करें',
    filterByZone: 'ज़ोन से फ़िल्टर करें',
    searchPlaceholder: 'संसाधन खोजें...',
    allTypes: 'सभी प्रकार',
    allStatuses: 'सभी स्थितियाँ',
    allZones: 'सभी क्षेत्र',
    addResource: 'संसाधन जोड़ें',
    allocateBtn: 'संसाधन आवंटित करें',
    approve: 'स्वीकृत करें',
    reject: 'अस्वीकार करें',
    deploy: 'तैनात करें',
    release: 'मुक्त करें',
    quantity: 'कुल मात्रा',
    availableQty: 'उपलब्ध मात्रा',
    locationZone: 'वार्ड / ज़ोन / स्थान',
    status: 'परिचालन स्थिति',
    reason: 'नियम कारण',
    rulePriority: 'प्राथमिकता',
    emptyInventory: 'कोई संसाधन इन्वेंटरी उपलब्ध नहीं है',
    emptyInventoryDesc: 'डेटाबेस में अभी तक कोई आपातकालीन संसाधन पंजीकृत नहीं हैं।',
    emptyAllocations: 'कोई सक्रिय आवंटन नहीं',
    emptyAllocationsDesc: 'स्वीकृत होने पर आवंटित संसाधन यहाँ दिखाई देंगे।',
    emptyRecommendations: 'कोई लंबित सिफारिश नहीं',
    emptyRecommendationsDesc: 'वर्तमान में सभी घटनाओं के पास पर्याप्त संसाधन हैं।',
    noDemand: 'कोई सक्रिय मांग नहीं',
    noDemandDesc: 'वर्तमान में संसाधन प्रेषण की आवश्यकता वाली कोई सक्रिय घटना नहीं है।',
    offlineNotice: 'ऑफ़लाइन मोड (केवल पढ़ने योग्य)',
    offlineDesc: 'कैश किया गया डेटा देखा जा रहा है। आवंटन के लिए कनेक्शन आवश्यक है।',
    denied: 'ऑपरेशनल पहुँच आवश्यक',
    deniedDesc: 'संसाधन प्रबंधन केवल अधिकृत उत्तरदाताओं और प्रशासकों के लिए प्रतिबंधित है।',
    incident: 'लक्षित घटना',
    selectIncident: 'सक्रिय घटना चुनें',
    selectResource: 'उपलब्ध संसाधन चुनें',
    selectQuantity: 'मात्रा चुनें',
    confirmAllocation: 'आवंटन की पुष्टि करें',
    cancel: 'रद्द करें',
    resourceName: 'संसाधन का नाम',
    resourceType: 'संसाधन प्रकार',
    saveResource: 'संसाधन सहेजें',
    suggestedAllocations: 'नियम-आधारित आवंटन सिफारिशें',
    actionRequiresConnection: 'इस क्रिया के लिए ऑनलाइन नेटवर्क कनेक्शन आवश्यक है।',
    rejectionReasonPrompt: 'अस्वीकृति का कारण (वैकल्पिक):',
  },
  mr: {
    title: 'नागरी संसाधन कमांड सेंटर',
    subtitle: 'थेट नागरी संसाधन क्षमता, नियम-आधारित वाटप शिफारसी आणि पालिका प्रतिसाद नियंत्रण.',
    refresh: 'ताजे करा',
    refreshing: 'अपडेट होत आहे...',
    totalResources: 'एकूण संसाधने',
    available: 'उपलब्ध',
    allocated: 'वाटप केलेले',
    deployed: 'तैनात',
    maintenance: 'देखभाल',
    unavailable: 'अनुपलब्ध',
    inventory: 'संसाधन यादी',
    activeDemand: 'सक्रिय मागणी आढावा',
    recommendations: 'सुचवलेले वाटप',
    allocationsList: 'थेट तैनाती आणि वाटप',
    auditTrail: 'ऑपरेशनल ऑडिट लॉग',
    filterByType: 'प्रकारानुसार फिल्टर',
    filterByStatus: 'स्थितीनुसार फिल्टर',
    filterByZone: 'झोननुसार फिल्टर',
    searchPlaceholder: 'संसाधन शोधा...',
    allTypes: 'सर्व प्रकार',
    allStatuses: 'सर्व स्थिती',
    allZones: 'सर्व झोन',
    addResource: 'संसाधन नोंदवा',
    allocateBtn: 'संसाधन वाटप करा',
    approve: 'मंजूर करा',
    reject: 'नाकारा',
    deploy: 'तैनात करा',
    release: 'मुक्त करा',
    quantity: 'एकूण संख्या',
    availableQty: 'उपलब्ध संख्या',
    locationZone: 'वॉर्ड / झोन / स्थान',
    status: 'स्थिती',
    reason: 'कारण',
    rulePriority: 'प्राधान्य',
    emptyInventory: 'कोणतीही संसाधने उपलब्ध नाहीत',
    emptyInventoryDesc: 'डेटाबेसमध्ये अद्याप कोणतीही संसाधने नोंदवलेली नाहीत.',
    emptyAllocations: 'कोणतेही सक्रिय वाटप नाही',
    emptyAllocationsDesc: 'वाटप केलेली संसाधने येथे दिसतील.',
    emptyRecommendations: 'कोणतीही शिफारस प्रलंबित नाही',
    emptyRecommendationsDesc: 'सध्या सर्व घटनांकडे पुरेशी संसाधने आहेत.',
    noDemand: 'सक्रिय मागणी उपलब्ध नाही',
    noDemandDesc: 'सध्या आपत्कालीन संसाधनांची आवश्यकता असलेली कोणतीही घटना नाही.',
    offlineNotice: 'ऑफलाइन मोड (केवळ वाचन)',
    offlineDesc: 'कॅश केलेला डेटा दिसत आहे. वाटपासाठी नेटवर्क आवश्यक आहे.',
    denied: 'प्रवेश प्रतिबंधित',
    deniedDesc: 'संसाधन व्यवस्थापन केवळ अधिकृत कर्मचाऱ्यांसाठी उपलब्ध आहे.',
    incident: 'लक्षित घटना',
    selectIncident: 'घटना निवडा',
    selectResource: 'संसाधन निवडा',
    selectQuantity: 'संख्या निवडा',
    confirmAllocation: 'वाटप निश्चित करा',
    cancel: 'रद्द करा',
    resourceName: 'संसाधनाचे नाव',
    resourceType: 'संसाधन प्रकार',
    saveResource: 'संसाधन जतन करा',
    suggestedAllocations: 'नियम-आधारित वाटप शिफारसी',
    actionRequiresConnection: 'या कृतीसाठी ऑनलाइन नेटवर्क कनेक्शन आवश्यक आहे.',
    rejectionReasonPrompt: 'नकार देण्याचे कारण (पर्यायी):',
  },
  gu: {
    title: 'શહેરી સંસાધન કમાન્ડ સેન્ટર',
    subtitle: 'વાસ્તવિક સમય શહેરી સંસાધન ક્ષમતા, નિયમ-આધારિત ફાળવણી ભલામણો અને આપત્તિ પ્રતિસાદ નિયંત્રણ.',
    refresh: 'તાજું કરો',
    refreshing: 'અપડેટ થઈ રહ્યું છે...',
    totalResources: 'કુલ સંસાધનો',
    available: 'ઉપલબ્ધ',
    allocated: 'ફાળવેલ',
    deployed: 'તૈનાત',
    maintenance: 'જાળવણી',
    unavailable: 'અનુપલબ્ધ',
    inventory: 'સંસાધન ઇન્વેન્ટરી',
    activeDemand: 'સક્રિય માંગ ઝાંખી',
    recommendations: 'સૂચવેલ ફાળવણી',
    allocationsList: 'જીવંત તૈનાતી અને ફાળવણી',
    auditTrail: 'ઓપરેશનલ ઑડિટ લૉગ',
    filterByType: 'પ્રકાર દ્વારા ફિલ્ટર',
    filterByStatus: 'સ્થિતિ દ્વારા ફિલ્ટર',
    filterByZone: 'ઝોન દ્વારા ફિલ્ટર',
    searchPlaceholder: 'સંસાધન શોધો...',
    allTypes: 'બધા પ્રકાર',
    allStatuses: 'બધી સ્થિતિ',
    allZones: 'બધા ઝોન',
    addResource: 'સંસાધન ઉમેરો',
    allocateBtn: 'સંસાધન ફાળવો',
    approve: 'મંજૂર કરો',
    reject: 'નકારો',
    deploy: 'તૈનાત કરો',
    release: 'મુક્ત કરો',
    quantity: 'કુલ જથ્થો',
    availableQty: 'ઉપલબ્ધ જથ્થો',
    locationZone: 'વોર્ડ / ઝોન / સ્થાન',
    status: 'સ્થિતિ',
    reason: 'કારણ',
    rulePriority: 'પ્રાથમિકતા',
    emptyInventory: 'કોઈ સંસાધનો ઉપલબ્ધ નથી',
    emptyInventoryDesc: 'ડેટાબેઝમાં હજી કોઈ સંસાધન નોંધાયેલ નથી.',
    emptyAllocations: 'કોઈ સક્રિય ફાળવણી નથી',
    emptyAllocationsDesc: 'ફાળવેલ સંસાધનો અહીં દેખાશે.',
    emptyRecommendations: 'કોઈ ભલામણ બાકી નથી',
    emptyRecommendationsDesc: 'હાલમાં તમામ ઘટનાઓ પાસે પૂરતા સંસાધનો છે.',
    noDemand: 'કોઈ સક્રિય માંગ નથી',
    noDemandDesc: 'હાલમાં કોઈ આપત્કાલીન ઘટના સક્રિય નથી.',
    offlineNotice: 'ઑફલાઇન મોડ (માત્ર વાંચન)',
    offlineDesc: 'કેશ કરેલ ડેટા જોઈ રહ્યા છો. ફાળવણી માટે નેટવર્ક જરૂરી છે.',
    denied: 'પ્રવેશ પ્રતિબંધિત',
    deniedDesc: 'સંસાધન સંચાલન ફક્ત અધિકૃત પ્રતિભાવકો માટે છે.',
    incident: 'લક્ષિત ઘટના',
    selectIncident: 'ઘટના પસંદ કરો',
    selectResource: 'સંસાધન પસંદ કરો',
    selectQuantity: 'જથ્થો પસંદ કરો',
    confirmAllocation: 'ફાળવણી કન્ફર્મ કરો',
    cancel: 'રદ કરો',
    resourceName: 'સંસાધનનું નામ',
    resourceType: 'સંસાધન પ્રકાર',
    saveResource: 'સંસાધન સાચવો',
    suggestedAllocations: 'નિયમ-આધારિત ફાળવણી ભલામણો',
    actionRequiresConnection: 'આ ક્રિયા માટે ઑનલાઇન નેટવર્ક કનેક્શન જરૂરી છે.',
    rejectionReasonPrompt: 'નકારવાનું કારણ (વૈકલ્પિક):',
  },
};

const statusConfig: Record<
  ResourceStatus,
  { label: string; icon: React.ComponentType<{ className?: string }>; badgeClass: string }
> = {
  available: {
    label: 'AVAILABLE',
    icon: CheckCircle2,
    badgeClass: 'bg-safe/10 text-safe border-safe/30',
  },
  allocated: {
    label: 'ALLOCATED',
    icon: AlertTriangle,
    badgeClass: 'bg-warning/10 text-warning border-warning/30',
  },
  deployed: {
    label: 'DEPLOYED',
    icon: Truck,
    badgeClass: 'bg-primary/10 text-primary border-primary/30',
  },
  maintenance: {
    label: 'MAINTENANCE',
    icon: Wrench,
    badgeClass: 'bg-secondary text-muted-foreground border-border',
  },
  unavailable: {
    label: 'UNAVAILABLE',
    icon: XCircle,
    badgeClass: 'bg-danger/10 text-danger border-danger/30',
  },
};

export function ResourceCommandCenter({
  language,
  user: userProp,
  riskZones = [],
  currentRiskLevel = 'safe',
  client,
}: ResourceCommandCenterProps) {
  const t = labels[language] || labels.en;
  const { user: authUser } = useAuth();
  const user = userProp !== undefined ? userProp : authUser;
  const { isOperational, isAdmin, role } = useAppRole(user);
  const { isOnline } = useNetworkStatus();

  // Queries
  const {
    resources,
    loading: loadingResources,
    error: resourceError,
    refetch: refetchResources,
    isCached,
    fetchedAt,
    schemaAvailable: resourcesSchemaAvailable,
    checking: resourcesChecking,
    retrySchema: retryResourcesSchema,
  } = useResources({ client, user });

  const {
    allocations,
    loading: loadingAllocations,
    error: allocationsError,
    refetch: refetchAllocations,
    schemaAvailable: allocationsSchemaAvailable,
    checking: allocationsChecking,
    retrySchema: retryAllocationsSchema,
  } = useResourceAllocations({ client, user });

  const {
    compatibilities,
    loading: loadingCompatibilities,
    error: compatibilityError,
    refetch: refetchCompatibilities,
    schemaAvailable: compatibilitiesSchemaAvailable,
    checking: compatibilitiesChecking,
    retrySchema: retryCompatibilitiesSchema,
  } = useResourceCompatibility({ client, user });

  const {
    logs: auditLogs,
    loading: loadingAuditLogs,
    error: auditLogsError,
    refetch: refetchLogs,
    schemaAvailable: auditLogsSchemaAvailable,
    checking: auditLogsChecking,
    retrySchema: retryAuditLogsSchema,
  } = useResourceAuditLogs({ client, user });

  const schemaAvailable = resourcesSchemaAvailable ?? allocationsSchemaAvailable ?? compatibilitiesSchemaAvailable ?? auditLogsSchemaAvailable;
  const checking = resourcesChecking || allocationsChecking || compatibilitiesChecking || auditLogsChecking;
  const retrySchema = async (): Promise<boolean> => {
    return (await retryResourcesSchema?.()) ?? false;
  };

  // Aggregate query errors from individual hooks (non-schema errors)
  const queryError = resourceError || allocationsError || compatibilityError || auditLogsError;

  const { incidents } = useIncidents(user, { client, enabled: !!user });

  // Mutations
  const {
    createResource,
    createAllocation,
    updateAllocation,
    deleteResource,
    deleteAllocation,
    isSubmitting,
    error: mutationError,
    clearError,
  } = useResourceMutations({ client, user });

  // UI state
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'inventory' | 'recommendations' | 'allocations' | 'audit'>(
    'inventory'
  );

  // Modal / Form state
  const [showAllocateModal, setShowAllocateModal] = useState<boolean>(false);
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('');
  const [selectedZoneId, setSelectedZoneId] = useState<string>('');
  const [allocateQty, setAllocateQty] = useState<number>(1);

  const [showAddResourceModal, setShowAddResourceModal] = useState<boolean>(false);
  const [newResName, setNewResName] = useState<string>('');
  const [newResType, setNewResType] = useState<ResourceType>('water_pump');
  const [newResQty, setNewResQty] = useState<number>(1);
  const [newResZoneId, setNewResZoneId] = useState<string>('');
  const [newResLat, setNewResLat] = useState<string>('');
  const [newResLon, setNewResLon] = useState<string>('');
  const [newResCapacity, setNewResCapacity] = useState<string>('');

  // Rejection modal state
  const [rejectingAllocId, setRejectingAllocId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');

  // Zone map lookup
  const zoneMap = useMemo(() => {
    const map = new Map<string, string>();
    riskZones.forEach((z) => map.set(z.id, z.name));
    return map;
  }, [riskZones]);

  // Summary counts
  const summary = useMemo(() => {
    let total = 0;
    let available = 0;
    let allocated = 0;
    let deployed = 0;
    let maintenance = 0;
    let unavailable = 0;

    for (const r of resources) {
      total += r.quantity;
      if (r.status === 'available') {
        available += r.availableQuantity;
        allocated += Math.max(0, r.quantity - r.availableQuantity);
      } else if (r.status === 'allocated') {
        allocated += r.quantity;
      } else if (r.status === 'deployed') {
        deployed += r.quantity;
      } else if (r.status === 'maintenance') {
        maintenance += r.quantity;
      } else if (r.status === 'unavailable') {
        unavailable += r.quantity;
      }
    }

    return { total, available, allocated, deployed, maintenance, unavailable };
  }, [resources]);

  // Compute recommendations
  const recommendations: SuggestedAllocation[] = useMemo(() => {
    return computeRuleBasedRecommendations({
      incidents,
      resources,
      compatibilities,
      allocations,
      zones: riskZones.map((z) => ({ id: z.id, name: z.name })),
    });
  }, [incidents, resources, compatibilities, allocations, riskZones]);

  // Filtered resources
  const filteredResources = useMemo(() => {
    return resources.filter((res) => {
      if (typeFilter !== 'all' && res.resourceType !== typeFilter) return false;
      if (statusFilter !== 'all' && res.status !== statusFilter) return false;
      if (zoneFilter !== 'all' && (res.zoneId ?? 'unassigned') !== zoneFilter) return false;
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        const matchesName = res.name.toLowerCase().includes(query);
        const matchesType = res.resourceType.toLowerCase().includes(query);
        const matchesZone = (zoneMap.get(res.zoneId ?? '') || '').toLowerCase().includes(query);
        if (!matchesName && !matchesType && !matchesZone) return false;
      }
      return true;
    });
  }, [resources, typeFilter, statusFilter, zoneFilter, searchQuery, zoneMap]);

  // Refresh handler - retries schema availability check FIRST
  const handleRefresh = async () => {
    // Clear schema availability cache to force fresh check on retry
    clearSchemaAvailabilityCache();
    // Step 1: Probe schema availability FIRST with ONE minimal request
    const isNowAvailable = typeof retrySchema === 'function' ? await retrySchema() : false;
    // Step 2: ONLY if the table now exists, fetch resources/allocations/logs/compatibilities
    if (isNowAvailable) {
      await Promise.all([refetchResources(), refetchAllocations(), refetchLogs(), refetchCompatibilities()]);
    }
  };

  // Allocation submission
  const handleConfirmAllocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedResourceId) return;

    const res = await createAllocation({
      resourceId: selectedResourceId,
      incidentId: selectedIncidentId || null,
      zoneId: selectedZoneId || null,
      quantity: allocateQty,
      status: 'pending',
    });

    if (res.ok) {
      setShowAllocateModal(false);
      setSelectedResourceId('');
      setSelectedIncidentId('');
      setSelectedZoneId('');
      setAllocateQty(1);
      await Promise.all([refetchResources(), refetchAllocations(), refetchLogs()]);
    }
  };

  // Recommendation approve handler
  const handleApproveRecommendation = async (rec: SuggestedAllocation) => {
    if (!isOnline) return;

    const res = await createAllocation({
      resourceId: rec.resourceId,
      incidentId: rec.incidentId,
      zoneId: rec.zoneId,
      quantity: rec.suggestedQuantity,
      status: 'approved',
    });

    if (res.ok) {
      await Promise.all([refetchResources(), refetchAllocations(), refetchLogs()]);
    }
  };

  // Direct deployment handler
  const handleDeployAllocation = async (allocId: string) => {
    if (!isOnline) return;
    const res = await updateAllocation({
      allocationId: allocId,
      status: 'deployed',
      deployedBy: user?.id,
    });
    if (res.ok) {
      await Promise.all([refetchResources(), refetchAllocations(), refetchLogs()]);
    }
  };

  // Release allocation handler
  const handleReleaseAllocation = async (allocId: string) => {
    if (!isOnline) return;
    const res = await updateAllocation({
      allocationId: allocId,
      status: 'released',
    });
    if (res.ok) {
      await Promise.all([refetchResources(), refetchAllocations(), refetchLogs()]);
    }
  };

  // Rejection handler
  const handleConfirmRejection = async () => {
    if (!rejectingAllocId || !isOnline) return;
    const res = await updateAllocation({
      allocationId: rejectingAllocId,
      status: 'rejected',
      rejectionReason: rejectionReason.trim() || 'Rejected by operational supervisor',
    });
    if (res.ok) {
      setRejectingAllocId(null);
      setRejectionReason('');
      await Promise.all([refetchResources(), refetchAllocations(), refetchLogs()]);
    }
  };

  // Create new resource
  const handleSaveResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResName.trim()) return;

    const lat = newResLat.trim() ? parseFloat(newResLat) : null;
    const lon = newResLon.trim() ? parseFloat(newResLon) : null;
    const cap = newResCapacity.trim() ? parseInt(newResCapacity, 10) : null;

    const res = await createResource({
      name: newResName.trim(),
      resourceType: newResType,
      quantity: Math.max(1, newResQty),
      zoneId: newResZoneId || null,
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lon) ? lon : null,
      capacity: Number.isFinite(cap) ? cap : null,
      status: 'available',
    });

    if (res.ok) {
      setShowAddResourceModal(false);
      setNewResName('');
      setNewResQty(1);
      setNewResLat('');
      setNewResLon('');
      setNewResCapacity('');
      await Promise.all([refetchResources(), refetchLogs()]);
    }
  };

  return (
    <section
      id="resource-command-center"
      className="container py-8 space-y-6"
      aria-label={t.title}
      data-testid="resource-command-center"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Radio className="w-6 h-6 text-primary animate-pulse" aria-hidden="true" />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">{t.title}</h2>
            {isOperational && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-xs font-bold text-primary tracking-wide uppercase"
                data-testid="operational-role-badge"
              >
                <Shield className="w-3.5 h-3.5 text-primary" />
                <span>OPERATIONAL ACCESS · {role}</span>
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">{t.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Offline notice badge */}
          {!isOnline && (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-danger/10 border border-danger/30 text-xs font-medium text-danger"
              role="alert"
            >
              <CloudOff className="w-3.5 h-3.5" />
              <span>{t.offlineNotice}</span>
            </div>
          )}

          {isCached && isOnline && (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-warning/10 border border-warning/30 text-[11px] text-warning">
              CACHED VIEW
            </div>
          )}

          <button
            onClick={handleRefresh}
            disabled={loadingResources || isSubmitting}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-secondary text-secondary-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors disabled:opacity-50"
            aria-label={t.refresh}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingResources ? 'animate-spin' : ''}`} />
            {loadingResources ? t.refreshing : t.refresh}
          </button>

          {isOperational && (
            <>
              <button
                onClick={() => setShowAddResourceModal(true)}
                disabled={!isOnline}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                {t.addResource}
              </button>

              <button
                onClick={() => setShowAllocateModal(true)}
                disabled={!isOnline || resources.length === 0}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-accent-foreground text-xs font-semibold hover:bg-accent/80 transition-colors disabled:opacity-50"
              >
                <Truck className="w-3.5 h-3.5" />
                {t.allocateBtn}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Role Notice for non-operational users */}
      {!isOperational && (
        <div
          className="glass-card p-4 rounded-xl border border-warning/30 bg-warning/5 flex items-start gap-3"
          data-testid="resource-role-notice"
        >
          <Lock className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t.denied}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t.deniedDesc}</p>
          </div>
        </div>
      )}

      {/* Mutation Error Toast */}
      {mutationError && (
        <div className="glass-card p-3 rounded-xl border border-danger/40 bg-danger/10 flex items-center justify-between text-xs text-danger">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{mutationError}</span>
          </div>
          <button onClick={clearError} className="p-1 hover:bg-danger/20 rounded">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Failure-isolated Resource Query Error Notice */}
      {schemaAvailable === false && (
        <div
          className="glass-card p-3.5 rounded-xl border border-warning/40 bg-warning/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
          data-testid="resource-query-error-notice"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-foreground">
                Resource Management Not Configured
              </p>
              <p className="text-muted-foreground mt-0.5">
                The resource management backend tables are not present in the current database. Resource inventory, allocations, and recommendations are unavailable. Incident reporting and flood intelligence remain fully operational.
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loadingResources || isSubmitting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-warning/20 hover:bg-warning/30 text-warning font-semibold transition-colors flex-shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingResources ? 'animate-spin' : ''}`} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Individual query errors (non-schema) */}
      {schemaAvailable !== false && queryError && (
        <div
          className="glass-card p-3.5 rounded-xl border border-warning/40 bg-warning/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
          data-testid="resource-query-error-notice"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-foreground">
                Resource Data Notice
              </p>
              <p className="text-muted-foreground mt-0.5">
                {queryError}
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loadingResources || isSubmitting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-warning/20 hover:bg-warning/30 text-warning font-semibold transition-colors flex-shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingResources ? 'animate-spin' : ''}`} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="resource-kpis">
        <div className="glass-card p-4 rounded-xl border border-border">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {t.totalResources}
          </p>
          <p className="text-2xl font-bold text-foreground mt-1">{summary.total}</p>
          <div className="w-full bg-secondary/50 h-1.5 rounded-full mt-2 overflow-hidden">
            <div className="bg-primary h-full w-full" />
          </div>
        </div>

        <div className="glass-card p-4 rounded-xl border border-safe/20 bg-safe/5">
          <p className="text-[11px] font-medium text-safe uppercase tracking-wider flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {t.available}
          </p>
          <p className="text-2xl font-bold text-safe mt-1">{summary.available}</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {summary.total > 0 ? `${Math.round((summary.available / summary.total) * 100)}% capacity` : '0%'}
          </p>
        </div>

        <div className="glass-card p-4 rounded-xl border border-warning/20 bg-warning/5">
          <p className="text-[11px] font-medium text-warning uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {t.allocated}
          </p>
          <p className="text-2xl font-bold text-warning mt-1">{summary.allocated}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Assigned to incidents</p>
        </div>

        <div className="glass-card p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-[11px] font-medium text-primary uppercase tracking-wider flex items-center gap-1">
            <Truck className="w-3 h-3" />
            {t.deployed}
          </p>
          <p className="text-2xl font-bold text-primary mt-1">{summary.deployed}</p>
          <p className="text-[10px] text-muted-foreground mt-1">In active field duty</p>
        </div>

        <div className="glass-card p-4 rounded-xl border border-border">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Wrench className="w-3 h-3" />
            {t.maintenance}
          </p>
          <p className="text-2xl font-bold text-muted-foreground mt-1">{summary.maintenance}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Under inspection</p>
        </div>

        <div className="glass-card p-4 rounded-xl border border-danger/20 bg-danger/5">
          <p className="text-[11px] font-medium text-danger uppercase tracking-wider flex items-center gap-1">
            <XCircle className="w-3 h-3" />
            {t.unavailable}
          </p>
          <p className="text-2xl font-bold text-danger mt-1">{summary.unavailable}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Offline or depleted</p>
        </div>
      </div>

      {/* Active Demand Overview Banner */}
      <div className="glass-card p-4 rounded-xl border border-border" data-testid="resource-demand-overview">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">{t.activeDemand}</h3>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary font-mono text-muted-foreground">
            Current Risk: {currentRiskLevel.toUpperCase()}
          </span>
        </div>

        {incidents.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            <p className="text-xs">{t.noDemand}</p>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">{t.noDemandDesc}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-secondary/30">
              <span className="text-muted-foreground block text-[10px]">Verified Incidents</span>
              <span className="text-lg font-bold text-foreground">{incidents.length}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-secondary/30">
              <span className="text-muted-foreground block text-[10px]">Active Risk Zones</span>
              <span className="text-lg font-bold text-foreground">{riskZones.length}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-secondary/30">
              <span className="text-muted-foreground block text-[10px]">Pending Recommendations</span>
              <span className="text-lg font-bold text-primary">{recommendations.length}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-secondary/30">
              <span className="text-muted-foreground block text-[10px]">Active Allocations</span>
              <span className="text-lg font-bold text-safe">{allocations.length}</span>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-border text-sm font-medium gap-4" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'inventory'}
          onClick={() => setActiveTab('inventory')}
          className={`pb-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'inventory'
              ? 'border-b-2 border-primary text-primary font-bold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Layers className="w-4 h-4" />
          {t.inventory} ({resources.length})
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'recommendations'}
          onClick={() => setActiveTab('recommendations')}
          className={`pb-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'recommendations'
              ? 'border-b-2 border-primary text-primary font-bold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Shield className="w-4 h-4" />
          {t.recommendations}
          {recommendations.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-primary text-primary-foreground font-bold">
              {recommendations.length}
            </span>
          )}
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'allocations'}
          onClick={() => setActiveTab('allocations')}
          className={`pb-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'allocations'
              ? 'border-b-2 border-primary text-primary font-bold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Truck className="w-4 h-4" />
          {t.allocationsList} ({allocations.length})
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'audit'}
          onClick={() => setActiveTab('audit')}
          className={`pb-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'audit'
              ? 'border-b-2 border-primary text-primary font-bold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <FileText className="w-4 h-4" />
          {t.auditTrail} ({auditLogs.length})
        </button>
      </div>

      {/* TAB 1: Resource Inventory */}
      {activeTab === 'inventory' && (
        <div className="space-y-4" data-testid="tab-inventory">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={t.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-secondary/50 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Type Filter */}
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-secondary/50 border border-border text-xs text-foreground focus:outline-none"
              >
                <option value="all">{t.allTypes}</option>
                {RESOURCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, ' ').toUpperCase()}
                  </option>
                ))}
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-secondary/50 border border-border text-xs text-foreground focus:outline-none"
              >
                <option value="all">{t.allStatuses}</option>
                {RESOURCE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.toUpperCase()}
                  </option>
                ))}
              </select>

              {/* Zone Filter */}
              <select
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-secondary/50 border border-border text-xs text-foreground focus:outline-none"
              >
                <option value="all">{t.allZones}</option>
                {riskZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Resources Table / Cards */}
          {resources.length === 0 ? (
            <div className="glass-card p-8 rounded-2xl text-center" data-testid="empty-resources">
              <Layers className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
              <h3 className="text-base font-bold text-foreground">{t.emptyInventory}</h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">
                {t.emptyInventoryDesc}
              </p>
            </div>
          ) : filteredResources.length === 0 ? (
            <div className="glass-card p-6 rounded-xl text-center text-xs text-muted-foreground">
              No resources match the selected filter criteria.
            </div>
          ) : (
            <div className="glass-card rounded-2xl overflow-hidden border border-border">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs" data-testid="resource-table">
                  <thead className="bg-secondary/40 border-b border-border text-muted-foreground font-semibold">
                    <tr>
                      <th className="p-3">Resource</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">State</th>
                      <th className="p-3">Available / Total</th>
                      <th className="p-3">Zone / Location</th>
                      <th className="p-3">Last Updated</th>
                      {isOperational && <th className="p-3 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {filteredResources.map((res) => {
                      const cfg = statusConfig[res.status] || statusConfig.available;
                      const Icon = cfg.icon;
                      const zoneName = res.zoneId ? zoneMap.get(res.zoneId) || 'Assigned Zone' : 'General Inventory';

                      return (
                        <tr key={res.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="p-3 font-semibold text-foreground">
                            {res.name}
                            {res.capacity && (
                              <span className="block text-[10px] text-muted-foreground font-normal">
                                Capacity: {res.capacity} persons
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-muted-foreground font-mono text-[11px]">
                            {res.resourceType.replace(/_/g, ' ')}
                          </td>
                          <td className="p-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${cfg.badgeClass}`}
                            >
                              <Icon className="w-3 h-3" />
                              {cfg.label}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className="font-semibold text-foreground">{res.availableQuantity}</span>
                            <span className="text-muted-foreground"> / {res.quantity}</span>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <MapPin className="w-3 h-3 text-primary flex-shrink-0" />
                              <span>{zoneName}</span>
                            </div>
                            {res.latitude && res.longitude && (
                              <span className="block text-[10px] text-muted-foreground/60 font-mono">
                                {res.latitude.toFixed(4)}, {res.longitude.toFixed(4)}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-muted-foreground text-[11px]">
                            {res.createdAt ? new Date(res.createdAt).toLocaleDateString() : 'N/A'}
                          </td>
                          {isOperational && (
                            <td className="p-3 text-right space-x-1.5">
                              <button
                                onClick={() => {
                                  setSelectedResourceId(res.id);
                                  setShowAllocateModal(true);
                                }}
                                disabled={res.status !== 'available' || res.availableQuantity <= 0 || !isOnline}
                                className="px-2.5 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-semibold transition-colors disabled:opacity-30 disabled:pointer-events-none"
                              >
                                Allocate
                              </button>
                              {isAdmin && (
                                <button
                                  onClick={async () => {
                                    if (window.confirm(`Delete ${res.name} from inventory?`)) {
                                      await deleteResource(res.id);
                                      await Promise.all([refetchResources(), refetchLogs()]);
                                    }
                                  }}
                                  disabled={!isOnline || isSubmitting}
                                  className="px-2.5 py-1 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger text-[11px] font-semibold transition-colors disabled:opacity-30"
                                  title="Admin: Delete Resource"
                                  data-testid={`delete-resource-${res.id}`}
                                >
                                  Delete
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Rule-Based Recommendations & Approval Workflow */}
      {activeTab === 'recommendations' && (
        <div className="space-y-4" data-testid="tab-recommendations">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              {t.suggestedAllocations}
            </h3>
            <span className="text-xs text-muted-foreground">
              Deterministic rule-based decision support. Human approval mandatory.
            </span>
          </div>

          {recommendations.length === 0 ? (
            <div className="glass-card p-8 rounded-2xl text-center" data-testid="empty-recommendations">
              <CheckCircle2 className="w-10 h-10 text-safe mx-auto mb-3" />
              <h3 className="text-base font-bold text-foreground">{t.emptyRecommendations}</h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">
                {t.emptyRecommendationsDesc}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="recommendation-list">
              {recommendations.map((rec) => (
                <div
                  key={rec.id}
                  className="glass-card p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3"
                  data-testid="recommendation-item"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary text-primary-foreground uppercase tracking-wide">
                        Priority {rec.priority} Suggestion
                      </span>
                      <h4 className="text-sm font-bold text-foreground mt-1.5 flex items-center gap-1.5">
                        <Truck className="w-4 h-4 text-primary" />
                        {rec.resourceName} ({rec.resourceType})
                      </h4>
                    </div>
                    <span className="text-xs font-semibold text-safe bg-safe/10 border border-safe/20 px-2 py-0.5 rounded-full">
                      Qty: {rec.suggestedQuantity}
                    </span>
                  </div>

                  <div className="text-xs space-y-1 bg-secondary/30 p-2.5 rounded-lg">
                    <p className="text-muted-foreground">
                      <strong className="text-foreground">Incident:</strong> {rec.incidentType} (
                      {rec.incidentDescription || 'No description'})
                    </p>
                    <p className="text-muted-foreground">
                      <strong className="text-foreground">Target Zone:</strong> {rec.zoneName} ({rec.incidentLocation})
                    </p>
                    <p className="text-primary/90 text-[11px] pt-1">
                      <strong>Rule Justification:</strong> {rec.reason}
                    </p>
                  </div>

                  {isOperational && (
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        onClick={() => {
                          setRejectingAllocId(rec.id);
                        }}
                        disabled={!isOnline || isSubmitting}
                        className="px-3 py-1.5 rounded-lg border border-border hover:bg-secondary text-xs text-muted-foreground transition-colors disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5 inline mr-1" />
                        {t.reject}
                      </button>

                      <button
                        onClick={() => handleApproveRecommendation(rec)}
                        disabled={!isOnline || isSubmitting}
                        className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        {t.approve}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Live Deployments & Allocations */}
      {activeTab === 'allocations' && (
        <div className="space-y-4" data-testid="tab-allocations">
          {allocations.length === 0 ? (
            <div className="glass-card p-8 rounded-2xl text-center" data-testid="empty-allocations">
              <Truck className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
              <h3 className="text-base font-bold text-foreground">{t.emptyAllocations}</h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">
                {t.emptyAllocationsDesc}
              </p>
            </div>
          ) : (
            <div className="glass-card rounded-2xl overflow-hidden border border-border">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs" data-testid="allocations-table">
                  <thead className="bg-secondary/40 border-b border-border text-muted-foreground font-semibold">
                    <tr>
                      <th className="p-3">Resource</th>
                      <th className="p-3">Incident / Zone</th>
                      <th className="p-3">Allocated Qty</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Allocated Time</th>
                      {isOperational && <th className="p-3 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {allocations.map((alloc) => {
                      const res = resources.find((r) => r.id === alloc.resourceId);
                      const zone = alloc.zoneId ? zoneMap.get(alloc.zoneId) : 'General';

                      return (
                        <tr key={alloc.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="p-3 font-semibold text-foreground">
                            {res ? res.name : `Resource #${alloc.resourceId.slice(0, 6)}`}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            <span>{zone}</span>
                            {alloc.incidentId && (
                              <span className="block text-[10px] text-primary">
                                Incident #{alloc.incidentId.slice(0, 6)}
                              </span>
                            )}
                          </td>
                          <td className="p-3 font-bold text-foreground">{alloc.quantity}</td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                alloc.status === 'deployed'
                                  ? 'bg-primary/10 text-primary border border-primary/30'
                                  : alloc.status === 'approved'
                                  ? 'bg-safe/10 text-safe border border-safe/30'
                                  : alloc.status === 'rejected'
                                  ? 'bg-danger/10 text-danger border border-danger/30'
                                  : alloc.status === 'released' || alloc.status === 'completed'
                                  ? 'bg-secondary text-muted-foreground'
                                  : 'bg-warning/10 text-warning border border-warning/30'
                              }`}
                            >
                              {alloc.status}
                            </span>
                          </td>
                          <td className="p-3 text-muted-foreground text-[11px]">
                            {new Date(alloc.allocatedAt).toLocaleString()}
                          </td>
                          {isOperational && (
                            <td className="p-3 text-right space-x-1.5">
                              {alloc.status === 'pending' && (
                                <>
                                  <button
                                    onClick={() =>
                                      updateAllocation({ allocationId: alloc.id, status: 'approved', approvedBy: user?.id })
                                    }
                                    disabled={!isOnline}
                                    className="px-2 py-0.5 rounded bg-safe/10 text-safe text-[11px] font-semibold hover:bg-safe/20"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => setRejectingAllocId(alloc.id)}
                                    disabled={!isOnline}
                                    className="px-2 py-0.5 rounded bg-danger/10 text-danger text-[11px] font-semibold hover:bg-danger/20"
                                  >
                                    Reject
                                  </button>
                                </>
                              )}

                              {alloc.status === 'approved' && (
                                <button
                                  onClick={() => handleDeployAllocation(alloc.id)}
                                  disabled={!isOnline}
                                  className="px-2 py-0.5 rounded bg-primary/10 text-primary text-[11px] font-semibold hover:bg-primary/20"
                                >
                                  Deploy Field
                                </button>
                              )}

                              {alloc.status === 'deployed' && (
                                <button
                                  onClick={() => handleReleaseAllocation(alloc.id)}
                                  disabled={!isOnline}
                                  className="px-2 py-0.5 rounded bg-secondary text-foreground text-[11px] font-semibold hover:bg-secondary/80"
                                >
                                  Release Unit
                                </button>
                              )}

                              {isAdmin && (
                                <button
                                  onClick={async () => {
                                    if (window.confirm('Delete this allocation record?')) {
                                      await deleteAllocation(alloc.id);
                                      await Promise.all([refetchAllocations(), refetchLogs()]);
                                    }
                                  }}
                                  disabled={!isOnline || isSubmitting}
                                  className="px-2 py-0.5 rounded bg-danger/10 text-danger text-[11px] font-semibold hover:bg-danger/20 transition-colors disabled:opacity-30"
                                  title="Admin: Delete Allocation"
                                  data-testid={`delete-allocation-${alloc.id}`}
                                >
                                  Delete
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Audit Trail */}
      {activeTab === 'audit' && (
        <div className="space-y-4" data-testid="tab-audit">
          {auditLogs.length === 0 ? (
            <div className="glass-card p-6 rounded-xl text-center text-xs text-muted-foreground">
              No audit log entries recorded yet.
            </div>
          ) : (
            <div className="glass-card rounded-2xl overflow-hidden border border-border">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs" data-testid="audit-table">
                  <thead className="bg-secondary/40 border-b border-border text-muted-foreground font-semibold">
                    <tr>
                      <th className="p-3">Time</th>
                      <th className="p-3">Action</th>
                      <th className="p-3">Resource</th>
                      <th className="p-3">State Transition</th>
                      <th className="p-3">Qty</th>
                      <th className="p-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50 font-mono text-[11px]">
                    {auditLogs.map((log) => {
                      const res = resources.find((r) => r.id === log.resourceId);
                      return (
                        <tr key={log.id} className="hover:bg-secondary/20">
                          <td className="p-3 text-muted-foreground">
                            {new Date(log.createdAt).toLocaleTimeString()}
                          </td>
                          <td className="p-3 font-semibold uppercase text-primary">{log.action}</td>
                          <td className="p-3 text-foreground font-sans">
                            {res ? res.name : log.resourceId.slice(0, 8)}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {log.previousStatus || 'none'} → {log.newStatus || 'none'}
                          </td>
                          <td className="p-3 font-bold text-foreground">{log.quantity}</td>
                          <td className="p-3 text-muted-foreground font-sans text-xs">{log.notes || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL: Allocate Resource */}
      {showAllocateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="glass-card w-full max-w-md p-6 rounded-2xl border border-border shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Truck className="w-4 h-4 text-primary" />
                {t.confirmAllocation}
              </h3>
              <button onClick={() => setShowAllocateModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmAllocation} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1 text-foreground">{t.selectResource}</label>
                <select
                  required
                  value={selectedResourceId}
                  onChange={(e) => {
                    setSelectedResourceId(e.target.value);
                    const res = resources.find((r) => r.id === e.target.value);
                    if (res && res.zoneId) setSelectedZoneId(res.zoneId);
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-foreground focus:outline-none"
                >
                  <option value="">-- Choose resource --</option>
                  {resources
                    .filter((r) => r.status === 'available' && r.availableQuantity > 0)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.availableQuantity} available)
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-foreground">{t.selectIncident}</label>
                <select
                  value={selectedIncidentId}
                  onChange={(e) => setSelectedIncidentId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-foreground focus:outline-none"
                >
                  <option value="">General Area Deployment (No specific incident)</option>
                  {incidents.map((inc) => (
                    <option key={inc.id} value={inc.id}>
                      {inc.type} - {inc.description ? inc.description.slice(0, 30) : 'Incident'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-foreground">Target Zone</label>
                <select
                  value={selectedZoneId}
                  onChange={(e) => setSelectedZoneId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-foreground focus:outline-none"
                >
                  <option value="">-- None / General --</option>
                  {riskZones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-foreground">{t.selectQuantity}</label>
                <input
                  type="number"
                  min="1"
                  max={resources.find((r) => r.id === selectedResourceId)?.availableQuantity || 1}
                  value={allocateQty}
                  onChange={(e) => setAllocateQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-foreground focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowAllocateModal(false)}
                  className="px-4 py-2 rounded-xl border border-border text-muted-foreground hover:bg-secondary transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={!isOnline || isSubmitting || !selectedResourceId}
                  className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {t.confirmAllocation}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Register New Resource */}
      {showAddResourceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="glass-card w-full max-w-md p-6 rounded-2xl border border-border shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" />
                {t.addResource}
              </h3>
              <button onClick={() => setShowAddResourceModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveResource} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1 text-foreground">{t.resourceName} *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., BMC Flood Dewatering Pump 1"
                  value={newResName}
                  onChange={(e) => setNewResName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-foreground focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold mb-1 text-foreground">{t.resourceType} *</label>
                  <select
                    value={newResType}
                    onChange={(e) => setNewResType(e.target.value as ResourceType)}
                    className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-foreground focus:outline-none"
                  >
                    {RESOURCE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-foreground">{t.quantity} *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={newResQty}
                    onChange={(e) => setNewResQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-foreground focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-foreground">{t.filterByZone}</label>
                <select
                  value={newResZoneId}
                  onChange={(e) => setNewResZoneId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-foreground focus:outline-none"
                >
                  <option value="">-- General Mumbai Inventory --</option>
                  {riskZones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold mb-1 text-foreground">Latitude (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. 19.0988"
                    value={newResLat}
                    onChange={(e) => setNewResLat(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-foreground focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1 text-foreground">Longitude (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. 72.8267"
                    value={newResLon}
                    onChange={(e) => setNewResLon(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-foreground focus:outline-none"
                  />
                </div>
              </div>

              {newResType === 'shelter_capacity' && (
                <div>
                  <label className="block font-semibold mb-1 text-foreground">Shelter Capacity (Persons)</label>
                  <input
                    type="number"
                    placeholder="e.g. 500"
                    value={newResCapacity}
                    onChange={(e) => setNewResCapacity(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-foreground focus:outline-none"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowAddResourceModal(false)}
                  className="px-4 py-2 rounded-xl border border-border text-muted-foreground hover:bg-secondary transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={!isOnline || isSubmitting || !newResName.trim()}
                  className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {t.saveResource}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Rejection Prompt */}
      {rejectingAllocId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="glass-card w-full max-w-sm p-5 rounded-2xl border border-border shadow-xl space-y-3">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-warning" />
              {t.reject} Allocation
            </h3>
            <p className="text-xs text-muted-foreground">
              Are you sure you want to reject this allocation? The resource will remain in inventory.
            </p>
            <div>
              <label className="block text-[11px] font-semibold mb-1 text-foreground">
                {t.rejectionReasonPrompt}
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={2}
                placeholder="e.g. Resource required for higher priority incident or inaccessible route"
                className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border text-xs text-foreground focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setRejectingAllocId(null)}
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-secondary"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={handleConfirmRejection}
                disabled={!isOnline}
                className="px-3 py-1.5 rounded-lg bg-danger text-danger-foreground text-xs font-semibold hover:bg-danger/90"
              >
                {t.reject}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
