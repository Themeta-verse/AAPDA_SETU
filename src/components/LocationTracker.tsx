import { motion } from 'framer-motion';
import { MapPin, Navigation, Compass, AlertTriangle, Locate, ShieldCheck } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import { useGeolocation, calculateDistance } from '@/hooks/useGeolocation';
import { type RiskLevel } from '@/lib/monitoringData';

interface LocationTrackerProps {
  language: Language;
  riskLevel: RiskLevel;
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
  accuracy: string; requestLocation: string; moveInland: string; youAreSafe: string;
  exerciseCaution: string; evacuateNow: string; nearestSafeZone: string;
}> = {
  en: {
    title: 'GPS Location & Distance', yourLocation: 'Your Location', distance: 'Distance to Risk Zone',
    direction: 'Recommended Direction', accuracy: 'Accuracy', requestLocation: 'Enable GPS Tracking',
    moveInland: 'Move to safe zone immediately', youAreSafe: 'You are at a safe distance',
    exerciseCaution: 'Exercise caution — you are near the risk zone', evacuateNow: 'EVACUATE NOW — you are in the risk zone',
    nearestSafeZone: 'Nearest Safe Zone',
  },
  hi: {
    title: 'GPS स्थान और दूरी', yourLocation: 'आपका स्थान', distance: 'जोखिम क्षेत्र से दूरी',
    direction: 'अनुशंसित दिशा', accuracy: 'सटीकता', requestLocation: 'GPS ट्रैकिंग सक्षम करें',
    moveInland: 'तुरंत सुरक्षित क्षेत्र में जाएं', youAreSafe: 'आप सुरक्षित दूरी पर हैं',
    exerciseCaution: 'सावधानी बरतें — आप जोखिम क्षेत्र के करीब हैं', evacuateNow: 'अभी निकासी करें — आप जोखिम क्षेत्र में हैं',
    nearestSafeZone: 'निकटतम सुरक्षित क्षेत्र',
  },
  mr: {
    title: 'GPS स्थान आणि अंतर', yourLocation: 'तुमचे स्थान', distance: 'धोका क्षेत्रापासून अंतर',
    direction: 'शिफारस केलेली दिशा', accuracy: 'अचूकता', requestLocation: 'GPS ट्रॅकिंग सुरू करा',
    moveInland: 'ताबडतोब सुरक्षित भागात जा', youAreSafe: 'तुम्ही सुरक्षित अंतरावर आहात',
    exerciseCaution: 'सावधगिरी बाळगा — तुम्ही धोक्याच्या क्षेत्राजवळ आहात', evacuateNow: 'आता निर्वासन करा — तुम्ही धोक्याच्या क्षेत्रात आहात',
    nearestSafeZone: 'जवळचे सुरक्षित क्षेत्र',
  },
  gu: {
    title: 'GPS સ્થાન અને અંતર', yourLocation: 'તમારું સ્થાન', distance: 'જોખમ ઝોનથી અંતર',
    direction: 'ભલામણ કરેલ દિશા', accuracy: 'ચોકસાઈ', requestLocation: 'GPS ટ્રેકિંગ સક્ષમ કરો',
    moveInland: 'તરત સુરક્ષિત વિસ્તારમાં જાઓ', youAreSafe: 'તમે સુરક્ષિત અંતરે છો',
    exerciseCaution: 'સાવધાની રાખો — તમે જોખમી ઝોન પાસે છો', evacuateNow: 'હમણાં ખાલી કરો — તમે જોખમી ઝોનમાં છો',
    nearestSafeZone: 'નજીકનો સુરક્ષિત ઝોન',
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
  const { position, error, loading, permissionGranted, requestLocation, distanceToHazard, evacuationDirection } = useGeolocation(
    { latitude: targetLat, longitude: targetLon, name: zoneName },
    nearestSafeLocation ? { latitude: nearestSafeLocation.latitude, longitude: nearestSafeLocation.longitude, name: nearestSafeLocation.name } : null
  );

  const safeZoneDistance = position && nearestSafeLocation
    ? calculateDistance(position.latitude, position.longitude, nearestSafeLocation.latitude, nearestSafeLocation.longitude)
    : null;

  const getDistanceStatus = () => {
    if (distanceToHazard === null) return null;
    if (distanceToHazard < 1) return { text: ll.evacuateNow, color: 'text-danger', bg: 'bg-danger/10 border-danger/30' };
    if (distanceToHazard < 3) return { text: ll.exerciseCaution, color: 'text-warning', bg: 'bg-warning/10 border-warning/30' };
    return { text: ll.youAreSafe, color: 'text-safe', bg: 'bg-safe/10 border-safe/30' };
  };

  const status = getDistanceStatus();

  if (!permissionGranted) {
    return (
      <section className="container py-6">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={requestLocation}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 p-4 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
        >
          <Locate className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm">{ll.requestLocation}</span>
        </motion.button>
      </section>
    );
  }

  return (
    <section className="container py-6" aria-label={ll.title}>
      <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Navigation className="w-6 h-6 text-primary" />
          {ll.title}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Your location */}
          <div className="glass-card p-4 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">{ll.yourLocation}</span>
            </div>
            <p className="text-sm font-mono font-bold">
              {position ? `${position.latitude.toFixed(4)}°N, ${position.longitude.toFixed(4)}°E` : '—'}
            </p>
            {position && (
              <p className="text-[10px] text-muted-foreground mt-1">{ll.accuracy}: ±{Math.round(position.accuracy)}m</p>
            )}
          </div>

          {/* Distance */}
          <div className="glass-card p-4 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Compass className="w-4 h-4 text-warning" />
              <span className="text-xs text-muted-foreground">{ll.distance}</span>
            </div>
            <p className={`text-2xl font-bold font-mono ${
              distanceToHazard !== null && distanceToHazard < 1 ? 'text-danger' :
              distanceToHazard !== null && distanceToHazard < 3 ? 'text-warning' : 'text-safe'
            }`}>
              {distanceToHazard !== null ? `${distanceToHazard.toFixed(1)} km` : '—'}
            </p>
            {zoneName && <p className="text-[10px] text-muted-foreground mt-1">Target: {zoneName}</p>}
          </div>

          {/* Direction */}
          <div className="glass-card p-4 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Navigation className="w-4 h-4 text-safe" />
              <span className="text-xs text-muted-foreground">{ll.direction}</span>
            </div>
            <p className="text-sm font-bold">{evacuationDirection || '—'}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{ll.moveInland}</p>
          </div>

          {/* Nearest safe zone */}
          <div className="glass-card p-4 rounded-xl border-safe/20">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-safe" />
              <span className="text-xs text-muted-foreground">{ll.nearestSafeZone}</span>
            </div>
            {nearestSafeLocation ? (
              <>
                <p className="text-xs font-medium text-foreground">{nearestSafeLocation.name}</p>
                <p className="text-[10px] text-safe font-semibold mt-1">
                  {safeZoneDistance !== null ? `${safeZoneDistance.toFixed(1)} km away` : 'Configured assembly point'}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">No safe zone configured in immediate area</p>
            )}
          </div>
        </div>

        {/* Status bar */}
        {status && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`mt-3 p-3 rounded-xl border ${status.bg} flex items-center gap-2`}
          >
            <AlertTriangle className={`w-4 h-4 ${status.color} flex-shrink-0`} />
            <span className={`text-sm font-semibold ${status.color}`}>{status.text}</span>
          </motion.div>
        )}
      </motion.div>
    </section>
  );
}
