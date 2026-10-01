import { motion } from 'framer-motion';
import {
  Map,
  MapPin,
  Building,
  Shield,
  Navigation,
  ExternalLink,
  Hospital,
  Siren,
  Flame,
  Users,
  CheckCircle2,
  Clock,
  AlertCircle,
  Compass,
} from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import type { SafeLocation } from '@/lib/urbanContext';

interface EvacuationMapProps {
  language: Language;
  zoneName?: string;
  cityName?: string;
  wardName?: string;
  centerLat?: number;
  centerLon?: number;
  isCoastal?: boolean;
  safeLocations?: SafeLocation[];
}

const mapLabels: Record<string, Record<string, string>> = {
  en: {
    openMap: 'Open Full Map',
    directions: 'Directions',
    capacity: 'Capacity',
    verified: 'Verified Shelter / Safe Location',
    emptyTitle: 'No configured evacuation locations for this area.',
    emptySubtitle: 'Safe assembly points, relief centers, and designated shelters have not been configured for this zone. In an immediate emergency, move to elevated ground or follow local disaster authority instructions.',
    coastalHazard: 'Coastal Surge Hazard Area',
    inlandHazard: 'Low-Lying Urban Flood / Waterlogging Risk',
  },
  hi: {
    openMap: 'पूरा नक्शा खोलें',
    directions: 'दिशा-निर्देश',
    capacity: 'क्षमता',
    verified: 'सत्यापित सुरक्षित स्थल / आश्रय',
    emptyTitle: 'इस क्षेत्र के लिए कोई निकासी स्थल कॉन्फ़िगर नहीं है।',
    emptySubtitle: 'इस क्षेत्र के लिए सुरक्षित सभा स्थल या राहत केंद्र कॉन्फ़िगर नहीं किए गए हैं। आपातकाल में ऊंचे स्थान पर जाएं।',
    coastalHazard: 'तटीय लहर खतरा क्षेत्र',
    inlandHazard: 'निचला शहरी बाढ़ / जलभराव जोखिम',
  },
  mr: {
    openMap: 'पूर्ण नकाशा उघडा',
    directions: 'मार्गदर्शन',
    capacity: 'क्षमता',
    verified: 'सत्यापित सुरक्षित ठिकाण / निवारा',
    emptyTitle: 'या क्षेत्रासाठी कोणतीही निर्वासन स्थाने कॉन्फिगर केलेली नाहीत.',
    emptySubtitle: 'या क्षेत्रासाठी सुरक्षित संमेलन स्थळे किंवा निवारे कॉन्फिगर केलेले नाहीत. आणीबाणीत उंच जागी जा.',
    coastalHazard: 'किनारपट्टी लाट धोका क्षेत्र',
    inlandHazard: 'सखल शहरी पूर / पाणी साचण्याचा धोका',
  },
  gu: {
    openMap: 'સંપૂર્ણ નકશો ખોલો',
    directions: 'દિશાઓ',
    capacity: 'ક્ષમતા',
    verified: 'ચકાસાયેલ સુરક્ષિત સ્થાન / આશ્રય',
    emptyTitle: 'આ વિસ્તાર માટે કોઈ સ્થળાંતર સ્થળો ગોઠવેલા નથી.',
    emptySubtitle: 'આ વિસ્તાર માટે સુરક્ષિત એસેમ્બલી પોઈન્ટ અથવા આશ્રયસ્થાનો ગોઠવેલા નથી.',
    coastalHazard: 'દરિયાકાંઠાના મોજાંનું જોખમ ક્ષેત્ર',
    inlandHazard: 'નીચાણવાળા શહેરી પૂર / પાણી ભરાવાનું જોખમ',
  },
};

function getLocationTypeIcon(type: SafeLocation['locationType']) {
  switch (type) {
    case 'hospital':
      return Hospital;
    case 'police_station':
      return Siren;
    case 'fire_station':
      return Flame;
    case 'assembly_point':
      return Users;
    case 'shelter':
    case 'relief_center':
    default:
      return Building;
  }
}

function getLocationTypeBadge(type: SafeLocation['locationType']) {
  switch (type) {
    case 'hospital':
      return { label: 'Medical / Hospital', bg: 'bg-warning/10 text-warning border-warning/20' };
    case 'police_station':
      return { label: 'Police Station', bg: 'bg-primary/10 text-primary border-primary/20' };
    case 'fire_station':
      return { label: 'Fire Service', bg: 'bg-danger/10 text-danger border-danger/20' };
    case 'assembly_point':
      return { label: 'Assembly Point', bg: 'bg-safe/10 text-safe border-safe/20' };
    case 'shelter':
    case 'relief_center':
    default:
      return { label: 'Relief Shelter', bg: 'bg-safe/10 text-safe border-safe/20' };
  }
}

