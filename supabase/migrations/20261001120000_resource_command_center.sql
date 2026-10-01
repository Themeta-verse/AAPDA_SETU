-- =====================================================================
-- Migration: 20261001120000_resource_command_center.sql
-- Description: BayWatch Resource Command Center & Management
-- Normalized schema for resources, allocations, audit logs, and compatibility
-- =====================================================================

-- Resource types enum
CREATE TYPE public.resource_type AS ENUM (
  'ambulance',
  'fire_rescue',
  'rescue_team',
  'boat',
  'water_pump',
  'emergency_medical_team',
  'search_rescue_team',
  'emergency_vehicle',
  'shelter_capacity',
  'relief_supply',
  'generator',
  'lighting_tower',
  'communication_equipment',
  'dewatering_pump',
  'other'
);

-- Resource status enum
CREATE TYPE public.resource_status AS ENUM (
  'available',
  'allocated',
  'deployed',
  'maintenance',
  'unavailable'
);

-- Allocation status enum
CREATE TYPE public.allocation_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'deployed',
  'completed',
  'released'
);

-- ---------------------------------------------------------------------
-- 1. Resources Table
-- ---------------------------------------------------------------------
CREATE TABLE public.resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type public.resource_type NOT NULL,
  name TEXT NOT NULL,
  status public.resource_status NOT NULL DEFAULT 'available',
  quantity INTEGER NOT NULL DEFAULT 1,
  available_quantity INTEGER NOT NULL DEFAULT 1,
  zone_id UUID REFERENCES public.risk_zones(id) ON DELETE SET NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  capacity INTEGER,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_resources_quantity CHECK (quantity >= 0),
  CONSTRAINT chk_resources_avail_quantity CHECK (available_quantity >= 0 AND available_quantity <= quantity)
);

ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

-- Situational awareness: All authenticated users can read resource inventory
CREATE POLICY "Authenticated users can read resources" ON public.resources
  FOR SELECT TO authenticated USING (true);

-- Responders and admins can insert resources
CREATE POLICY "Responders can insert resources" ON public.resources
  FOR INSERT TO authenticated WITH CHECK (
    public.is_responder()
  );

-- Responders and admins can update resources
CREATE POLICY "Responders can update resources" ON public.resources
  FOR UPDATE TO authenticated USING (
    public.is_responder()
  );

-- Admins only can delete resources
CREATE POLICY "Admins can delete resources" ON public.resources
  FOR DELETE TO authenticated USING (
    public.current_app_role() = 'admin'
  );

CREATE INDEX idx_resources_type ON public.resources (resource_type);
CREATE INDEX idx_resources_status ON public.resources (status);
CREATE INDEX idx_resources_zone_id ON public.resources (zone_id);

-- ---------------------------------------------------------------------
-- 2. Resource Allocations Table
-- ---------------------------------------------------------------------
CREATE TABLE public.resource_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID REFERENCES public.resources(id) ON DELETE CASCADE NOT NULL,
  incident_id UUID REFERENCES public.incident_reports(id) ON DELETE SET NULL,
  zone_id UUID REFERENCES public.risk_zones(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  status public.allocation_status NOT NULL DEFAULT 'pending',
  allocated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deployed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  deployed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  rejection_reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_allocations_quantity CHECK (quantity > 0)
);

ALTER TABLE public.resource_allocations ENABLE ROW LEVEL SECURITY;

-- Situational awareness: All authenticated users can read allocations
CREATE POLICY "Authenticated users can read resource allocations" ON public.resource_allocations
  FOR SELECT TO authenticated USING (true);

-- Responders and admins can create allocations
CREATE POLICY "Responders can create resource allocations" ON public.resource_allocations
  FOR INSERT TO authenticated WITH CHECK (
    public.is_responder()
  );

-- Responders and admins can update allocations
CREATE POLICY "Responders can update resource allocations" ON public.resource_allocations
  FOR UPDATE TO authenticated USING (
    public.is_responder()
  );

-- Admins only can delete allocations
CREATE POLICY "Admins can delete resource allocations" ON public.resource_allocations
  FOR DELETE TO authenticated USING (
    public.current_app_role() = 'admin'
  );

CREATE INDEX idx_resource_allocations_resource_id ON public.resource_allocations (resource_id);
CREATE INDEX idx_resource_allocations_incident_id ON public.resource_allocations (incident_id);
CREATE INDEX idx_resource_allocations_zone_id ON public.resource_allocations (zone_id);
CREATE INDEX idx_resource_allocations_status ON public.resource_allocations (status);

