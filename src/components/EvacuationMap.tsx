import { useState } from 'react';
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
  AlertCircle,
  Layers,
  Crosshair,
  Package,
  AlertTriangle,
} from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import type { SafeLocation } from '@/lib/urbanContext';

export interface MapIncidentItem {
  id: string;
  type: string | null;
  latitude: number | null;
  longitude: number | null;
  description?: string | null;
  status?: string;
}

export interface MapResourceItem {
  id: string;
  name: string;
  resourceType: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  quantity?: number;
}

export interface MapZoneItem {
  id: string;
  name: string;
  city: string;
  ward: string | null;
  centerLat: number;
  centerLon: number;
  radiusKm: number;
  isCoastal: boolean;
}

interface EvacuationMapProps {
  language: Language;
  zoneName?: string;
  cityName?: string;
  wardName?: string;
  centerLat?: number;
  centerLon?: number;
  isCoastal?: boolean;
  safeLocations?: SafeLocation[];
  verifiedIncidents?: MapIncidentItem[];
  resources?: MapResourceItem[];
  riskZones?: MapZoneItem[];
  userGpsLocation?: { latitude: number; longitude: number } | null;
}

const mapLabels: Record<string, Record<string, string>> = {
  en: {
    openMap: 'Open Full Map',
    directions: 'Directions',
    capacity: 'Capacity',
    verified: 'Verified Shelter / Safe Location',
    emptyTitle: 'No configured evacuation locations for this area.',
    emptySubtitle:
      'Safe assembly points, relief centers, and designated shelters have not been configured for this zone. In an immediate emergency, move to elevated ground or follow local disaster authority instructions.',
    coastalHazard: 'Coastal Surge Hazard Area',
    inlandHazard: 'Low-Lying Urban Flood / Waterlogging Risk',
    geoUnavailable: 'GEOGRAPHIC RISK DATA UNAVAILABLE',
    geoUnavailableDesc: 'The selected area does not have verified geographic coordinates in the disaster database.',
  },
  hi: {
    openMap: 'पूरा नक्शा खोलें',
    directions: 'दिशा-निर्देश',
    capacity: 'क्षमता',
    verified: 'सत्यापित सुरक्षित स्थल / आश्रय',
    emptyTitle: 'इस क्षेत्र के लिए कोई निकासी स्थल कॉन्फ़िगर नहीं है।',
    emptySubtitle:
      'इस क्षेत्र के लिए सुरक्षित सभा स्थल या राहत केंद्र कॉन्फ़िगर नहीं किए गए हैं। आपातकाल में ऊंचे स्थान पर जाएं।',
    coastalHazard: 'तटीय लहर खतरा क्षेत्र',
    inlandHazard: 'निचला शहरी बाढ़ / जलभराव जोखिम',
    geoUnavailable: 'भौगोलिक जोखिम डेटा अनुपलब्ध है',
    geoUnavailableDesc: 'चयनित क्षेत्र के लिए आपदा डेटाबेस में सत्यापित निर्देशांक उपलब्ध नहीं हैं।',
  },
  mr: {
    openMap: 'पूर्ण नकाशा उघडा',
    directions: 'मार्गदर्शन',
    capacity: 'क्षमता',
    verified: 'सत्यापित सुरक्षित ठिकाण / निवारा',
    emptyTitle: 'या क्षेत्रासाठी कोणतीही निर्वासन स्थाने कॉन्फिगर केलेली नाहीत.',
    emptySubtitle:
      'या क्षेत्रासाठी सुरक्षित संमेलन स्थळे किंवा निवारे कॉन्फिगर केलेले नाहीत. आणीबाणीत उंच जागी जा.',
    coastalHazard: 'किनारपट्टी लाट धोका क्षेत्र',
    inlandHazard: 'सखल शहरी पूर / पाणी साचण्याचा धोका',
    geoUnavailable: 'भौगोलिक जोखीम डेटा अनुपलब्ध आहे',
    geoUnavailableDesc: 'निवडलेल्या क्षेत्रासाठी डेटाबेसमध्ये सत्यापित निर्देशांक नाहीत.',
  },
  gu: {
    openMap: 'સંપૂર્ણ નકશો ખોલો',
    directions: 'દિશાઓ',
    capacity: 'ક્ષમતા',
    verified: 'ચકાસાયેલ સુરક્ષિત સ્થાન / આશ્રય',
    emptyTitle: 'આ વિસ્તાર માટે કોઈ સ્થળાંતર સ્થળો ગોઠવેલા નથી.',
    emptySubtitle:
      'આ વિસ્તાર માટે સુરક્ષિત એસેમ્બલી પોઈન્ટ અથવા આશ્રયસ્થાનો ગોઠવેલા નથી.',
    coastalHazard: 'દરિયાકાંઠાના મોજાંનું જોખમ ક્ષેત્ર',
    inlandHazard: 'નીચાણવાળા શહેરી પૂર / પાણી ભરાવાનું જોખમ',
    geoUnavailable: 'ભૌગોલિક જોખમ ડેટા અનુપલબ્ધ છે',
    geoUnavailableDesc: 'પસંદ કરેલા વિસ્તાર માટે ડેટાબેઝમાં ચકાસાયેલ સંકલન ઉપલબ્ધ નથી.',
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
  centerLat,
  centerLon,
  isCoastal = true,
  safeLocations = [],
  verifiedIncidents = [],
  resources = [],
  riskZones = [],
  userGpsLocation = null,
}: EvacuationMapProps) {
  const t = translations[language];
  const ml = mapLabels[language] || mapLabels.en;

  // Layer Visibility State
  const [layers, setLayers] = useState({
    riskZones: true,
    verifiedIncidents: true,
    resources: true,
    safeLocations: true,
    userGps: true,
  });

  const toggleLayer = (layer: keyof typeof layers) => {
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  };

  const hasValidGeo =
    typeof centerLat === 'number' &&
    Number.isFinite(centerLat) &&
    typeof centerLon === 'number' &&
    Number.isFinite(centerLon);

  if (!hasValidGeo) {
    return (
      <section
        id="evacuation"
        className="container py-8"
        aria-label={t.evacuationMap}
        data-testid="evacuation-map-unavailable"
      >
        <div className="p-8 text-center rounded-2xl border-2 border-dashed border-border bg-card/40 space-y-3">
          <AlertCircle className="w-10 h-10 mx-auto text-warning" />
          <h3 className="text-lg font-bold text-foreground">{ml.geoUnavailable}</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {ml.geoUnavailableDesc}
          </p>
        </div>
      </section>
    );
  }

  const validCenterLat = centerLat as number;
  const validCenterLon = centerLon as number;

  const deltaLat = 0.015;
  const deltaLon = 0.018;
  const minLon = (validCenterLon - deltaLon).toFixed(4);
  const minLat = (validCenterLat - deltaLat).toFixed(4);
  const maxLon = (validCenterLon + deltaLon).toFixed(4);
  const maxLat = (validCenterLat + deltaLat).toFixed(4);

  const osmUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}&layer=mapnik&marker=${validCenterLat}%2C${validCenterLon}`;
  const osmLink = `https://www.openstreetmap.org/?mlat=${validCenterLat}&mlon=${validCenterLon}#map=15/${validCenterLat}/${validCenterLon}`;

  return (
    <section id="evacuation" className="container py-8 space-y-4" aria-label={t.evacuationMap}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2 text-foreground">
            <Map className="w-6 h-6 text-primary" />
            {t.evacuationMap}
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            {zoneName} {wardName ? `· ${wardName}` : ''} ({cityName}) —{' '}
            {isCoastal ? ml.coastalHazard : ml.inlandHazard}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-mono">
            Center: {validCenterLat.toFixed(4)}°N, {validCenterLon.toFixed(4)}°E
          </span>
        </div>
      </div>

      {/* Layer Control Bar */}
      <div className="p-3 rounded-xl bg-card border border-border flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5 font-bold text-foreground uppercase tracking-wide">
          <Layers className="w-4 h-4 text-primary" />
          <span>Operational Map Layers:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Layer: Risk Zones */}
          <button
            onClick={() => toggleLayer('riskZones')}
            className={`px-2.5 py-1 rounded-lg border font-medium transition-colors flex items-center gap-1.5 ${
              layers.riskZones
                ? 'bg-primary/15 border-primary text-primary font-semibold'
                : 'bg-secondary text-muted-foreground border-border'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Risk Zones ({riskZones.length})</span>
          </button>

          {/* Layer: Verified Incidents */}
          <button
            onClick={() => toggleLayer('verifiedIncidents')}
            className={`px-2.5 py-1 rounded-lg border font-medium transition-colors flex items-center gap-1.5 ${
              layers.verifiedIncidents
                ? 'bg-red-500/15 border-red-500/40 text-red-600 dark:text-red-400 font-semibold'
                : 'bg-secondary text-muted-foreground border-border'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Verified Incidents ({verifiedIncidents.length})</span>
          </button>

          {/* Layer: Resources */}
          <button
            onClick={() => toggleLayer('resources')}
            className={`px-2.5 py-1 rounded-lg border font-medium transition-colors flex items-center gap-1.5 ${
              layers.resources
                ? 'bg-blue-500/15 border-blue-500/40 text-blue-600 dark:text-blue-400 font-semibold'
                : 'bg-secondary text-muted-foreground border-border'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Resources ({resources.length})</span>
          </button>

          {/* Layer: Safe Locations */}
          <button
            onClick={() => toggleLayer('safeLocations')}
            className={`px-2.5 py-1 rounded-lg border font-medium transition-colors flex items-center gap-1.5 ${
              layers.safeLocations
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 font-semibold'
                : 'bg-secondary text-muted-foreground border-border'
            }`}
          >
            <Building className="w-3.5 h-3.5" />
            <span>Safe Shelters ({safeLocations.length})</span>
          </button>

          {/* Layer: User GPS */}
          <button
            onClick={() => toggleLayer('userGps')}
            className={`px-2.5 py-1 rounded-lg border font-medium transition-colors flex items-center gap-1.5 ${
              layers.userGps && userGpsLocation
                ? 'bg-purple-500/15 border-purple-500/40 text-purple-600 dark:text-purple-400 font-semibold'
                : 'bg-secondary text-muted-foreground border-border'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>
              GPS ({userGpsLocation ? `${userGpsLocation.latitude.toFixed(3)}, ${userGpsLocation.longitude.toFixed(3)}` : 'Inactive'})
            </span>
          </button>
        </div>
      </div>

      {/* OpenStreetMap dynamic embed */}
      <div className="glass-card rounded-2xl overflow-hidden border-border">
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
            © OpenStreetMap contributors · Point/Radius Hazard Reference ({zoneName}, {cityName})
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

      {/* Active Layer Details Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        {/* Risk Zone Center Info */}
        {layers.riskZones && (
          <div className="p-3 rounded-xl border border-border bg-card/60 space-y-1">
            <span className="font-bold text-primary uppercase text-[10px] flex items-center gap-1">
              <Shield className="w-3 h-3" />
              Hazard Reference Zone
            </span>
            <p className="font-semibold text-foreground">{zoneName}</p>
            <p className="text-[11px] text-muted-foreground font-mono">
              Center: {validCenterLat.toFixed(4)}°N, {validCenterLon.toFixed(4)}°E
            </p>
            <p className="text-[10px] text-muted-foreground">
              Survey model: Point & operational radius (no synthetic polygon fabricated)
            </p>
          </div>
        )}

        {/* Verified Incidents Info */}
        {layers.verifiedIncidents && (
          <div className="p-3 rounded-xl border border-border bg-card/60 space-y-1">
            <span className="font-bold text-red-500 uppercase text-[10px] flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Verified Incidents
            </span>
            <p className="font-semibold text-foreground">
              {verifiedIncidents.length > 0
                ? `${verifiedIncidents.length} Ground-Truth Verified Report(s)`
                : 'No active verified incidents'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Source: Incident Intelligence (strictly verified reports only)
            </p>
          </div>
        )}

        {/* Resources Info */}
        {layers.resources && (
          <div className="p-3 rounded-xl border border-border bg-card/60 space-y-1">
            <span className="font-bold text-blue-500 uppercase text-[10px] flex items-center gap-1">
              <Package className="w-3 h-3" />
              Resource Deployment
            </span>
            <p className="font-semibold text-foreground">
              {resources.length > 0
                ? `${resources.length} Resource Unit(s) in Zone`
                : '0 resources stationed in zone'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Source: Resource Command Center database
            </p>
          </div>
        )}

        {/* User GPS Info */}
        {layers.userGps && (
          <div className="p-3 rounded-xl border border-border bg-card/60 space-y-1">
            <span className="font-bold text-purple-500 uppercase text-[10px] flex items-center gap-1">
              <Crosshair className="w-3 h-3" />
              GPS Positioning
            </span>
            <p className="font-semibold text-foreground font-mono">
              {userGpsLocation
                ? `${userGpsLocation.latitude.toFixed(4)}°N, ${userGpsLocation.longitude.toFixed(4)}°E`
                : 'GPS Location Unavailable / Not Permitted'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Source: Browser Geolocation API
            </p>
          </div>
        )}
      </div>

      {/* Safe Locations & Shelters Section */}
      {layers.safeLocations && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold flex items-center gap-2 text-foreground">
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
                const locType = loc.locationType ?? (loc as unknown as { location_type?: SafeLocation['locationType'] }).location_type;
                const Icon = getLocationTypeIcon(locType);
                const badge = getLocationTypeBadge(locType);
                const directionsUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${validCenterLat}%2C${validCenterLon}%3B${loc.latitude}%2C${loc.longitude}`;
                const isLocActive = (loc.isActive ?? (loc as unknown as { is_active?: boolean }).is_active) !== false;

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
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${badge.bg} whitespace-nowrap`}
                        >
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
                        {isLocActive ? 'Operational' : 'Standby'}
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
      )}
    </section>
  );
}
