-- =====================================================================
-- Security hardening.
--
-- 1. Trusted authorization role source (app_metadata, not user_metadata).
-- 2. Incident photo storage scoped to the uploader's folder.
-- 3. Incident report access matching the real application model.
-- 4. Column-level protection so a user cannot self-promote their role.
--
-- Nothing here changes the incident reporting workflow: a signed-in user can
-- still create a report and read their own report and their own photo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Trusted role accessor
-- ---------------------------------------------------------------------
-- Why app_metadata: `user_metadata` is supplied by the client at sign-up
-- (`supabase.auth.signUp({ options: { data } })`, see src/hooks/useAuth.ts)
-- and is freely editable by the user via `supabase.auth.updateUser()`.
-- `app_metadata` can only be written with the service-role key, so it is the
-- only claim that is safe to authorize against.
--
-- `auth.jwt() ->> 'role'` (used by the previous policies) returns the
-- Postgres role — 'authenticated' — so those policies never matched anyone.
--
-- The COALESCE default keeps existing users working: nobody has an
-- app_metadata role yet, so everyone correctly resolves to 'citizen'.
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', 'citizen');
$$;

COMMENT ON FUNCTION public.current_app_role() IS
  'Trusted application role from app_metadata. Defaults to citizen.';

-- Operational role check. Only 'responder' and 'admin' see operational data.
CREATE OR REPLACE FUNCTION public.is_responder()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT public.current_app_role() IN ('responder', 'admin');
$$;

-- ---------------------------------------------------------------------
-- Role assignment, server-side only.
-- ---------------------------------------------------------------------
-- SECURITY DEFINER so it can write auth.users. The guard is re-checked
-- inside the function, so EXECUTE being granted to `authenticated` does not
-- let a citizen call it. Clients can never call this: it changes
-- app_metadata, which the anon/authenticated keys cannot write.
--
-- BOOTSTRAP: the first admin cannot be created by this function (no admin
-- exists yet). Promote it once with the service-role key or SQL:
--   UPDATE auth.users
--      SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
--                            || '{"role":"admin"}'::jsonb
--    WHERE email = 'ops@example.com';
CREATE OR REPLACE FUNCTION public.set_user_role(target_user_id UUID, new_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_app_role() <> 'admin' THEN
    RAISE EXCEPTION 'only an admin may change user roles'
      USING ERRCODE = '42501';
  END IF;

  IF new_role NOT IN ('citizen', 'responder', 'admin') THEN
    RAISE EXCEPTION 'invalid role: %', new_role
      USING ERRCODE = '22023';
  END IF;

  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('role', new_role)
   WHERE id = target_user_id;

  -- Keep the denormalized profile column in step for display purposes.
  UPDATE public.profiles
     SET role = new_role, updated_at = now()
   WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_role(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. profiles
-- ---------------------------------------------------------------------
-- The previous "admin" policy read the wrong claim and never matched.
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;

CREATE POLICY "Responders can read operational profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_responder());

-- A user could previously UPDATE their own profile row and set
-- role = 'admin' on it. RLS is row-level, so restrict the writable columns.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (name, phone, latitude, longitude) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Incident reports
-- ---------------------------------------------------------------------
-- Model actually in use (src/components/CitizenReporting.tsx):
--   - any signed-in user INSERTs a report owned by themselves
--   - the owner reads their own reports
--   - responders/admins read all reports for operations
-- Inserts and owner reads are already correct; only the responder policy is
-- rebuilt, because it referenced the wrong claim.
DROP POLICY IF EXISTS "Responders can read operational reports" ON public.incident_reports;

CREATE POLICY "Responders can read operational reports" ON public.incident_reports
  FOR SELECT TO authenticated
  USING (public.is_responder());

-- Reports are append-only: no UPDATE or DELETE policy exists, and none is
-- added, so a reporter cannot silently edit or erase a submission.

-- ---------------------------------------------------------------------
-- 4. Incident photo storage
-- ---------------------------------------------------------------------
-- Path convention, from CitizenReporting.handleSubmit:
--     const path = `${userId}/${Date.now()}.${ext}`;
-- so the first path segment is the uploader's auth user id. The previous
-- SELECT policy allowed ANY authenticated user to read ANY photo, including
-- geotagged evidence of private homes.
DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
DROP POLICY IF EXISTS "Authorized users can view incident photos" ON storage.objects;

-- Only write into your own folder.
CREATE POLICY "Users can upload their own incident photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'incident-photos'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- Owner or operational role only. No blanket authenticated read.
CREATE POLICY "Owners and responders can view incident photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'incident-photos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::TEXT
      OR public.is_responder()
    )
  );

-- A reporter can remove their own upload; nobody else can.
CREATE POLICY "Users can delete their own incident photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'incident-photos'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- Keep the bucket private. Photos are served through short-lived signed
-- URLs, never a public URL.
UPDATE storage.buckets
   SET public = false
 WHERE id = 'incident-photos';
