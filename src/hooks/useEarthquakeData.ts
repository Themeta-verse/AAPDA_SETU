import { useState, useEffect, useCallback } from 'react';

export interface EarthquakeEvent {
  id: string;
  magnitude: number;
  place: string;
  time: number;
  latitude: number;
  longitude: number;
  tsunamiFlag: number;
}

// Indian Ocean bounding box (rough)
const IO_LAT_MIN = -10;
const IO_LAT_MAX = 25;
const IO_LON_MIN = 40;
const IO_LON_MAX = 100;

function isIndianOceanRegion(lat: number, lon: number) {
  return lat >= IO_LAT_MIN && lat <= IO_LAT_MAX && lon >= IO_LON_MIN && lon <= IO_LON_MAX;
}

export function useEarthquakeData(intervalMs = 300000) {
  const [earthquakes, setEarthquakes] = useState<EarthquakeEvent[]>([]);
  const [tsunamiRisk, setTsunamiRisk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(
        'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'
      );
      const data = await res.json();

      const relevant: EarthquakeEvent[] = (data.features || [])
        .filter((f: any) => {
          const [lon, lat] = f.geometry.coordinates;
          return isIndianOceanRegion(lat, lon);
        })
        .map((f: any) => ({
          id: f.id,
          magnitude: f.properties.mag,
          place: f.properties.place,
          time: f.properties.time,
          latitude: f.geometry.coordinates[1],
          longitude: f.geometry.coordinates[0],
          tsunamiFlag: f.properties.tsunami,
        }));

      setEarthquakes(relevant);
      setTsunamiRisk(relevant.some((e) => e.magnitude >= 6.0));
      setError(null);
    } catch (err) {
      console.warn('USGS earthquake fetch failed:', err);
      setError('Unable to fetch earthquake data');
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, intervalMs);
    return () => clearInterval(id);
  }, [fetchData, intervalMs]);

  return { earthquakes, tsunamiRisk, error, refetch: fetchData };
}