-- ---------------------------------------------------------------------
-- 3. Resource Audit Logs Table (Audit Trail)
-- ---------------------------------------------------------------------
CREATE TABLE public.resource_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID REFERENCES public.resources(id) ON DELETE CASCADE NOT NULL,
  allocation_id UUID REFERENCES public.resource_allocations(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.resource_audit_logs ENABLE ROW LEVEL SECURITY;

-- Operational roles can read audit logs
CREATE POLICY "Responders can read resource audit logs" ON public.resource_audit_logs
  FOR SELECT TO authenticated USING (
    public.is_responder()
  );

-- Responders can insert audit entries
CREATE POLICY "Responders can insert resource audit logs" ON public.resource_audit_logs
  FOR INSERT TO authenticated WITH CHECK (
    public.is_responder()
  );

CREATE INDEX idx_resource_audit_logs_resource_id ON public.resource_audit_logs (resource_id);
CREATE INDEX idx_resource_audit_logs_allocation_id ON public.resource_audit_logs (allocation_id);
CREATE INDEX idx_resource_audit_logs_created_at ON public.resource_audit_logs (created_at DESC);

-- ---------------------------------------------------------------------
-- 4. Resource Incident Compatibility Matrix
-- ---------------------------------------------------------------------
CREATE TABLE public.resource_incident_compatibility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type public.resource_type NOT NULL,
  incident_type TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (resource_type, incident_type)
);

ALTER TABLE public.resource_incident_compatibility ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read resource compatibility" ON public.resource_incident_compatibility
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage resource compatibility" ON public.resource_incident_compatibility
  FOR ALL TO authenticated USING (
    public.current_app_role() = 'admin'
  );

CREATE INDEX idx_resource_incident_compat_resource ON public.resource_incident_compatibility (resource_type);
CREATE INDEX idx_resource_incident_compat_incident ON public.resource_incident_compatibility (incident_type);

-- Seed default compatibility matrix
INSERT INTO public.resource_incident_compatibility (resource_type, incident_type, priority, notes) VALUES
  ('water_pump', 'flooding', 1, 'Primary resource for flood water removal'),
  ('dewatering_pump', 'flooding', 2, 'Secondary pump for flood response'),
  ('rescue_team', 'flooding', 1, 'Primary rescue for flood victims'),
  ('boat', 'flooding', 2, 'Water rescue and transport'),
  ('ambulance', 'flooding', 2, 'Medical transport for flood victims'),
  ('emergency_medical_team', 'flooding', 2, 'Medical support for flood victims'),
  ('rescue_team', 'high_waves', 1, 'Primary rescue for high wave incidents'),
  ('boat', 'high_waves', 1, 'Water rescue for high wave incidents'),
  ('ambulance', 'high_waves', 2, 'Medical transport'),
  ('search_rescue_team', 'high_waves', 1, 'Search and rescue in rough waters'),
  ('rescue_team', 'blocked_roads', 1, 'Clear blocked roads and rescue trapped'),
  ('emergency_vehicle', 'blocked_roads', 1, 'Clear blocked roads'),
  ('ambulance', 'blocked_roads', 2, 'Medical transport for road incidents'),
  ('emergency_medical_team', 'blocked_roads', 2, 'Medical support'),
  ('generator', 'flooding', 3, 'Backup power for flood response'),
  ('lighting_tower', 'flooding', 3, 'Night operations lighting'),
  ('communication_equipment', 'flooding', 3, 'Emergency communications'),
  ('shelter_capacity', 'flooding', 2, 'Evacuation shelter capacity'),
  ('relief_supply', 'flooding', 3, 'Emergency supplies for displaced'),
  ('shelter_capacity', 'high_waves', 2, 'Evacuation shelter capacity'),
  ('relief_supply', 'high_waves', 3, 'Emergency supplies'),
  ('shelter_capacity', 'blocked_roads', 2, 'Temporary shelter for stranded'),
  ('relief_supply', 'blocked_roads', 3, 'Emergency supplies for stranded'),
  ('rescue_team', 'other', 2, 'General rescue team response'),
  ('emergency_vehicle', 'other', 2, 'General emergency vehicle support')
ON CONFLICT (resource_type, incident_type) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. Updated At Triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER resources_updated_at
  BEFORE UPDATE ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER resource_allocations_updated_at
  BEFORE UPDATE ON public.resource_allocations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();