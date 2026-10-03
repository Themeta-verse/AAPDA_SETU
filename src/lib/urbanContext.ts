/**
 * Urban Geographic & Administrative Hierarchy
 *
 * Implements city/ward/zone urban abstractions decoupled from hardcoded single-location assumptions.
 * Supports coastal, riverine, and inland urban disaster contexts.
 */

export type LocationType =
  | 'shelter'
  | 'hospital'
  | 'police_station'
  | 'assembly_point'
  | 'relief_center'
  | 'fire_station'
  | 'other';

export type UrbanZoneType =
  | 'coastal'
  | 'inland_flood'
  | 'urban_dense'
  | 'hills_landslide'
  | 'general';

export interface UrbanCity {
  id: string;
  name: string;
  state: string;
  defaultLat: number;
  defaultLon: number;
  isCoastal: boolean;
}

export interface UrbanZone {
  id: string;
  name: string;
  city: string;
  ward: string | null;
  zoneType: UrbanZoneType;
  isCoastal: boolean;
  centerLat: number;
  centerLon: number;
  radiusKm: number;
  alertThresholdKm: number;
  severityThreshold: 'moderate' | 'high' | 'critical';
  eventTypes: string[];
  isActive: boolean;
}

export interface SafeLocation {
  id: string;
  zoneId: string | null;
  city: string;
  name: string;
  locationType: LocationType;
  address: string | null;
  latitude: number;
  longitude: number;
  capacity: number | null;
  contactNumber: string | null;
  isActive: boolean;
}

export interface UrbanContext {
  city: string;
  ward: string | null;
  zoneId: string | null;
  zoneName: string;
  isCoastal: boolean;
  zoneType: UrbanZoneType;
  latitude: number;
  longitude: number;
  source: 'gps' | 'configured_zone' | 'city_default';
  confidence: 'exact' | 'approximate' | 'configured';
}

/** Configured Demonstration Cities */
export const CONFIGURED_CITIES: readonly UrbanCity[] = [
  {
    id: 'mumbai',
    name: 'Mumbai',
    state: 'Maharashtra',
    defaultLat: 19.0760,
    defaultLon: 72.8777,
    isCoastal: true,
  },
  {
    id: 'pune',
    name: 'Pune',
    state: 'Maharashtra',
    defaultLat: 18.5204,
    defaultLon: 73.8567,
    isCoastal: false,
  },
] as const;

/** Baseline Seed & Fallback Zones */
export const DEFAULT_URBAN_ZONES: UrbanZone[] = [
  {
    id: 'zone-mumbai-juhu',
    name: 'Juhu Beach Flood Risk Zone',
    city: 'Mumbai',
    ward: 'K-West (Andheri W / Juhu)',
    zoneType: 'coastal',
    isCoastal: true,
    centerLat: 19.0988,
    centerLon: 72.8267,
    radiusKm: 5.0,
    alertThresholdKm: 3.0,
    severityThreshold: 'high',
    eventTypes: ['flood', 'high_tide', 'tsunami', 'storm'],
    isActive: true,
  },
  {
    id: 'zone-mumbai-sion',
    name: 'Sion King\'s Circle Flood Zone',
    city: 'Mumbai',
    ward: 'F-North (Sion / Matunga)',
    zoneType: 'inland_flood',
    isCoastal: false,
    centerLat: 19.0330,
    centerLon: 72.8617,
    radiusKm: 3.0,
    alertThresholdKm: 2.0,
    severityThreshold: 'high',
    eventTypes: ['flood', 'heavy_rainfall', 'waterlogging'],
    isActive: true,
  },
  {
    id: 'zone-mumbai-kurla',
    name: 'Kurla Mithi River Flood Zone',
    city: 'Mumbai',
    ward: 'L-Ward (Kurla / Chunabhatti)',
    zoneType: 'inland_flood',
    isCoastal: false,
    centerLat: 19.0688,
    centerLon: 72.8797,
    radiusKm: 4.0,
    alertThresholdKm: 2.5,
    severityThreshold: 'high',
    eventTypes: ['flood', 'waterlogging', 'blocked_roads'],
    isActive: true,
  },
  {
    id: 'zone-mumbai-bandra',
    name: 'Bandra Coastal Risk Zone',
    city: 'Mumbai',
    ward: 'H-West (Bandra W / Khar)',
    zoneType: 'coastal',
    isCoastal: true,
    centerLat: 19.0544,
    centerLon: 72.8200,
    radiusKm: 4.0,
    alertThresholdKm: 2.5,
    severityThreshold: 'high',
    eventTypes: ['flood', 'high_tide', 'storm', 'tsunami'],
    isActive: true,
  },
  {
    id: 'zone-pune-mutha',
    name: 'Pune Mutha River Flood Zone',
    city: 'Pune',
    ward: 'Shivajinagar / Deccan',
    zoneType: 'inland_flood',
    isCoastal: false,
    centerLat: 18.5204,
    centerLon: 73.8567,
    radiusKm: 5.0,
    alertThresholdKm: 3.0,
    severityThreshold: 'high',
    eventTypes: ['flood', 'heavy_rainfall', 'waterlogging'],
    isActive: true,
  },
];

