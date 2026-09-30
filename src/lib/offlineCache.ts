export interface CachedData<T> {
  data: T;
  updatedAt: string;
  source: string;
  status: 'live' | 'stale' | 'offline';
}

const CACHE_PREFIX = 'baywatch_';

function getCacheKey(key: string): string {
  return `${CACHE_PREFIX}${key}`;
}

export function saveToCache<T>(key: string, data: T, source: string): void {
  try {
    const cached: CachedData<T> = {
      data,
      updatedAt: new Date().toISOString(),
      source,
      status: 'live',
    };
    localStorage.setItem(getCacheKey(key), JSON.stringify(cached));
  } catch (e) {
    console.warn(`Failed to cache ${key}:`, e);
  }
}

export function loadFromCache<T>(key: string): CachedData<T> | null {
  try {
    const item = localStorage.getItem(getCacheKey(key));
    if (!item) return null;
    const cached = JSON.parse(item) as CachedData<T>;
    return cached;
  } catch (e) {
    console.warn(`Failed to load cache for ${key}:`, e);
    return null;
  }
}

export function clearCache(key: string): void {
  try {
    localStorage.removeItem(getCacheKey(key));
  } catch (e) {
    console.warn(`Failed to clear cache for ${key}:`, e);
  }
}

export function clearAllCache(): void {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    console.warn('Failed to clear all cache:', e);
  }
}

export function getCacheAge(key: string): number | null {
  const cached = loadFromCache(key);
  if (!cached) return null;
  return Date.now() - new Date(cached.updatedAt).getTime();
}

export function isCacheStale(key: string, maxAgeMs: number): boolean {
  const age = getCacheAge(key);
  if (age === null) return true;
  return age > maxAgeMs;
}

export const CACHE_KEYS = {
  MONITORING_DATA: 'monitoring_data',
  ALERTS: 'alerts',
  RISK_ZONES: 'risk_zones',
  WEATHER_DATA: 'weather_data',
  EARTHQUAKE_DATA: 'earthquake_data',
  RESOURCES: 'resources',
  ALLOCATIONS: 'allocations',
} as const;

export type CacheKey = typeof CACHE_KEYS[keyof typeof CACHE_KEYS];