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
} from 'lucide-react';
import { type Language } from '@/lib/translations';
import {
  useIncidentPhoto,
  useIncidents,
  type Incident,
} from '@/hooks/useIncidents';
import { useAppRole } from '@/hooks/useAppRole';
import type { User } from '@supabase/supabase-js';
import type { IncidentClientLike } from '@/integrations/supabase/incidents';

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

/**
 * Format a stored timestamp without inventing a timezone.
 *
 * The database column is `TIMESTAMPTZ` and PostgREST returns ISO-8601 with an
 * offset, so we parse and re-render in the viewer's local zone. An
 * unparseable value is shown verbatim rather than replaced with "now".
 */
function formatTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString();
}

export function IncidentIntelligence({ language, user, client }: IncidentIntelligenceProps) {
  const t = labels[language];
  const { isOperational, role, isSignedIn } = useAppRole(user);

  // Responder/admin see operational data. A citizen still gets their own
  // reports (RLS allows owner reads), but we do not present them as an
  // operational console.
  const { state, incidents, refetch, isRefreshing } = useIncidents(user, {
    client,
    enabled: isSignedIn,
  });

  const typeNames: Record<string, string> = {
    flooding: t.flooding,
    high_waves: t.highWaves,
    blocked_roads: t.blockedRoads,
    other: t.other,
  };

  const renderBody = () => {
    // Only an operational viewer gets the operational console. Everyone else
    // is told why, rather than being shown a partial view that implies they
    // are seeing everything.
    if (!isOperational) {
      return (
        <div
          className="flex flex-col items-center text-center py-10 px-4"
          role="status"
          data-testid="incident-role-notice"
        >
          <Lock className="w-8 h-8 text-muted-foreground mb-3" aria-hidden="true" />
          <p className="font-semibold text-foreground">{t.denied}</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">{t.deniedDesc}</p>
          <p className="text-xs text-muted-foreground/70 mt-3">
            Signed in as: {role}
          </p>
        </div>
      );
    }

    switch (state.kind) {
      case 'loading':
        return (
          <div
            className="flex flex-col items-center py-10 text-muted-foreground"
            role="status"
            data-testid="incident-loading"
          >
            <Loader2 className="w-6 h-6 animate-spin mb-2" aria-hidden="true" />
            <p className="text-sm">{t.loading}</p>
          </div>
        );

      case 'unauthenticated':
        return (
          <StateMessage
            testId="incident-unauthenticated"
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
            <ul className="space-y-3" data-testid="incident-list">
              {incidents.map((incident) => (
                <IncidentCard
                  key={incident.id}
                  incident={incident}
                  language={language}
                  typeNames={typeNames}
                  client={client}
                />
              ))}
            </ul>
          </>
        );

      default:
        return null;
    }
  };

  const showRefresh = isOperational && isSignedIn;

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

      {showRefresh && state.kind !== 'loading' && state.fetchedAt && (
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

function IncidentCard({
  incident,
  language,
  typeNames,
  client,
}: {
  incident: Incident;
  language: Language;
  typeNames: Record<string, string>;
  client?: IncidentClientLike;
}) {
  const t = labels[language];
  const { photo, load } = useIncidentPhoto();

  const Icon = incident.type ? typeIcon[incident.type] ?? FileWarning : FileWarning;
  const reportedAt = formatTimestamp(incident.createdAt);

  return (
    <li
      className="rounded-xl border border-border bg-background/40 p-4"
      data-testid="incident-card"
      data-incident-id={incident.id}
    >
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {/* Type. A value outside the known set is labelled, not coerced. */}
          <p className="font-semibold text-foreground text-sm">
            {incident.type ? typeNames[incident.type] : t.unknownType}
          </p>
          {incident.type === null && incident.rawType && (
            <p className="text-xs text-muted-foreground/80 font-mono break-all">
              {incident.rawType}
            </p>
          )}

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
