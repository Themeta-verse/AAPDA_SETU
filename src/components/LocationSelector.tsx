import React from 'react';
import { MapPin, Navigation, Building2, Shield, Waves, ChevronDown } from 'lucide-react';
import type { UrbanContext, UrbanCity, UrbanZone } from '@/lib/urbanContext';

interface LocationSelectorProps {
  context: UrbanContext;
  cities: readonly UrbanCity[];
  cityZones: UrbanZone[];
  isGpsActive: boolean;
  onSelectCity: (city: string) => void;
  onSelectZone: (zoneId: string) => void;
  onToggleGps: () => void;
}

export function LocationSelector({
  context,
  cities,
  cityZones,
  isGpsActive,
  onSelectCity,
  onSelectZone,
  onToggleGps,
}: LocationSelectorProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-secondary/60 border border-border text-xs"
      data-testid="urban-location-selector"
      aria-label="Urban Location Selector"
    >
      {/* City Dropdown */}
      <div className="relative flex items-center">
        <Building2 className="w-3.5 h-3.5 text-primary ml-2 flex-shrink-0" />
        <select
          value={context.city}
          onChange={(e) => onSelectCity(e.target.value)}
          className="bg-transparent pl-1.5 pr-6 py-1 font-semibold text-foreground text-xs appearance-none focus:outline-none cursor-pointer"
          aria-label="Select City"
          data-testid="select-city"
        >
          {cities.map((city) => (
            <option key={city.id} value={city.name} className="bg-popover text-popover-foreground">
              {city.name}
            </option>
          ))}
        </select>
        <ChevronDown className="w-3 h-3 text-muted-foreground absolute right-1 pointer-events-none" />
      </div>

      <span className="text-border">|</span>

      {/* Ward / Zone Dropdown */}
      <div className="relative flex items-center min-w-[140px] max-w-[260px]">
        <MapPin className="w-3.5 h-3.5 text-primary ml-1 flex-shrink-0" />
        <select
          value={context.zoneId || ''}
          onChange={(e) => onSelectZone(e.target.value)}
          className="bg-transparent pl-1.5 pr-6 py-1 text-foreground text-xs truncate appearance-none focus:outline-none cursor-pointer w-full"
          aria-label="Select Ward / Risk Zone"
          data-testid="select-zone"
        >
          {cityZones.map((z) => (
            <option key={z.id} value={z.id} className="bg-popover text-popover-foreground">
              {z.ward ? `${z.ward} — ${z.name}` : z.name}
            </option>
          ))}
        </select>
        <ChevronDown className="w-3 h-3 text-muted-foreground absolute right-1 pointer-events-none" />
      </div>

      {/* GPS Button */}
      <button
        onClick={onToggleGps}
        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
          isGpsActive
            ? 'bg-primary text-primary-foreground font-bold shadow-xs'
            : 'bg-secondary hover:bg-secondary/80 text-muted-foreground'
        }`}
        title={isGpsActive ? 'Using Live GPS Location' : 'Switch to Live GPS Position'}
        aria-label="Toggle Live GPS Location"
        data-testid="toggle-gps"
      >
        <Navigation className={`w-3 h-3 ${isGpsActive ? 'animate-pulse text-white' : ''}`} />
        <span className="hidden sm:inline">{isGpsActive ? 'GPS Active' : 'Use GPS'}</span>
      </button>

      {/* Zone Hazard Indicator Tag */}
      <div className="hidden lg:flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary text-muted-foreground border border-border">
        {context.isCoastal ? (
          <>
            <Waves className="w-3 h-3 text-ocean" />
            <span>Coastal Geofence</span>
          </>
        ) : (
          <>
            <Shield className="w-3 h-3 text-primary" />
            <span>Inland Urban Zone</span>
          </>
        )}
      </div>
    </div>
  );
}