/** Baseline Safe Locations & Evacuation Sites */
export const DEFAULT_SAFE_LOCATIONS: SafeLocation[] = [
  // Juhu (K-West)
  {
    id: 'safe-juhu-1',
    zoneId: 'zone-mumbai-juhu',
    city: 'Mumbai',
    name: 'Safe Zone A – JVPD Ground',
    locationType: 'assembly_point',
    address: 'JVPD Scheme, Juhu',
    latitude: 19.1030,
    longitude: 72.8330,
    capacity: 1500,
    contactNumber: '112',
    isActive: true,
  },
  {
    id: 'safe-juhu-2',
    zoneId: 'zone-mumbai-juhu',
    city: 'Mumbai',
    name: 'Safe Zone B – Mithibai College',
    locationType: 'shelter',
    address: 'Vile Parle West',
    latitude: 19.1025,
    longitude: 72.8375,
    capacity: 800,
    contactNumber: '112',
    isActive: true,
  },
  {
    id: 'safe-juhu-3',
    zoneId: 'zone-mumbai-juhu',
    city: 'Mumbai',
    name: 'Cooper Hospital Emergency Unit',
    locationType: 'hospital',
    address: 'North South Rd No 1, JVPD',
    latitude: 19.1080,
    longitude: 72.8360,
    capacity: 450,
    contactNumber: '108',
    isActive: true,
  },
  {
    id: 'safe-juhu-4',
    zoneId: 'zone-mumbai-juhu',
    city: 'Mumbai',
    name: 'Juhu Police Station',
    locationType: 'police_station',
    address: 'Juhu Tara Road',
    latitude: 19.0960,
    longitude: 72.8300,
    capacity: 200,
    contactNumber: '100',
    isActive: true,
  },
  // Sion (F-North)
  {
    id: 'safe-sion-1',
    zoneId: 'zone-mumbai-sion',
    city: 'Mumbai',
    name: 'Sion Municipal General Hospital',
    locationType: 'hospital',
    address: 'Sion West',
    latitude: 19.0350,
    longitude: 72.8600,
    capacity: 600,
    contactNumber: '108',
    isActive: true,
  },
  {
    id: 'safe-sion-2',
    zoneId: 'zone-mumbai-sion',
    city: 'Mumbai',
    name: 'Somaiya Relief Ground & Hall',
    locationType: 'shelter',
    address: 'Vidyanagar, Vidyavihar',
    latitude: 19.0730,
    longitude: 72.8990,
    capacity: 1200,
    contactNumber: '112',
    isActive: true,
  },
  // Kurla (L-Ward)
  {
    id: 'safe-kurla-1',
    zoneId: 'zone-mumbai-kurla',
    city: 'Mumbai',
    name: 'Bhabha Municipal Hospital Kurla',
    locationType: 'hospital',
    address: 'Belgrami Rd, Kurla W',
    latitude: 19.0665,
    longitude: 72.8750,
    capacity: 500,
    contactNumber: '108',
    isActive: true,
  },
  {
    id: 'safe-kurla-2',
    zoneId: 'zone-mumbai-kurla',
    city: 'Mumbai',
    name: 'Kurla Railway Evacuation Center',
    locationType: 'assembly_point',
    address: 'Station Road, Kurla West',
    latitude: 19.0650,
    longitude: 72.8800,
    capacity: 1000,
    contactNumber: '112',
    isActive: true,
  },
  // Pune (Shivajinagar)
  {
    id: 'safe-pune-1',
    zoneId: 'zone-pune-mutha',
    city: 'Pune',
    name: 'Sassoon General Hospital Pune',
    locationType: 'hospital',
    address: 'Station Road, Pune',
    latitude: 18.5265,
    longitude: 73.8735,
    capacity: 750,
    contactNumber: '108',
    isActive: true,
  },
  {
    id: 'safe-pune-2',
    zoneId: 'zone-pune-mutha',
    city: 'Pune',
    name: 'Deccan Gymkhana Relief Ground',
    locationType: 'assembly_point',
    address: 'Deccan Gymkhana, Pune',
    latitude: 18.5170,
    longitude: 73.8415,
    capacity: 1500,
    contactNumber: '112',
    isActive: true,
  },
];

