-- =====================================================================
-- Migration: 20261001180000_urban_flood_intelligence.sql
-- Description: Deterministic Forecast-Based Risk Assessment Layer
-- Additive schema for urban flood risk assessments, provenance, and horizons
-- =====================================================================

-- Risk levels enum/check constraint:
-- SAFE, MODERATE, HIGH, CRITICAL, UNKNOWN, INSUFFICIENT_DATA
-- Forecast horizons:
-- NOW, +1H, +3H, +6H, +24H

CREATE TABLE IF NOT EXISTS public.flood_risk_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city TEXT NOT NULL,
  ward TEXT,
  zone_id UUID REFERENCES public.risk_zones(id) ON DELETE SET NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('SAFE', 'MODERATE', 'HIGH', 'CRITICAL', 'UNKNOWN', 'INSUFFICIENT_DATA')),
  forecast_horizon TEXT NOT NULL CHECK (forecast_horizon IN ('NOW', '+1H', '+3H', '+6H', '+24H')),
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_timestamps JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  freshness TEXT NOT NULL CHECK (freshness IN ('live', 'stale', 'unavailable', 'offline')),
  model_version TEXT NOT NULL DEFAULT 'deterministic-flood-v1',
  contributing_inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  explanation TEXT NOT NULL,
  missing_sources TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_coastal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.flood_risk_assessments ENABLE ROW LEVEL SECURITY;

-- Situational awareness: All authenticated users can read assessments
CREATE POLICY "Authenticated users can read flood risk assessments" ON public.flood_risk_assessments
  FOR SELECT TO authenticated USING (true);

-- Responders and admins can insert flood risk assessments
CREATE POLICY "Responders can insert flood risk assessments" ON public.flood_risk_assessments
  FOR INSERT TO authenticated WITH CHECK (
    public.is_responder()
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_flood_risk_zone_horizon ON public.flood_risk_assessments (zone_id, forecast_horizon, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_flood_risk_city_ward ON public.flood_risk_assessments (city, ward);
CREATE INDEX IF NOT EXISTS idx_flood_risk_assessed_at ON public.flood_risk_assessments (assessed_at DESC);
