-- =====================================================================
-- Migration: 20261001150000_provision_demo_operational_roles.sql
-- Description: Isolated evaluator & operational accounts registry with strict public signup separation
--
-- Security Architecture:
-- 1. Public signups: ALWAYS citizen. Under NO circumstances does public
--    signup or self-service email update grant an operational role.
-- 2. Evaluator/operational accounts registry: public.preauthorized_operational_roles
--    is fully protected with RLS. Anonymous visitors have ZERO access.
--    Ordinary authenticated citizens/responders CANNOT read, insert, update, or delete.
--    Only authorized administrators (public.current_app_role() = 'admin') or
--    the service-role key can access/manage the registry.
-- 3. Explicit Provisioning: Operational roles are provisioned ONLY via
--    an explicit administrative call (public.provision_operational_account)
--    or during trusted database initialization/migrations. No trigger
--    intercepts public signups to grant privileged roles.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Preauthorized Operational Roles Registry
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.preauthorized_operational_roles (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('responder', 'admin')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS and revoke access from non-superusers
ALTER TABLE public.preauthorized_operational_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.preauthorized_operational_roles FROM anon, authenticated;

-- Policies for preauthorized_operational_roles:
-- Anon is strictly denied (REVOKE ALL, zero anon policies).
-- Authenticated non-admins have zero access.
-- Admins alone may read, insert, update, and delete registry records.
DROP POLICY IF EXISTS "Admins can view preauthorized operational roles" ON public.preauthorized_operational_roles;
CREATE POLICY "Admins can view preauthorized operational roles"
  ON public.preauthorized_operational_roles
  FOR SELECT TO authenticated
  USING (public.current_app_role() = 'admin');

DROP POLICY IF EXISTS "Admins can insert preauthorized operational roles" ON public.preauthorized_operational_roles;
CREATE POLICY "Admins can insert preauthorized operational roles"
  ON public.preauthorized_operational_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.current_app_role() = 'admin');

DROP POLICY IF EXISTS "Admins can update preauthorized operational roles" ON public.preauthorized_operational_roles;
CREATE POLICY "Admins can update preauthorized operational roles"
  ON public.preauthorized_operational_roles
  FOR UPDATE TO authenticated
  USING (public.current_app_role() = 'admin');

DROP POLICY IF EXISTS "Admins can delete preauthorized operational roles" ON public.preauthorized_operational_roles;
CREATE POLICY "Admins can delete preauthorized operational roles"
  ON public.preauthorized_operational_roles
  FOR DELETE TO authenticated
  USING (public.current_app_role() = 'admin');

-- Seed designated evaluation and operational accounts
INSERT INTO public.preauthorized_operational_roles (email, role, notes) VALUES
  ('admin@baywatch.org', 'admin', 'Designated Urban Emergency Operations Admin'),
  ('responder@baywatch.org', 'responder', 'Designated Field Incident Response Officer'),
  ('ops-admin@aapda.gov.in', 'admin', 'Municipal Disaster Management Authority Administrator'),
  ('ops-responder@aapda.gov.in', 'responder', 'Ward Emergency Response Commander')
ON CONFLICT (email) DO UPDATE SET
  role = EXCLUDED.role,
  notes = EXCLUDED.notes;

-- ---------------------------------------------------------------------
-- 2. Drop any legacy trigger that allowed public signup role escalation
-- ---------------------------------------------------------------------
-- Ensure public signup or email updates on auth.users NEVER automatically
-- grant operational roles based on self-reported email strings.
DROP TRIGGER IF EXISTS trg_assign_preauthorized_operational_role ON auth.users;
DROP FUNCTION IF EXISTS public.handle_preauthorized_operational_role();

-- ---------------------------------------------------------------------
-- 3. Hardened public.handle_new_user for public signup
-- ---------------------------------------------------------------------
-- Public signups unconditionally default to 'citizen'. Privileged roles
-- can never be injected through client-supplied metadata or signup fields.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Guarantee that public signups always receive citizen role in app_metadata
  -- unless explicitly pre-configured by a trusted service-role process.
  IF NEW.raw_app_meta_data IS NULL OR NOT (NEW.raw_app_meta_data ? 'role') THEN
    NEW.raw_app_meta_data := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('role', 'citizen');
  END IF;

  INSERT INTO public.profiles (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_app_meta_data->>'role', 'citizen')
  )
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        role = EXCLUDED.role,
        updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Explicit Evaluator / Operational Account Provisioning Procedure
-- ---------------------------------------------------------------------
-- This procedure can ONLY be executed by an existing administrator.
-- It explicitly validates caller permissions and applies the role to
-- auth.users.raw_app_meta_data and public.profiles.
CREATE OR REPLACE FUNCTION public.provision_operational_account(
  target_email TEXT,
  target_role TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  resolved_role TEXT;
  matched_user_id UUID;
BEGIN
  -- Strict guard: Only an authorized admin may execute operational provisioning
  IF public.current_app_role() <> 'admin' THEN
    RAISE EXCEPTION 'unauthorized: only an admin may provision operational accounts'
      USING ERRCODE = '42501';
  END IF;

  -- Determine designated role
  IF target_role IS NOT NULL THEN
    resolved_role := target_role;
  ELSE
    SELECT role INTO resolved_role
      FROM public.preauthorized_operational_roles
     WHERE LOWER(email) = LOWER(target_email);
  END IF;

  IF resolved_role IS NULL OR resolved_role NOT IN ('responder', 'admin') THEN
    RAISE EXCEPTION 'invalid or unapproved operational role: %', resolved_role
      USING ERRCODE = '22023';
  END IF;

  -- Locate registered account
  SELECT id INTO matched_user_id
    FROM auth.users
   WHERE LOWER(email) = LOWER(target_email);

  IF matched_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'user not found in auth.users: account must exist before operational role provisioning',
      'email', target_email
    );
  END IF;

  -- Authoritatively assign role in app_metadata
  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('role', resolved_role)
   WHERE id = matched_user_id;

  -- Authoritatively synchronize profiles.role
  UPDATE public.profiles
     SET role = resolved_role,
         updated_at = now()
   WHERE id = matched_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', matched_user_id,
    'email', target_email,
    'role', resolved_role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provision_operational_account(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_operational_account(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_operational_account(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Trusted migration-time sync for existing operational accounts
-- ---------------------------------------------------------------------
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN SELECT email, role FROM public.preauthorized_operational_roles LOOP
    UPDATE auth.users
       SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('role', rec.role)
     WHERE LOWER(email) = LOWER(rec.email);

    UPDATE public.profiles
       SET role = rec.role,
           updated_at = now()
     WHERE LOWER(email) = LOWER(rec.email);
  END LOOP;
END;
$$;
