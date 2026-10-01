-- =====================================================================
-- Migration: 20261001170000_bootstrap_admin_account.sql
-- Description: Bootstrap operational administrator provisioning, schema
-- enhancements for operational profiles, and authoritative administrative
-- user management functions.
--
-- Security Guarantees:
-- 1. admin123@gmail.com is provisioned safely and idempotently as an authoritative
--    admin with encrypted password and app_metadata.role = 'admin'.
-- 2. Ordinary signups continue creating ONLY citizen accounts.
-- 3. Only authenticated administrators (public.current_app_role() = 'admin')
--    can list, provision, modify, or revoke operational roles.
-- 4. No plaintext passwords stored in public tables.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Schema Enhancement: add email to public.profiles
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill profile emails from auth.users where possible
DO $$
BEGIN
  UPDATE public.profiles p
     SET email = LOWER(u.email)
    FROM auth.users u
   WHERE p.id = u.id
     AND (p.email IS NULL OR p.email = '');
EXCEPTION WHEN OTHERS THEN
  -- Non-fatal if auth.users is restricted during migration context
  NULL;
END;
$$;

-- ---------------------------------------------------------------------
-- 2. Safe & Idempotent Bootstrap Administrator Provisioning
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_user_id UUID;
  v_encrypted_pw TEXT;
BEGIN
  -- Compute bcrypt password hash for 'admin123'
  BEGIN
    SELECT extensions.crypt('admin123', extensions.gen_salt('bf')) INTO v_encrypted_pw;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      SELECT crypt('admin123', gen_salt('bf')) INTO v_encrypted_pw;
    EXCEPTION WHEN OTHERS THEN
      v_encrypted_pw := NULL;
    END;
  END;

  -- Locate existing auth user
  SELECT id INTO v_user_id
    FROM auth.users
   WHERE LOWER(email) = 'admin123@gmail.com';

  IF v_user_id IS NOT NULL THEN
    -- Synchronize existing account to authoritative admin
    UPDATE auth.users
       SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', 'admin'),
           raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                             || jsonb_build_object('name', 'Operational Administrator'),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           encrypted_password = COALESCE(v_encrypted_pw, encrypted_password),
           updated_at = now()
     WHERE id = v_user_id;
  ELSE
    -- Create new auth user
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      aud,
      role
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'admin123@gmail.com',
      COALESCE(v_encrypted_pw, ''),
      now(),
      jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', 'admin'),
      jsonb_build_object('name', 'Operational Administrator'),
      now(),
      now(),
      'authenticated',
      'authenticated'
    );
  END IF;

  -- Synchronize public.profiles
  INSERT INTO public.profiles (id, email, name, role, updated_at)
  VALUES (v_user_id, 'admin123@gmail.com', 'Operational Administrator', 'admin', now())
  ON CONFLICT (id) DO UPDATE SET
    role = 'admin',
    email = 'admin123@gmail.com',
    name = CASE WHEN public.profiles.name IS NULL OR public.profiles.name = '' THEN 'Operational Administrator' ELSE public.profiles.name END,
    updated_at = now();

  -- Add to preauthorized registry if table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'preauthorized_operational_roles') THEN
    INSERT INTO public.preauthorized_operational_roles (email, role, notes)
    VALUES ('admin123@gmail.com', 'admin', 'Designated Bootstrap Operational Administrator')
    ON CONFLICT (email) DO UPDATE SET
      role = 'admin',
      notes = EXCLUDED.notes;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. Bootstrap Admin Sync RPC Function