export function EvacuationMap({
  language,
  zoneName = 'Juhu Coastal Zone',
  cityName = 'Mumbai',
  wardName = 'K-West',
  centerLat = 19.0988,
  centerLon = 72.8267,
  isCoastal = true,
  safeLocations = [],
}: EvacuationMapProps) {
  const t = translations[language];
  const ml = mapLabels[language] || mapLabels.en;

  const deltaLat = 0.015;
  const deltaLon = 0.018;
  const minLon = (centerLon - deltaLon).toFixed(4);
  const minLat = (centerLat - deltaLat).toFixed(4);
  const maxLon = (centerLon + deltaLon).toFixed(4);
  const maxLat = (centerLat + deltaLat).toFixed(4);

  const osmUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}&layer=mapnik&marker=${centerLat}%2C${centerLon}`;
  const osmLink = `https://www.openstreetmap.org/?mlat=${centerLat}&mlon=${centerLon}#map=15/${centerLat}/${centerLon}`;

  return (
    <section id="evacuation" className="container py-8" aria-label={t.evacuationMap}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Map className="w-6 h-6 text-primary" />
            {t.evacuationMap}
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            {zoneName} · {wardName} ({cityName}) — {isCoastal ? ml.coastalHazard : ml.inlandHazard}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-mono">
            {centerLat.toFixed(4)}°N, {centerLon.toFixed(4)}°E
          </span>
        </div>
      </div>

      {/* OpenStreetMap dynamic embed */}
      <div className="glass-card rounded-2xl overflow-hidden border-border mb-6">
        <div className="relative w-full h-[300px] sm:h-[400px]">
          <iframe
            src={osmUrl}
            className="absolute inset-0 w-full h-full border-0"
            loading="lazy"
            title={`${zoneName} Map`}
            allowFullScreen
          />
        </div>
        <div className="p-3 flex items-center justify-between border-t border-border/50 bg-card/60 backdrop-blur-sm">
          <span className="text-xs text-muted-foreground">
            © OpenStreetMap contributors · {zoneName} ({cityName})
          </span>
          <a
            href={osmLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline font-semibold"
          >
            {ml.openMap} <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Safe Locations & Shelters Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Shield className="w-5 h-5 text-safe" />
            Verified Safe Locations & Assembly Points ({safeLocations.length})
          </h3>
        </div>

        {safeLocations.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground border border-dashed rounded-2xl bg-card/40">
            <Shield className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
            <h4 className="font-semibold text-base text-foreground mb-1">
              {ml.emptyTitle}
            </h4>
            <p className="text-xs max-w-lg mx-auto text-muted-foreground leading-relaxed">
              {ml.emptySubtitle}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {safeLocations.map((loc) => {
              const Icon = getLocationTypeIcon(loc.locationType);
              const badge = getLocationTypeBadge(loc.locationType);
              const directionsUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${centerLat}%2C${centerLon}%3B${loc.latitude}%2C${loc.longitude}`;

              return (
                <motion.div
                  key={loc.id}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  className="glass-card p-4 rounded-xl border-border flex flex-col justify-between hover:border-primary/40 transition-colors"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-card border border-border text-primary">
                          <Icon className="w-4 h-4" />
                        </div>
                        <h4 className="font-semibold text-sm leading-tight text-foreground">
                          {loc.name}
                        </h4>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${badge.bg} whitespace-nowrap`}>
                        {badge.label}
                      </span>
                    </div>

                    {loc.address && (
                      <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                        <MapPin className="w-3 h-3 flex-shrink-0 text-muted-foreground/70" />
                        <span className="truncate">{loc.address}</span>
                      </p>
                    )}

                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground my-2">
                      {loc.capacity && (
                        <span className="font-mono">
                          {ml.capacity}: <strong className="text-foreground">{loc.capacity}</strong>
                        </span>
                      )}
                      <span className="font-mono text-muted-foreground/80">
                        {loc.latitude.toFixed(4)}°N, {loc.longitude.toFixed(4)}°E
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-border/50 flex items-center justify-between mt-2">
                    <span className="flex items-center gap-1 text-[11px] text-safe font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {loc.isActive ? 'Operational' : 'Standby'}
                    </span>
                    <a
                      href={directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-primary hover:underline font-semibold"
                    >
                      {ml.directions} <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
