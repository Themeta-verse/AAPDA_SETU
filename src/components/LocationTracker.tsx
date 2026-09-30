import { motion } from 'framer-motion';
import { MapPin, Navigation, Compass, AlertTriangle, Locate } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import { useGeolocation, JUHU_BEACH } from '@/hooks/useGeolocation';
import { type RiskLevel } from '@/lib/monitoringData';

interface LocationTrackerProps {
  language: Language;
  riskLevel: RiskLevel;
}

const locationLabels: Record<Language, {
  title: string; yourLocation: string; distance: string; direction: string;
  accuracy: string; requestLocation: string; moveInland: string; youAreSafe: string;
  exerciseCaution: string; evacuateNow: string; nearestSafeZone: string;
}> = {
  en: {
    title: 'GPS Location & Distance', yourLocation: 'Your Location', distance: 'Distance from Juhu Beach',
    direction: 'Recommended Direction', accuracy: 'Accuracy', requestLocation: 'Enable GPS Tracking',
    moveInland: 'Move inland immediately', youAreSafe: 'You are at a safe distance',
    exerciseCaution: 'Exercise caution — you are near the coast', evacuateNow: 'EVACUATE NOW — you are in the danger zone',
    nearestSafeZone: 'Nearest Safe Zone: JVPD Ground (1.2 km inland)',
  },
  hi: {
    title: 'GPS स्थान और दूरी', yourLocation: 'आपका स्थान', distance: 'जुहू बीच से दूरी',
    direction: 'अनुशंसित दिशा', accuracy: 'सटीकता', requestLocation: 'GPS ट्रैकिंग सक्षम करें',
    moveInland: 'तुरंत अंतर्देशीय जाएं', youAreSafe: 'आप सुरक्षित दूरी पर हैं',
    exerciseCaution: 'सावधानी बरतें — आप तट के पास हैं', evacuateNow: 'अभी निकासी करें — आप खतरे के क्षेत्र में हैं',
    nearestSafeZone: 'निकटतम सुरक्षित क्षेत्र: JVPD मैदान (1.2 km)',
  },
  mr: {
    title: 'GPS स्थान आणि अंतर', yourLocation: 'तुमचे स्थान', distance: 'जुहू बीचपासून अंतर',
    direction: 'शिफारस केलेली दिशा', accuracy: 'अचूकता', requestLocation: 'GPS ट्रॅकिंग सुरू करा',
    moveInland: 'ताबडतोब अंतर्देशीय जा', youAreSafe: 'तुम्ही सुरक्षित अंतरावर आहात',
    exerciseCaution: 'सावधगिरी बाळगा — तुम्ही किनाऱ्याजवळ आहात', evacuateNow: 'आता निर्वासन करा — तुम्ही धोक्याच्या क्षेत्रात आहात',
    nearestSafeZone: 'जवळचे सुरक्षित क्षेत्र: JVPD मैदान (1.2 km)',
  },
  gu: {
    title: 'GPS સ્થાન અને અંતર', yourLocation: 'તમારું સ્થાન', distance: 'જુહુ બીચથી અંતર',
    direction: 'ભલામણ કરેલ દિશા', accuracy: 'ચોકસાઈ', requestLocation: 'GPS ટ્રેકિંગ સક્ષમ કરો',
    moveInland: 'તરત અંદરની તરફ જાઓ', youAreSafe: 'તમે સુરક્ષિત અંતરે છો',
    exerciseCaution: 'સાવધાની રાખો — તમે કિનારા પાસે છો', evacuateNow: 'હમણાં ખાલી કરો — તમે ખતરાના ઝોનમાં છો',
    nearestSafeZone: 'નજીકનો સુરક્ષિત ઝોન: JVPD મેદાન (1.2 km)',
  },
};

export function LocationTracker({ language, riskLevel }: LocationTrackerProps) {
  const ll = locationLabels[language];
  const { position, error, loading, permissionGranted, requestLocation, distanceFromBeach, evacuationDirection } = useGeolocation();

  const getDistanceStatus = () => {
    if (!distanceFromBeach) return null;
    if (distanceFromBeach < 1) return { text: ll.evacuateNow, color: 'text-danger', bg: 'bg-danger/10 border-danger/30' };
    if (distanceFromBeach < 3) return { text: ll.exerciseCaution, color: 'text-warning', bg: 'bg-warning/10 border-warning/30' };
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
              distanceFromBeach && distanceFromBeach < 1 ? 'text-danger' :
              distanceFromBeach && distanceFromBeach < 3 ? 'text-warning' : 'text-safe'
            }`}>
              {distanceFromBeach ? `${distanceFromBeach.toFixed(1)} km` : '—'}
            </p>
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
              <AlertTriangle className="w-4 h-4 text-safe" />
              <span className="text-xs text-muted-foreground">Safe Zone</span>
            </div>
            <p className="text-xs font-medium">{ll.nearestSafeZone}</p>
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