-- ---------------------------------------------------------------------
-- Idempotent helper to synchronize admin123@gmail.com whenever called.
-- Strictly scoped to this bootstrap account; cannot promote arbitrary callers.
CREATE OR REPLACE FUNCTION public.bootstrap_admin_account()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE LOWER(email) = 'admin123@gmail.com';
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'admin123@gmail.com does not exist');
  END IF;

  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', 'admin'),
         updated_at = now()
   WHERE id = v_user_id;

  INSERT INTO public.profiles (id, email, name, role, updated_at)
  VALUES (v_user_id, 'admin123@gmail.com', 'Operational Administrator', 'admin', now())
  ON CONFLICT (id) DO UPDATE SET
    role = 'admin',
    email = 'admin123@gmail.com',
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id, 'role', 'admin');
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_admin_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_admin_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_admin_account() TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Authoritative Admin RPC: List Operational Users
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_operational_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  name TEXT,
  role TEXT,
  created_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF public.current_app_role() <> 'admin' THEN
    RAISE EXCEPTION 'unauthorized: only an administrator can view operational users'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::TEXT,
    COALESCE(p.name, u.raw_user_meta_data->>'name', '')::TEXT AS name,
    COALESCE(u.raw_app_meta_data->>'role', p.role, 'citizen')::TEXT AS role,
    u.created_at,
    u.last_sign_in_at,
    CASE
      WHEN u.banned_until IS NOT NULL AND u.banned_until > now() THEN 'suspended'
      WHEN u.confirmed_at IS NOT NULL OR u.email_confirmed_at IS NOT NULL THEN 'active'
      ELSE 'pending'
    END::TEXT AS status
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  ORDER BY
    CASE COALESCE(u.raw_app_meta_data->>'role', p.role, 'citizen')
      WHEN 'admin' THEN 1
      WHEN 'responder' THEN 2
      ELSE 3
    END,
    u.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_operational_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_operational_users() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_operational_users() TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Authoritative Admin RPC: Provision Operational User
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_operational_user(
  user_email TEXT,
  user_password TEXT,
  user_name TEXT,
  user_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_encrypted_pw TEXT;
  clean_email TEXT;
BEGIN
  IF public.current_app_role() <> 'admin' THEN
    RAISE EXCEPTION 'unauthorized: only an administrator can provision operational users'
      USING ERRCODE = '42501';
  END IF;

  clean_email := LOWER(TRIM(user_email));
  IF clean_email IS NULL OR clean_email = '' OR clean_email NOT LIKE '%@%.%' THEN
    RAISE EXCEPTION 'invalid email address: %', user_email
      USING ERRCODE = '22023';
  END IF;

  IF user_role NOT IN ('responder', 'admin') THEN
    RAISE EXCEPTION 'invalid operational role: %, must be responder or admin', user_role
      USING ERRCODE = '22023';
  END IF;

  -- Compute encrypted password
  IF user_password IS NOT NULL AND LENGTH(user_password) >= 6 THEN
    BEGIN
      SELECT extensions.crypt(user_password, extensions.gen_salt('bf')) INTO v_encrypted_pw;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        SELECT crypt(user_password, gen_salt('bf')) INTO v_encrypted_pw;
      EXCEPTION WHEN OTHERS THEN
        v_encrypted_pw := NULL;
      END;
    END;
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE LOWER(email) = clean_email;

  IF v_user_id IS NOT NULL THEN
    -- Update existing user
    UPDATE auth.users
       SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', user_role),
           raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                             || jsonb_build_object('name', COALESCE(NULLIF(user_name, ''), raw_user_meta_data->>'name', '')),
           encrypted_password = COALESCE(v_encrypted_pw, encrypted_password),
           updated_at = now()
     WHERE id = v_user_id;

    UPDATE public.profiles
       SET role = user_role,
           name = COALESCE(NULLIF(user_name, ''), name),
           email = clean_email,
           updated_at = now()
     WHERE id = v_user_id;
  ELSE
    -- Insert new auth user
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      aud,
      role
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      clean_email,
      COALESCE(v_encrypted_pw, ''),
      now(),
      jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', user_role),
      jsonb_build_object('name', COALESCE(user_name, '')),
      now(),
      now(),
      'authenticated',
      'authenticated'
    );

    INSERT INTO public.profiles (id, email, name, role, updated_at)
    VALUES (v_user_id, clean_email, COALESCE(user_name, ''), user_role, now())
    ON CONFLICT (id) DO UPDATE SET
      role = user_role,
      email = clean_email,
      name = COALESCE(NULLIF(user_name, ''), public.profiles.name),
      updated_at = now();
  END IF;

  -- Keep preauthorized table updated if present
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'preauthorized_operational_roles') THEN
    INSERT INTO public.preauthorized_operational_roles (email, role, notes)
    VALUES (clean_email, user_role, 'Provisioned by Admin ' || COALESCE(auth.jwt()->>'email', 'system'))
    ON CONFLICT (email) DO UPDATE SET
      role = EXCLUDED.role,
      notes = EXCLUDED.notes;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'email', clean_email,
    'role', user_role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_operational_user(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_operational_user(TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_create_operational_user(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Authoritative Admin RPC: Update Operational User Role
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  target_user_id UUID,
  new_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_target_email TEXT;
  v_current_role TEXT;
  v_admin_count INT;
BEGIN
  IF public.current_app_role() <> 'admin' THEN
    RAISE EXCEPTION 'unauthorized: only an administrator can change user roles'
      USING ERRCODE = '42501';
  END IF;

  IF new_role NOT IN ('citizen', 'responder', 'admin') THEN
    RAISE EXCEPTION 'invalid role: %, must be citizen, responder, or admin', new_role
      USING ERRCODE = '22023';
  END IF;

  SELECT email, COALESCE(raw_app_meta_data->>'role', 'citizen')
    INTO v_target_email, v_current_role
    FROM auth.users
   WHERE id = target_user_id;

  IF v_target_email IS NULL THEN
    RAISE EXCEPTION 'user not found with id: %', target_user_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Guard against demoting the sole remaining administrator
  IF target_user_id = auth.uid() AND new_role <> 'admin' THEN
    SELECT COUNT(*) INTO v_admin_count
      FROM auth.users
     WHERE (raw_app_meta_data->>'role') = 'admin'
       AND id <> target_user_id;

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'cannot demote the sole administrator'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Authoritatively update app_metadata
  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('role', new_role),
         updated_at = now()
   WHERE id = target_user_id;

  -- Authoritatively synchronize profiles
  UPDATE public.profiles
     SET role = new_role,
         updated_at = now()
   WHERE id = target_user_id;

  -- Maintain preauthorized table
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'preauthorized_operational_roles') THEN
    IF new_role = 'citizen' THEN
      DELETE FROM public.preauthorized_operational_roles WHERE LOWER(email) = LOWER(v_target_email);
    ELSE
      INSERT INTO public.preauthorized_operational_roles (email, role, notes)
      VALUES (LOWER(v_target_email), new_role, 'Role updated by Admin')
      ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', target_user_id,
    'email', v_target_email,
    'role', new_role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user_role(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_user_role(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. Authoritative Admin RPC: Revoke Operational Access
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revoke_operational_access(
  target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN public.admin_update_user_role(target_user_id, 'citizen');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_operational_access(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_revoke_operational_access(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_operational_access(UUID) TO authenticated;
