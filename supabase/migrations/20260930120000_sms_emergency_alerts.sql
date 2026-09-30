-- Emergency contacts table
CREATE TABLE public.emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  relationship TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own emergency contacts" ON public.emergency_contacts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own emergency contacts" ON public.emergency_contacts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own emergency contacts" ON public.emergency_contacts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own emergency contacts" ON public.emergency_contacts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Risk zones table (configurable geofences)
CREATE TABLE public.risk_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  center_lat DOUBLE PRECISION NOT NULL,
  center_lon DOUBLE PRECISION NOT NULL,
  radius_km DOUBLE PRECISION NOT NULL DEFAULT 3.0,
  alert_threshold_km DOUBLE PRECISION NOT NULL DEFAULT 3.0,
  severity_threshold TEXT NOT NULL DEFAULT 'high' CHECK (severity_threshold IN ('moderate', 'high', 'critical')),
  event_types TEXT[] NOT NULL DEFAULT ARRAY['flood', 'high_tide', 'tsunami', 'storm'],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.risk_zones ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read active risk zones (needed for client-side geofence check)
CREATE POLICY "Authenticated users can read active risk zones" ON public.risk_zones
  FOR SELECT TO authenticated USING (is_active = true);

-- Admins can manage risk zones
CREATE POLICY "Admins can manage risk zones" ON public.risk_zones
  FOR ALL TO authenticated USING (
    auth.jwt() ->> 'role' = 'admin'
  );

-- Insert default Juhu Beach risk zone
INSERT INTO public.risk_zones (name, center_lat, center_lon, radius_km, alert_threshold_km, severity_threshold, event_types)
VALUES (
  'Juhu Beach Flood Risk Zone',
  19.0988,
  72.8267,
  5.0,
  3.0,
  'high',
  ARRAY['flood', 'high_tide', 'tsunami', 'storm']
);

-- SMS alert log for deduplication tracking
CREATE TABLE public.sms_alert_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  zone_id UUID REFERENCES public.risk_zones(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('moderate', 'high', 'critical')),
  recipients JSONB NOT NULL DEFAULT '[]',
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_response JSONB,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'partial'))
);

ALTER TABLE public.sms_alert_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own SMS alert logs" ON public.sms_alert_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert SMS alert logs" ON public.sms_alert_log
  FOR INSERT TO service_role WITH CHECK (true);

-- Index for deduplication queries
CREATE INDEX idx_sms_alert_log_user_zone_severity ON public.sms_alert_log (user_id, zone_id, event_type, severity, sent_at DESC);

-- Function to check if alert was recently sent (for deduplication)
CREATE OR REPLACE FUNCTION public.should_send_alert(
  p_user_id UUID,
  p_zone_id UUID,
  p_event_type TEXT,
  p_severity TEXT,
  p_cooldown_minutes INT DEFAULT 60
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_alert TIMESTAMPTZ;
BEGIN
  SELECT sent_at INTO recent_alert
  FROM public.sms_alert_log
  WHERE user_id = p_user_id
    AND zone_id = p_zone_id
    AND event_type = p_event_type
    AND severity = p_severity
    AND sent_at > now() - (p_cooldown_minutes || ' minutes')::interval
  ORDER BY sent_at DESC
  LIMIT 1;

  IF recent_alert IS NOT NULL THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER emergency_contacts_updated_at
  BEFORE UPDATE ON public.emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER risk_zones_updated_at
  BEFORE UPDATE ON public.risk_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();