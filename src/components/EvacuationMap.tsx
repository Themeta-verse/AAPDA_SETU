import { motion } from 'framer-motion';
import { Map, MapPin, Building, Shield, Navigation, ExternalLink, Hospital, Siren, ArrowUpFromLine } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';

interface EvacuationMapProps {
  language: Language;
}

const mapLabels: Record<string, Record<string, string>> = {
  en: { ocean: 'Arabian Sea', beach: 'Juhu Beach', safeZone: 'Safe Zone (High Ground)', services: 'Emergency Services', evacRoute: 'Evacuation Route', zoneA: 'Safe Zone A – JVPD Ground', zoneB: 'Safe Zone B – Mithibai College', police: 'Juhu Police Station', hospital: 'Cooper Hospital', openMap: 'Open Full Map', dangerZone: 'Danger Zone (Beach)', highGround: 'High Ground' },
  hi: { ocean: 'अरब सागर', beach: 'जुहू बीच', safeZone: 'सुरक्षित क्षेत्र (ऊंचा भूमि)', services: 'आपातकालीन सेवाएं', evacRoute: 'निकासी मार्ग', zoneA: 'सुरक्षित क्षेत्र A – JVPD मैदान', zoneB: 'सुरक्षित क्षेत्र B – मिठीबाई कॉलेज', police: 'जुहू पुलिस स्टेशन', hospital: 'कूपर अस्पताल', openMap: 'पूरा नक्शा खोलें', dangerZone: 'खतरा क्षेत्र', highGround: 'ऊंचा भूमि' },
  mr: { ocean: 'अरबी समुद्र', beach: 'जुहू बीच', safeZone: 'सुरक्षित क्षेत्र (उंच भूमी)', services: 'आपत्कालीन सेवा', evacRoute: 'निर्वासन मार्ग', zoneA: 'सुरक्षित क्षेत्र A – JVPD मैदान', zoneB: 'सुरक्षित क्षेत्र B – मिठीबाई कॉलेज', police: 'जुहू पोलीस स्टेशन', hospital: 'कूपर रुग्णालय', openMap: 'पूर्ण नकाशा उघडा', dangerZone: 'धोक्याचे क्षेत्र', highGround: 'उंच भूमी' },
  gu: { ocean: 'અરબી સમુદ્ર', beach: 'જુહુ બીચ', safeZone: 'સુરક્ષિત ઝોન (ઊંચી જમીન)', services: 'ઇમરજન્સી સેવાઓ', evacRoute: 'ખાલી કરાવવાનો માર્ગ', zoneA: 'સુરક્ષિત ઝોન A – JVPD મેદાન', zoneB: 'સુરક્ષિત ઝોન B – મિથીબાઈ કૉલેજ', police: 'જુહુ પોલીસ સ્ટેશન', hospital: 'કૂપર હોસ્પિટલ', openMap: 'સંપૂર્ણ નકશો ખોલો', dangerZone: 'ખતરા ઝોન', highGround: 'ઊંચી જમીન' },
};

