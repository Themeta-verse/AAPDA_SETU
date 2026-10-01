import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Static assertions over the migration SQL.
 *
 * These do NOT prove the policies behave correctly against a live database —
 * that requires applying the migration and probing it with real roles. What
 * they do guarantee is that the specific authorization defects found in audit
 * cannot be reintroduced silently by a later edit.
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');

const sql = readFileSync(
  resolve(MIGRATIONS_DIR, '20260330120000_security_hardening.sql'),
  'utf8'
);

const baselineSql = readFileSync(
  resolve(MIGRATIONS_DIR, '20260308175355_9dfc122f-c459-43ed-8fb2-9d7d1e88a2cc.sql'),
  'utf8'
);

/** Collapse whitespace/comments so formatting cannot hide a change. */
const normalize = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

const flat = normalize(sql);

describe('authorization claim source', () => {
  it('reads the role from app_metadata, not user_metadata', () => {
    expect(flat).toContain("auth.jwt() -> 'app_metadata' ->> 'role'");
    expect(flat).not.toContain("auth.jwt() ->> 'role'");
  });

  it('never authorizes against user_metadata, which the client can edit', () => {
    expect(flat).not.toContain("-> 'user_metadata'");
  });

  it('defaults to the least-privileged role when no claim is present', () => {
    expect(flat).toMatch(/COALESCE\([\s\S]*?'citizen'\s*\)/);
  });

  it('grants operational access only to responder and admin', () => {
    expect(flat).toContain("current_app_role() IN ('responder', 'admin')");
  });
});

describe('privilege escalation', () => {
  it('prevents a user from updating their own role column', () => {
    expect(flat).toContain('REVOKE UPDATE ON public.profiles FROM authenticated');
    expect(flat).toContain(
      'GRANT UPDATE (name, phone, latitude, longitude) ON public.profiles TO authenticated'
    );
  });

  it('restricts role assignment to an admin via SECURITY DEFINER', () => {
    expect(flat).toContain('SECURITY DEFINER');
    expect(flat).toContain("IF public.current_app_role() <> 'admin' THEN");
  });

  it('re-executes the admin check inside the function, not only at the boundary', () => {
    // Guards against granting EXECUTE without an in-function check.
    const fn = flat.slice(flat.indexOf('FUNCTION public.set_user_role'));
    expect(fn).toContain("current_app_role() <> 'admin'");
  });

  it('writes the role to app_metadata, the claim clients cannot forge', () => {
    expect(flat).toContain('raw_app_meta_data');
  });
});

