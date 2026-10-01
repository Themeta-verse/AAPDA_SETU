import { motion } from 'framer-motion';
import { MapPin, Navigation, Compass, Locate, ShieldCheck, Info } from 'lucide-react';
import { type Language } from '@/lib/translations';
import {
  useGeolocation,
  calculateDistance,
  getEvacuationDirectionTo,
} from '@/hooks/useGeolocation';
import { type RiskLevelOrUnknown } from '@/lib/monitoringData';

/**
 * Where you are, relative to the monitored zone.
 *
 * WHAT THIS NO LONGER CLAIMS
 * --------------------------
 * The previous version derived a safety verdict from distance alone: under
 * 1 km rendered "EVACUATE NOW", under 3 km "Exercise caution", beyond that
 * "You are safe". Distance from a zone centre is not a safety determination,
 * and "you are safe" is not a conclusion this application is entitled to.
 * Those verdicts are removed. What remains is geography stated as geography:
 * your real position, your real fix accuracy, your real distance to the zone
 * target, and a real compass direction to a real configured safe location.
 *
 * The zone risk tier (passed in from the monitoring pipeline) is shown as
 * data, not derived here.
 */

interface LocationTrackerProps {
  language: Language;
  riskLevel: RiskLevelOrUnknown;
  zoneName?: string;
  targetLat?: number;
  targetLon?: number;
  nearestSafeLocation?: {
    name: string;
    latitude: number;
    longitude: number;
  } | null;
}

const locationLabels: Record<Language, {
  title: string; yourLocation: string; distance: string; direction: string;
  accuracy: string; requestLocation: string; locating: string;
  nearestSafeZone: string; zoneRisk: string; noSafeZone: string;
  staleFix: string; noFixTitle: string;
}> = {
  en: {
    title: 'GPS Location & Distance', yourLocation: 'Your Location', distance: 'Distance to Zone Target',
    direction: 'Direction to Safe Location', accuracy: 'Accuracy', requestLocation: 'Enable GPS Tracking',
    locating: 'Locating…', nearestSafeZone: 'Nearest Safe Zone', zoneRisk: 'Zone Risk (monitoring)',
    noSafeZone: 'No safe location configured for this zone',
    staleFix: 'This fix is old and may no longer be accurate.',
    noFixTitle: 'Location not shared',
  },
  hi: {
    title: 'GPS स्थान और दूरी', yourLocation: 'आपका स्थान', distance: 'क्षेत्र लक्ष्य से दूरी',
    direction: 'सुरक्षित स्थान की दिशा', accuracy: 'सटीकता', requestLocation: 'GPS ट्रैकिंग सक्षम करें',
    locating: 'स्थान खोजा जा रहा है…', nearestSafeZone: 'निकटतम सुरक्षित स्थान', zoneRisk: 'क्षेत्र जोखिम (निगरानी)',
    noSafeZone: 'इस क्षेत्र के लिए कोई सुरक्षित स्थान कॉन्फ़िगर नहीं है',
    staleFix: 'यह स्थिति पुरानी है और अब सटीक नहीं हो सकती।',
    noFixTitle: 'स्थिति साझा नहीं की गई',
  },
  mr: {
    title: 'GPS स्थान आणि अंतर', yourLocation: 'तुमचे स्थान', distance: 'विभाग लक्ष्यापासून अंतर',
    direction: 'सुरक्षित ठिकाणाची दिशा', accuracy: 'अचूकता', requestLocation: 'GPS ट्रॅकिंग सुरू करा',
    locating: 'स्थान शोधत आहे…', nearestSafeZone: 'जवळचे सुरक्षित ठिकाण', zoneRisk: 'विभाग जोखीम (निरीक्षण)',
    noSafeZone: 'या विभागासाठी कोणतेही सुरक्षित ठिकाण कॉन्फ़िगर केलेले नाही',
    staleFix: 'ही स्थिती जुनी आहे आणि कदाचित अचूक नसेल।',
    noFixTitle: 'स्थान शेअर केलेले नाही',
  },
  gu: {
    title: 'GPS સ્થાન અને અંતર', yourLocation: 'તમારું સ્થાન', distance: 'ઝોન લક્ષ્યથી અંતર',
    direction: 'સુરક્ષિત સ્થાનની દિશા', accuracy: 'ચોકસાઈ', requestLocation: 'GPS ટ્રેકિંગ સક્ષમ કરો',
    locating: 'સ્થાન શોધી રહ્યું છે…', nearestSafeZone: 'નજીકનું સુરક્ષિત સ્થાન', zoneRisk: 'ઝોન જોખમ (મોનિટરિંગ)',
    noSafeZone: 'આ ઝોન માટે કોઈ સુરક્ષિત સ્થાન ગોઠવેલ નથી',
    staleFix: 'આ સ્થિતિ જૂની છે અને હવે સચોટ ન પણ હોય।',
    noFixTitle: 'સ્થાન શેર કર્યું નથી',
  },
};