export function EvacuationMap({ language }: EvacuationMapProps) {
  const t = translations[language];
  const ml = mapLabels[language];

  const locations = [
    { name: ml.beach, type: 'beach', x: 28, y: 58, icon: MapPin },
    { name: ml.zoneA, type: 'safe', x: 55, y: 22, icon: Shield },
    { name: ml.zoneB, type: 'safe', x: 72, y: 38, icon: Shield },
    { name: ml.police, type: 'police', x: 45, y: 42, icon: Siren },
    { name: ml.hospital, type: 'hospital', x: 76, y: 55, icon: Hospital },
  ];

  const osmUrl = 'https://www.openstreetmap.org/export/embed.html?bbox=72.8100%2C19.0850%2C72.8450%2C19.1150&layer=mapnik&marker=19.0988%2C72.8267';
  const osmLink = 'https://www.openstreetmap.org/?mlat=19.0988&mlon=72.8267#map=15/19.0988/72.8267';

  return (
    <section id="evacuation" className="container py-8" aria-label={t.evacuationMap}>
      <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <Map className="w-6 h-6 text-primary" />
        {t.evacuationMap}
      </h2>
      <p className="text-muted-foreground mb-6 text-sm">{t.evacuationDesc}</p>

      {/* OpenStreetMap embed */}
      <div className="glass-card rounded-2xl overflow-hidden border-border mb-4">
        <div className="relative w-full h-[300px] sm:h-[400px]">
          <iframe
            src={osmUrl}
            className="absolute inset-0 w-full h-full border-0"
            loading="lazy"
            title="Juhu Beach Evacuation Map"
            allowFullScreen
          />
        </div>
        <div className="p-3 flex items-center justify-between border-t border-border/50">
          <span className="text-xs text-muted-foreground">© OpenStreetMap contributors</span>
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

      {/* Overlay evacuation diagram */}
      <div className="glass-card rounded-2xl overflow-hidden border-border">
        <div className="relative bg-gradient-to-br from-ocean/10 via-primary/5 to-card h-[340px] md:h-[420px]">
          {/* Grid */}
          <svg className="absolute inset-0 w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>

          {/* Ocean / Danger Zone */}
          <div className="absolute left-0 top-0 bottom-0 w-[28%] bg-gradient-to-r from-danger/15 via-danger/8 to-transparent">
            <div className="absolute bottom-4 left-4 text-[10px] text-danger/60 font-bold uppercase tracking-wider rotate-[-90deg] origin-bottom-left whitespace-nowrap">
              ⚠ {ml.dangerZone}
            </div>
          </div>

          {/* Safe High Ground Zone */}
          <div className="absolute right-0 top-0 bottom-0 w-[35%] bg-gradient-to-l from-safe/8 to-transparent">
            <div className="absolute top-4 right-4 flex items-center gap-1 text-[10px] text-safe/60 font-bold uppercase tracking-wider">
              <ArrowUpFromLine className="w-3 h-3" />
              {ml.highGround}
            </div>
          </div>

          {/* Ocean label */}
          <div className="absolute left-2 top-1/2 -translate-y-1/2">
            <span className="text-xs text-primary/40 font-bold rotate-[-90deg] block whitespace-nowrap">{ml.ocean}</span>
          </div>

          {/* Evacuation routes */}
          <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="hsl(var(--safe))" />
              </marker>
            </defs>
            {/* Route 1: Beach → Safe Zone A */}
            <line x1="30%" y1="56%" x2="53%" y2="25%" stroke="hsl(var(--safe))" strokeWidth="3" strokeDasharray="8,5" markerEnd="url(#arrowhead)" opacity="0.7" />
            {/* Route 2: Beach → Safe Zone B */}
            <line x1="30%" y1="56%" x2="70%" y2="40%" stroke="hsl(var(--safe))" strokeWidth="3" strokeDasharray="8,5" markerEnd="url(#arrowhead)" opacity="0.7" />
          </svg>

          {/* Location markers */}
          {locations.map((loc, i) => (
            <motion.div
              key={i}
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15, type: 'spring' }}
              className="absolute group"
              style={{ left: `${loc.x}%`, top: `${loc.y}%`, transform: 'translate(-50%, -50%)' }}
              role="img"
              aria-label={loc.name}
            >
              <div className={`p-2.5 rounded-full border-2 ${
                loc.type === 'beach' ? 'bg-danger/20 text-danger border-danger/40' :
                loc.type === 'safe' ? 'bg-safe/20 text-safe border-safe/40' :
                loc.type === 'police' ? 'bg-primary/20 text-primary border-primary/40' :
                'bg-warning/20 text-warning border-warning/40'
              }`}>
                <loc.icon className="w-5 h-5" />
              </div>
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 whitespace-nowrap bg-card/95 backdrop-blur-sm px-2.5 py-1.5 rounded-lg text-[10px] font-bold border border-border opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-lg">
                {loc.name}
              </div>
            </motion.div>
          ))}

          {/* Legend */}
          <div className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4 glass-card p-3 sm:p-4 rounded-xl text-[10px] sm:text-xs space-y-2">
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-danger/50 border border-danger/40" /> {ml.beach}</div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-safe/50 border border-safe/40" /> {ml.safeZone}</div>
            <div className="flex items-center gap-2"><Siren className="w-3 h-3 text-primary" /> {ml.services}</div>
            <div className="flex items-center gap-2"><Hospital className="w-3 h-3 text-warning" /> {ml.hospital}</div>
            <div className="flex items-center gap-2">
              <Navigation className="w-3 h-3 text-safe" /> {ml.evacRoute}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