/** Haversine distance in kilometers — returns null if any coordinate is invalid */
export function calculateDistanceKm(
  lat1: number | undefined | null,
  lon1: number | undefined | null,
  lat2: number | undefined | null,
  lon2: number | undefined | null
): number | null {
  if (
    typeof lat1 !== 'number' || !Number.isFinite(lat1) ||
    typeof lon1 !== 'number' || !Number.isFinite(lon1) ||
    typeof lat2 !== 'number' || !Number.isFinite(lat2) ||
    typeof lon2 !== 'number' || !Number.isFinite(lon2)
  ) {
    return null;
  }
  const R = 6371; // Earth radius km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Find zone by ID */
export function findZoneById(id: string, zones: UrbanZone[] = DEFAULT_URBAN_ZONES): UrbanZone | undefined {
  return zones.find(z => z.id === id);
}

/** Filter safe locations by zoneId, city, and ward */
export function filterSafeLocations(
  zoneId?: string | null,
  city?: string,
  ward?: string,
  locations: SafeLocation[] = DEFAULT_SAFE_LOCATIONS
): SafeLocation[] {
  if (zoneId) {
    const matched = locations.filter(l => l.zoneId === zoneId);
    if (matched.length > 0) return matched;
  }
  if (city) {
    return locations.filter(l => l.city.toLowerCase() === city.toLowerCase());
  }
  return locations;
}

/** Find nearest zone to given coordinates — returns null if coordinates invalid */
export function findNearestZone(
  lat: number | undefined | null,
  lon: number | undefined | null,
  zones: UrbanZone[] = DEFAULT_URBAN_ZONES
): { zone: UrbanZone; distanceKm: number } | null {
  if (zones.length === 0) return null;
  if (
    typeof lat !== 'number' || !Number.isFinite(lat) ||
    typeof lon !== 'number' || !Number.isFinite(lon)
  ) {
    return null;
  }

  let nearest = zones[0];
  let minDistance = calculateDistanceKm(lat, lon, nearest.centerLat, nearest.centerLon) ?? Number.POSITIVE_INFINITY;

  for (let i = 1; i < zones.length; i++) {
    const dist = calculateDistanceKm(lat, lon, zones[i].centerLat, zones[i].centerLon) ?? Number.POSITIVE_INFINITY;
    if (dist < minDistance) {
      minDistance = dist;
      nearest = zones[i];
    }
  }

  return { zone: nearest, distanceKm: minDistance };
}

/** Find zone that contains the given coordinates (within radiusKm) — returns null if coordinates invalid */
export function findZoneContaining(
  lat: number | undefined | null,
  lon: number | undefined | null,
  zones: UrbanZone[] = DEFAULT_URBAN_ZONES
): { zone: UrbanZone; distanceKm: number } | null {
  if (
    typeof lat !== 'number' || !Number.isFinite(lat) ||
    typeof lon !== 'number' || !Number.isFinite(lon)
  ) {
    return null;
  }
  for (const zone of zones) {
    if (!zone.isActive) continue;
    const dist = calculateDistanceKm(lat, lon, zone.centerLat, zone.centerLon);
    if (dist !== null && dist <= zone.radiusKm) {
      return { zone, distanceKm: dist };
    }
  }
  return null;
}

/** Find nearest safe evacuation location — returns null if coordinates invalid */
export function findNearestSafeLocation(
  lat: number | undefined | null,
  lon: number | undefined | null,
  locations: SafeLocation[] = DEFAULT_SAFE_LOCATIONS
): { location: SafeLocation; distanceKm: number } | null {
  if (locations.length === 0) return null;
  if (
    typeof lat !== 'number' || !Number.isFinite(lat) ||
    typeof lon !== 'number' || !Number.isFinite(lon)
  ) {
    return null;
  }

  let nearest = locations[0];
  let minDistance = calculateDistanceKm(lat, lon, nearest.latitude, nearest.longitude) ?? Number.POSITIVE_INFINITY;

  for (let i = 1; i < locations.length; i++) {
    const dist = calculateDistanceKm(lat, lon, locations[i].latitude, locations[i].longitude) ?? Number.POSITIVE_INFINITY;
    if (dist < minDistance) {
      minDistance = dist;
      nearest = locations[i];
    }
  }

  return { location: nearest, distanceKm: minDistance };
}

