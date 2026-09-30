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