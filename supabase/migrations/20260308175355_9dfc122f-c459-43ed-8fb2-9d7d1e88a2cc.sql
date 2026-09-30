
-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'citizen' CHECK (role IN ('citizen', 'responder', 'admin')),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICy "Admins can read all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (
    auth.jwt() ->> 'role' = 'admin'
  );

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Incident reports table
CREATE TABLE public.incident_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('flooding', 'high_waves', 'blocked_roads', 'other')),
  description TEXT NOT NULL DEFAULT '',
  photo_url TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own reports" ON public.incident_reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own reports" ON public.incident_reports
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Responders can read operational reports" ON public.incident_reports
  FOR SELECT TO authenticated USING (
    auth.jwt() ->> 'role' IN ('responder', 'admin')
  );

-- Alert logs table
CREATE TABLE public.alert_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  triggered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can read alert logs" ON public.alert_logs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert alert logs" ON public.alert_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = triggered_by);

-- Storage bucket for incident photos
INSERT INTO storage.buckets (id, name, public) VALUES ('incident-photos', 'incident-photos', false);

CREATE POLICY "Authenticated users can upload photos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'incident-photos');

CREATE POLICY "Authorized users can view incident photos" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'incident-photos');