export function LocationTracker({
  language,
  riskLevel,
  zoneName,
  targetLat = 19.0988,
  targetLon = 72.8267,
  nearestSafeLocation,
}: LocationTrackerProps) {
  const ll = locationLabels[language];
  const geo = useGeolocation();

  // Real straight-line distance to the zone target, kilometres. Geography,
  // not a verdict.
  const distanceToTargetKm =
    geo.position !== null
      ? calculateDistance(geo.position.latitude, geo.position.longitude, targetLat, targetLon)
      : null;

  const safeZoneDistanceKm =
    geo.position !== null && nearestSafeLocation
      ? calculateDistance(
          geo.position.latitude,
          geo.position.longitude,
          nearestSafeLocation.latitude,
          nearestSafeLocation.longitude
        )
      : null;

  // Real compass direction to a real configured destination. Null when either
  // endpoint is unknown — never a direction toward a hardcoded point.
  const safeZoneDirection =
    geo.position !== null && nearestSafeLocation
      ? getEvacuationDirectionTo(
          geo.position.latitude,
          geo.position.longitude,
          nearestSafeLocation.latitude,
          nearestSafeLocation.longitude
        )
      : null;

  if (!geo.hasFix) {
    return (
      <section className="container py-6" aria-label={ll.title}>
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <Locate className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <h2 className="text-sm font-semibold mb-1">{ll.noFixTitle}</h2>
              <p className="text-xs text-muted-foreground mb-3" data-testid="tracker-gps-message">
                {geo.statusMessage}
              </p>
              <button
                type="button"
                onClick={geo.requestLocation}
                disabled={geo.status === 'locating' || geo.status === 'unsupported'}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60"
                data-testid="tracker-request-location"
              >
                {geo.status === 'locating' ? ll.locating : ll.requestLocation}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="container py-6" aria-label={ll.title}>
      <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Navigation className="w-6 h-6 text-primary" aria-hidden="true" />
          {ll.title}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Your location */}
          <div className="glass-card p-4 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-4 h-4 text-primary" aria-hidden="true" />
              <span className="text-xs text-muted-foreground">{ll.yourLocation}</span>
            </div>
            <p className="text-sm font-mono font-bold" data-testid="tracker-coords">
              {geo.formatted ?? '—'}
            </p>
            {geo.accuracyLabel && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {ll.accuracy}: {geo.accuracyLabel}
              </p>
            )}
            {geo.isStale && (
              <p className="text-[10px] text-warning mt-1">{ll.staleFix}</p>
            )}
          </div>

          {/* Distance to zone target */}
          <div className="glass-card p-4 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Compass className="w-4 h-4 text-warning" aria-hidden="true" />
              <span className="text-xs text-muted-foreground">{ll.distance}</span>
            </div>
            <p className="text-2xl font-bold font-mono" data-testid="tracker-distance">
              {distanceToTargetKm !== null ? `${distanceToTargetKm.toFixed(1)} km` : '—'}
            </p>
            {zoneName && <p className="text-[10px] text-muted-foreground mt-1">Target: {zoneName}</p>}
          </div>

          {/* Direction to the configured safe location */}
          <div className="glass-card p-4 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Navigation className="w-4 h-4 text-safe" aria-hidden="true" />
              <span className="text-xs text-muted-foreground">{ll.direction}</span>
            </div>
            <p className="text-sm font-bold">{safeZoneDirection ?? '—'}</p>
            {nearestSafeLocation ? (
              <p className="text-[10px] text-muted-foreground mt-1">
                {nearestSafeLocation.name}
                {safeZoneDistanceKm !== null ? ` · ${safeZoneDistanceKm.toFixed(1)} km` : ''}
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-1">{ll.noSafeZone}</p>
            )}
          </div>

          {/* Zone risk tier from the monitoring pipeline, shown as data */}
          <div className="glass-card p-4 rounded-xl border-safe/20">
            <div className="flex items-center gap-2 mb-2">
              {riskLevel === null ? (
                <Info className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-safe" aria-hidden="true" />
              )}
              <span className="text-xs text-muted-foreground">{ll.zoneRisk}</span>
            </div>
            <p className="text-sm font-bold" data-testid="tracker-risk-note">
              {riskLevel === null ? 'Unknown — no verdict' : riskLevel}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Distance from the zone is not a safety determination. Follow official instruction.
            </p>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