describe('incident photo storage', () => {
  it('does not allow any authenticated user to read any photo', () => {
    expect(flat).not.toMatch(
      /USING \(\s*bucket_id = 'incident-photos'\s*\)/
    );
  });

  it('scopes upload to the uploader own folder', () => {
    expect(flat).toMatch(
      /FOR INSERT TO authenticated WITH CHECK \(\s*bucket_id = 'incident-photos' AND \(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::TEXT\s*\)/
    );
  });

  it('limits read to the owner or an operational role', () => {
    expect(flat).toMatch(
      /FOR SELECT TO authenticated USING \(\s*bucket_id = 'incident-photos' AND \(\s*\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::TEXT OR public\.is_responder\(\)\s*\)\s*\)/
    );
  });

  it('keeps the bucket private so photos need a signed URL', () => {
    expect(flat).toContain("SET public = false");
  });
});

describe('incident reports', () => {
  it('keeps reports append-only with no update or delete policy', () => {
    expect(flat).not.toMatch(/ON public\.incident_reports\s+FOR UPDATE/);
    expect(flat).not.toMatch(/ON public\.incident_reports\s+FOR DELETE/);
  });

  it('preserves the owner-insert rule from the baseline', () => {
    expect(normalize(baselineSql)).toContain(
      "FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)"
    );
  });

  it('preserves the owner-read rule from the baseline', () => {
    expect(normalize(baselineSql)).toContain(
      'FOR SELECT TO authenticated USING (user_id = auth.uid())'
    );
  });
});

describe('defect regression guards', () => {
  it('the baseline migration did use the broken top-level role claim', () => {
    // If this ever fails, the original defect is already fixed elsewhere and
    // this guard can be retired.
    expect(normalize(baselineSql)).toContain("auth.jwt() ->> 'role'");
  });

  it('drops the inert admin/responder policies it replaces', () => {
    expect(flat).toContain('DROP POLICY IF EXISTS "Admins can read all profiles"');
    expect(flat).toContain(
      'DROP POLICY IF EXISTS "Responders can read operational reports"'
    );
    expect(flat).toContain('DROP POLICY IF EXISTS "Authorized users can view incident photos"');
  });

  it('enables RLS on every table it relies on', () => {
    // RLS enablement lives in the baseline migration and must not be removed.
    expect(normalize(baselineSql)).toContain(
      'ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY'
    );
    expect(normalize(baselineSql)).toContain(
      'ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY'
    );
  });
});

const resourceSql = readFileSync(
  resolve(MIGRATIONS_DIR, '20261001120000_resource_command_center.sql'),
  'utf8'
);
const flatResource = normalize(resourceSql);

describe('resource command center RLS policies', () => {
  it('enables RLS on all resource tables', () => {
    expect(flatResource).toContain('ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY');
    expect(flatResource).toContain('ALTER TABLE public.resource_allocations ENABLE ROW LEVEL SECURITY');
    expect(flatResource).toContain('ALTER TABLE public.resource_audit_logs ENABLE ROW LEVEL SECURITY');
    expect(flatResource).toContain('ALTER TABLE public.resource_incident_compatibility ENABLE ROW LEVEL SECURITY');
  });

  it('allows situational read of resources inventory to authenticated users', () => {
    expect(flatResource).toContain(
      'CREATE POLICY "Authenticated users can read resources" ON public.resources FOR SELECT TO authenticated USING (true)'
    );
  });

  it('restricts resource mutations to responders and admins (public.is_responder)', () => {
    expect(flatResource).toContain(
      'CREATE POLICY "Responders can insert resources" ON public.resources FOR INSERT TO authenticated WITH CHECK ( public.is_responder() )'
    );
    expect(flatResource).toContain(
      'CREATE POLICY "Responders can update resources" ON public.resources FOR UPDATE TO authenticated USING ( public.is_responder() )'
    );
  });

  it('restricts resource deletion to admins only (current_app_role() = admin)', () => {
    expect(flatResource).toContain(
      'CREATE POLICY "Admins can delete resources" ON public.resources FOR DELETE TO authenticated USING ( public.current_app_role() = \'admin\' )'
    );
  });

  it('restricts allocation creation and updates to responders and admins', () => {
    expect(flatResource).toContain(
      'CREATE POLICY "Responders can create resource allocations" ON public.resource_allocations FOR INSERT TO authenticated WITH CHECK ( public.is_responder() )'
    );
    expect(flatResource).toContain(
      'CREATE POLICY "Responders can update resource allocations" ON public.resource_allocations FOR UPDATE TO authenticated USING ( public.is_responder() )'
    );
  });

  it('restricts allocation deletion to admins only', () => {
    expect(flatResource).toContain(
      'CREATE POLICY "Admins can delete resource allocations" ON public.resource_allocations FOR DELETE TO authenticated USING ( public.current_app_role() = \'admin\' )'
    );
  });

  it('restricts audit log reading and writing to operational roles', () => {
    expect(flatResource).toContain(
      'CREATE POLICY "Responders can read resource audit logs" ON public.resource_audit_logs FOR SELECT TO authenticated USING ( public.is_responder() )'
    );
    expect(flatResource).toContain(
      'CREATE POLICY "Responders can insert resource audit logs" ON public.resource_audit_logs FOR INSERT TO authenticated WITH CHECK ( public.is_responder() )'
    );
  });

  it('restricts compatibility matrix management to admin', () => {
    expect(flatResource).toContain(
      'CREATE POLICY "Admins can manage resource compatibility" ON public.resource_incident_compatibility FOR ALL TO authenticated USING ( public.current_app_role() = \'admin\' )'
    );
  });
});

const provisionSql = readFileSync(
  resolve(MIGRATIONS_DIR, '20261001150000_provision_demo_operational_roles.sql'),
  'utf8'
);
const flatProvision = normalize(provisionSql);

describe('evaluator and operational account registry security', () => {
  it('enables RLS on preauthorized_operational_roles table', () => {
    expect(flatProvision).toContain('ALTER TABLE public.preauthorized_operational_roles ENABLE ROW LEVEL SECURITY');
  });

  it('revokes default table permissions from anon and authenticated', () => {
    expect(flatProvision).toContain('REVOKE ALL ON public.preauthorized_operational_roles FROM anon, authenticated');
  });

  it('restricts SELECT on preauthorized roles strictly to authenticated admins', () => {
    expect(flatProvision).toContain(
      'CREATE POLICY "Admins can view preauthorized operational roles" ON public.preauthorized_operational_roles FOR SELECT TO authenticated USING (public.current_app_role() = \'admin\')'
    );
  });

  it('restricts INSERT on preauthorized roles strictly to authenticated admins', () => {
    expect(flatProvision).toContain(
      'CREATE POLICY "Admins can insert preauthorized operational roles" ON public.preauthorized_operational_roles FOR INSERT TO authenticated WITH CHECK (public.current_app_role() = \'admin\')'
    );
  });

  it('restricts UPDATE on preauthorized roles strictly to authenticated admins', () => {
    expect(flatProvision).toContain(
      'CREATE POLICY "Admins can update preauthorized operational roles" ON public.preauthorized_operational_roles FOR UPDATE TO authenticated USING (public.current_app_role() = \'admin\')'
    );
  });

  it('restricts DELETE on preauthorized roles strictly to authenticated admins', () => {
    expect(flatProvision).toContain(
      'CREATE POLICY "Admins can delete preauthorized operational roles" ON public.preauthorized_operational_roles FOR DELETE TO authenticated USING (public.current_app_role() = \'admin\')'
    );
  });

  it('drops legacy automatic triggers to ensure public signups never receive operational roles', () => {
    expect(flatProvision).toContain('DROP TRIGGER IF EXISTS trg_assign_preauthorized_operational_role ON auth.users');
    expect(flatProvision).toContain('DROP FUNCTION IF EXISTS public.handle_preauthorized_operational_role()');
  });

  it('guarantees public signup unconditionally defaults to citizen in app_metadata', () => {
    expect(flatProvision).toContain("jsonb_build_object('role', 'citizen')");
    expect(flatProvision).toContain("COALESCE(NEW.raw_app_meta_data->>'role', 'citizen')");
  });

  it('provisions operational accounts only via explicit admin-guarded procedure with strict search_path', () => {
    expect(flatProvision).toContain('CREATE OR REPLACE FUNCTION public.provision_operational_account');
    expect(flatProvision).toContain('SET search_path = public, auth');
    expect(flatProvision).toContain("IF public.current_app_role() <> 'admin' THEN");
    expect(flatProvision).toContain("REVOKE ALL ON FUNCTION public.provision_operational_account(TEXT, TEXT) FROM anon");
  });

  it('seeds designated admin and responder operational records', () => {
    expect(flatProvision).toContain('admin@baywatch.org');
    expect(flatProvision).toContain('responder@baywatch.org');
    expect(flatProvision).toContain('ops-admin@aapda.gov.in');
    expect(flatProvision).toContain('ops-responder@aapda.gov.in');
  });
});
