-- =====================================================================
-- Migration: 20261001140000_urban_location_hierarchy.sql
-- Description: Full Urbanization & Geographic Hierarchy
-- Extends risk_zones with city, ward, zone_type, and introduces safe_locations
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Extend risk_zones with Urban Hierarchy
-- ---------------------------------------------------------------------
ALTER TABLE public.risk_zones
  ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT 'Mumbai',
  ADD COLUMN IF NOT EXISTS ward TEXT,
  ADD COLUMN IF NOT EXISTS zone_type TEXT NOT NULL DEFAULT 'coastal',
  ADD COLUMN IF NOT EXISTS is_coastal BOOLEAN NOT NULL DEFAULT true;

-- Update existing Juhu zone with explicit ward information
UPDATE public.risk_zones
   SET city = 'Mumbai',
       ward = 'K-West (Andheri W / Juhu)',
       zone_type = 'coastal',
       is_coastal = true
 WHERE name = 'Juhu Beach Flood Risk Zone';

-- Insert additional urban demonstration zones across Mumbai and inland cities
INSERT INTO public.risk_zones (name, city, ward, zone_type, is_coastal, center_lat, center_lon, radius_km, alert_threshold_km, severity_threshold, event_types)
VALUES
  (
    'Sion King''s Circle Flood Zone',
    'Mumbai',
    'F-North (Sion / Matunga)',
    'inland_flood',
    false,
    19.0330,
    72.8617,
    3.0,
    2.0,
    'high',
    ARRAY['flood', 'heavy_rainfall', 'waterlogging']
  ),
  (
    'Kurla Mithi River Flood Zone',
    'Mumbai',
    'L-Ward (Kurla / Chunabhatti)',
    'inland_flood',
    false,
    19.0688,
    72.8797,
    4.0,
    2.5,
    'high',
    ARRAY['flood', 'waterlogging', 'blocked_roads']
  ),
  (
    'Bandra Coastal Risk Zone',
    'Mumbai',
    'H-West (Bandra W / Khar)',
    'coastal',
    true,
    19.0544,
    72.8200,
    4.0,
    2.5,
    'high',
    ARRAY['flood', 'high_tide', 'storm', 'tsunami']
  ),
  (
    'Pune Mutha River Flood Zone',
    'Pune',
    'Shivajinagar / Deccan',
    'inland_flood',
    false,
    18.5204,
    73.8567,
    5.0,
    3.0,
    'high',
    ARRAY['flood', 'heavy_rainfall', 'waterlogging']
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Safe Locations & Shelters Registry
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.safe_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID REFERENCES public.risk_zones(id) ON DELETE SET NULL,
  city TEXT NOT NULL DEFAULT 'Mumbai',
  name TEXT NOT NULL,
  location_type TEXT NOT NULL CHECK (location_type IN ('shelter', 'hospital', 'police_station', 'assembly_point', 'relief_center', 'fire_station', 'other')),
  address TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  capacity INTEGER,
  contact_number TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.safe_locations ENABLE ROW LEVEL SECURITY;

-- Situational awareness: All authenticated users can read safe locations
CREATE POLICY "Authenticated users can read safe locations" ON public.safe_locations
  FOR SELECT TO authenticated USING (is_active = true);

-- Responders and admins can insert and update safe locations
CREATE POLICY "Responders can insert safe locations" ON public.safe_locations
  FOR INSERT TO authenticated WITH CHECK (
    public.is_responder()
  );

CREATE POLICY "Responders can update safe locations" ON public.safe_locations
  FOR UPDATE TO authenticated USING (
    public.is_responder()
  );

CREATE POLICY "Admins can delete safe locations" ON public.safe_locations
  FOR DELETE TO authenticated USING (
    public.current_app_role() = 'admin'
  );

CREATE INDEX idx_safe_locations_zone_id ON public.safe_locations (zone_id);
CREATE INDEX idx_safe_locations_city ON public.safe_locations (city);
CREATE INDEX idx_safe_locations_type ON public.safe_locations (location_type);

-- Trigger for updated_at
CREATE TRIGGER safe_locations_updated_at
  BEFORE UPDATE ON public.safe_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Seed real emergency assembly points & shelters for Juhu
DO $$
DECLARE
  juhu_id UUID;
  sion_id UUID;
  kurla_id UUID;
BEGIN
  SELECT id INTO juhu_id FROM public.risk_zones WHERE name = 'Juhu Beach Flood Risk Zone' LIMIT 1;
  SELECT id INTO sion_id FROM public.risk_zones WHERE name = 'Sion King''s Circle Flood Zone' LIMIT 1;
  SELECT id INTO kurla_id FROM public.risk_zones WHERE name = 'Kurla Mithi River Flood Zone' LIMIT 1;

  IF juhu_id IS NOT NULL THEN
    INSERT INTO public.safe_locations (zone_id, city, name, location_type, address, latitude, longitude, capacity)
    VALUES
      (juhu_id, 'Mumbai', 'Safe Zone A – JVPD Ground', 'assembly_point', 'JVPD Scheme, Juhu', 19.1030, 72.8330, 1500),
      (juhu_id, 'Mumbai', 'Safe Zone B – Mithibai College', 'shelter', 'Vile Parle West', 19.1025, 72.8375, 800),
      (juhu_id, 'Mumbai', 'Cooper Hospital Emergency Unit', 'hospital', 'North South Rd No 1, JVPD', 19.1080, 72.8360, 450),
      (juhu_id, 'Mumbai', 'Juhu Police Station', 'police_station', 'Juhu Tara Road', 19.0960, 72.8300, 200)
    ON CONFLICT DO NOTHING;
  END IF;

  IF sion_id IS NOT NULL THEN
    INSERT INTO public.safe_locations (zone_id, city, name, location_type, address, latitude, longitude, capacity)
    VALUES
      (sion_id, 'Mumbai', 'Sion Municipal Hospital', 'hospital', 'Sion West', 19.0350, 72.8600, 600),
      (sion_id, 'Mumbai', 'Somaiya High School & Relief Ground', 'shelter', 'Vidyanagar, Vidyavihar', 19.0730, 72.8990, 1200)
    ON CONFLICT DO NOTHING;
  END IF;

  IF kurla_id IS NOT NULL THEN
    INSERT INTO public.safe_locations (zone_id, city, name, location_type, address, latitude, longitude, capacity)
    VALUES
      (kurla_id, 'Mumbai', 'Bhabha Municipal Hospital', 'hospital', 'Belgrami Rd, Kurla W', 19.0665, 72.8750, 500),
      (kurla_id, 'Mumbai', 'Kurla Railway Relief Center', 'assembly_point', 'Station Road, Kurla West', 19.0650, 72.8800, 1000)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
