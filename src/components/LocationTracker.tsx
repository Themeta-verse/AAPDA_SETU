import { motion } from 'framer-motion';
import { Navigation, MapPin, Compass, Locate, Loader2, Info } from 'lucide-react';
import { type Language } from '@/lib/translations';
import { useGeolocation, MONITORED_POINT_LABEL } from '@/hooks/useGeolocation';
import { formatDistance } from '@/lib/geo';

/**
 * Where you are, relative to the monitored coast.
 *
 * ===================================================================
 * WHAT THIS COMPONENT NO LONGER CLAIMS
 * ===================================================================
 *
 * The previous version of this component contained three fabrications:
 *
 * 1. A hardcoded "nearest safe zone" string, identical in all four languages,
 *    reading "JVPD Maidan (1.2 km)". The 1.2 km was a literal in a translation
 *    table. It was not measured, and it did not change with the user's position.
 *
 * 2. A safety verdict derived from distance alone. Under 1 km rendered
 *    "Evacuate now", under 3 km "Exercise caution", beyond that "You are safe".
 *    Distance from a beach is not a safety determination: a user 500 m inland
 *    can be in worse danger than one on the sand during a cyclone surge, and
 *    "you are safe" is not a conclusion this application is entitled to.
 *
 * 3. A compass direction computed toward two hardcoded numbers, 72.84 and 19.1,
 *    which are not any destination's coordinates.
 *
 * What remains is the genuinely useful part: your real position, your real fix
 * accuracy, and your real distance from the monitored beach point — stated as
 * geography, not as a verdict. Routing and real destinations live in
 * `EvacuationMap`, which queries OpenStreetMap and OSRM for them.
 */

interface LocationTrackerProps {
  language: Language;
  riskLevel: string | null;
}

const LABELS: Record<Language, {
  title: string;
  yourLocation: string;
  accuracy: string;
  distance: string;
  fromMonitored: string;
  requestLocation: string;
  locating: string;
  noFixTitle: string;
}> = {
  en: {
    title: 'Your location',
    yourLocation: 'Position',
    accuracy: 'Accuracy',
    distance: 'Distance from the coast',
    fromMonitored: 'straight-line from ' + MONITORED_POINT_LABEL,
    requestLocation: 'Use my location',
    locating: 'Locating…',
    noFixTitle: 'Location not shared',
  },
  hi: {
    title: 'आपकी स्थिति',
    yourLocation: 'स्थिति',
    accuracy: 'सटीकता',
    distance: 'तट से दूरी',
    fromMonitored: MONITORED_POINT_LABEL + ' से सीधी दूरी',
    requestLocation: 'मेरी स्थिति का उपयोग करें',
    locating: 'स्थान खोजा जा रहा है…',
    noFixTitle: 'स्थिति साझा नहीं की गई',
  },
  mr: {
    title: 'तुमचे स्थान',
    yourLocation: 'स्थान',
    accuracy: 'अचूकता',
    distance: 'किनाऱ्यापासून अंतर',
    fromMonitored: MONITORED_POINT_LABEL + ' पासून थेट अंतर',
    requestLocation: 'माझे स्थान वापरा',
    locating: 'स्थान शोधत आहे…',
    noFixTitle: 'स्थान शेअर केलेले नाही',
  },
  gu: {
    title: 'તમારું સ્થાન',
    yourLocation: 'સ્થાન',
    accuracy: 'ચોકસાઈ',
    distance: 'કિનારાથી અંતર',
    fromMonitored: MONITORED_POINT_LABEL + ' થી સીધું અંતર',
    requestLocation: 'મારું સ્થાન વાપરો',
    locating: 'સ્થાન શોધી રહ્યું છે…',
    noFixTitle: 'સ્થાન શેર કર્યું નથી',
  },
};

export function LocationTracker({ language }: LocationTrackerProps) {
  const ll = LABELS[language];
  const geo = useGeolocation();

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
                {geo.status === 'locating' ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Locate className="w-4 h-4" aria-hidden="true" />
                )}
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
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Navigation className="w-6 h-6 text-primary" aria-hidden="true" />
          {ll.title}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="glass-card p-4 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-4 h-4 text-primary" aria-hidden="true" />
              <span className="text-xs text-muted-foreground">{ll.yourLocation}</span>
            </div>
            <p className="text-sm font-mono font-bold" data-testid="tracker-coords">
              {geo.formatted}
            </p>
            {geo.accuracyLabel && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {ll.accuracy}: {geo.accuracyLabel}
              </p>
            )}
            {geo.isStale && (
              <p className="text-[10px] text-warning mt-1">
                This fix is {geo.ageSeconds}s old and may no longer be accurate.
              </p>
            )}
          </div>

          <div className="glass-card p-4 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Compass className="w-4 h-4 text-primary" aria-hidden="true" />
              <span className="text-xs text-muted-foreground">{ll.distance}</span>
            </div>
            <p className="text-2xl font-bold font-mono" data-testid="tracker-distance">
              {formatDistance(geo.distanceToMonitoredM) ?? '—'}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">{ll.fromMonitored}</p>
          </div>

          {/*
            A real safety verdict needs a real hazard model, not a distance. The
            canonical risk verdict is shown instead, sourced from the engine, and
            it is `null` when it genuinely could not be determined.
          */}
          <div className="glass-card p-4 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-primary" aria-hidden="true" />
              <span className="text-xs text-muted-foreground">Coastal risk</span>
            </div>
            <p className="text-sm font-bold" data-testid="tracker-risk-note">
              See the command centre above
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Distance from the coast is not a safety determination. Use the risk verdict and any
              official instruction.
            </p>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
