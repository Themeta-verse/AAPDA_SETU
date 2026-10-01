import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { User } from '@supabase/supabase-js';
import { isAppRole, readAppRole, useAppRole } from '@/hooks/useAppRole';
import { renderHook } from '@testing-library/react';

/**
 * Complete Role & Operational Verification Test Suite
 *
 * Verifies all 13 mandatory architecture requirements:
 * 1. citizen role → citizen workspace
 * 2. responder role → operational response workspace
 * 3. admin role → operational administration workspace
 * 4. missing role → citizen
 * 5. invalid role → citizen
 * 6. user_metadata.role cannot elevate authorization
 * 7. normal signup cannot specify responder
 * 8. normal signup cannot specify admin
 * 9. evaluator email alone cannot elevate a public signup
 * 10. ResourceCommandCenter remains RLS-protected
 * 11. responder receives responder capabilities
 * 12. admin receives admin capabilities
 * 13. citizen does not receive operational mutation capabilities
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');
const normalize = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

const hardeningSql = normalize(readFileSync(resolve(MIGRATIONS_DIR, '20260330120000_security_hardening.sql'), 'utf8'));
const rccSql = normalize(readFileSync(resolve(MIGRATIONS_DIR, '20261001120000_resource_command_center.sql'), 'utf8'));
const provisionSql = normalize(readFileSync(resolve(MIGRATIONS_DIR, '20261001150000_provision_demo_operational_roles.sql'), 'utf8'));
const bootstrapSql = normalize(readFileSync(resolve(MIGRATIONS_DIR, '20261001170000_bootstrap_admin_account.sql'), 'utf8'));

function makeUser(appMetadata: Record<string, unknown> = {}, userMetadata: Record<string, unknown> = {}): User {
  return {
    id: 'test-user-id',
    app_metadata: appMetadata,
    user_metadata: userMetadata,
  } as unknown as User;
}

describe('1. citizen role → citizen workspace', () => {
  it('resolves citizen role and flags isOperational=false, isAdmin=false', () => {
    const user = makeUser({ role: 'citizen' });
    const { result } = renderHook(() => useAppRole(user));

    expect(result.current.role).toBe('citizen');
    expect(result.current.isOperational).toBe(false);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isSignedIn).toBe(true);
  });
});

describe('2. responder role → operational response workspace', () => {
  it('resolves responder role and flags isOperational=true, isAdmin=false', () => {
    const user = makeUser({ role: 'responder' });
    const { result } = renderHook(() => useAppRole(user));

    expect(result.current.role).toBe('responder');
    expect(result.current.isOperational).toBe(true);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isSignedIn).toBe(true);
  });
});

describe('3. admin role → operational administration workspace', () => {
  it('resolves admin role and flags isOperational=true, isAdmin=true', () => {
    const user = makeUser({ role: 'admin' });
    const { result } = renderHook(() => useAppRole(user));

    expect(result.current.role).toBe('admin');
    expect(result.current.isOperational).toBe(true);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isSignedIn).toBe(true);
  });
});

describe('4. missing role → citizen', () => {
  it('defaults to citizen when app_metadata has no role key or is empty', () => {
    expect(readAppRole(makeUser({}))).toBe('citizen');
    expect(readAppRole(makeUser())).toBe('citizen');
    expect(readAppRole(null)).toBe('citizen');
    expect(readAppRole(undefined)).toBe('citizen');
  });
});

describe('5. invalid role → citizen', () => {
  it('rejects unauthorized or arbitrary role strings and falls back to citizen', () => {
    expect(readAppRole(makeUser({ role: 'superadmin' }))).toBe('citizen');
    expect(readAppRole(makeUser({ role: 'Admin' }))).toBe('citizen');
    expect(readAppRole(makeUser({ role: 'hacker' }))).toBe('citizen');
    expect(readAppRole(makeUser({ role: 'root' }))).toBe('citizen');
    expect(readAppRole(makeUser({ role: 123 }))).toBe('citizen');
    expect(readAppRole(makeUser({ role: '' }))).toBe('citizen');
  });
});

describe('6. user_metadata.role cannot elevate authorization', () => {
  it('ignores user_metadata claim even when forged as admin or responder', () => {
    const forgedAdmin = makeUser({}, { role: 'admin' });
    const forgedResponder = makeUser({}, { role: 'responder' });

    expect(readAppRole(forgedAdmin)).toBe('citizen');
    expect(readAppRole(forgedResponder)).toBe('citizen');

    // Conflict test: app_metadata is citizen, user_metadata claims admin
    const conflicting = makeUser({ role: 'citizen' }, { role: 'admin' });
    expect(readAppRole(conflicting)).toBe('citizen');
  });
});

describe('7. normal signup cannot specify responder', () => {
  it('verifies handle_new_user unconditionally sets citizen in app_metadata', () => {
    expect(provisionSql).toContain("NEW.raw_app_meta_data := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'citizen')");
  });
});

describe('8. normal signup cannot specify admin', () => {
  it('verifies server-side authorization role trigger ignores client raw_user_meta_data for role', () => {
    // Only 'name' is extracted from raw_user_meta_data
    expect(provisionSql).toContain("COALESCE(NEW.raw_user_meta_data->>'name', '')");
    expect(provisionSql).not.toContain("raw_user_meta_data->>'role'");
  });
});

describe('9. evaluator email alone cannot elevate a public signup', () => {
  it('ensures legacy automatic signup trigger is dropped', () => {
    expect(provisionSql).toContain('DROP TRIGGER IF EXISTS trg_assign_preauthorized_operational_role ON auth.users');
    expect(provisionSql).toContain('DROP FUNCTION IF EXISTS public.handle_preauthorized_operational_role()');
  });

  it('guarantees preauthorized table access is revoked from anon and ordinary authenticated users', () => {
    expect(provisionSql).toContain('REVOKE ALL ON public.preauthorized_operational_roles FROM anon, authenticated');
    expect(provisionSql).toContain("CREATE POLICY \"Admins can view preauthorized operational roles\" ON public.preauthorized_operational_roles FOR SELECT TO authenticated USING (public.current_app_role() = 'admin')");
  });
});

describe('10. ResourceCommandCenter remains RLS-protected', () => {
  it('enforces is_responder() for inserting and updating resources', () => {
    expect(rccSql).toContain('CREATE POLICY "Responders can insert resources" ON public.resources FOR INSERT TO authenticated WITH CHECK ( public.is_responder() )');
    expect(rccSql).toContain('CREATE POLICY "Responders can update resources" ON public.resources FOR UPDATE TO authenticated USING ( public.is_responder() )');
  });

  it('enforces admin check for deleting resources', () => {
    expect(rccSql).toContain("CREATE POLICY \"Admins can delete resources\" ON public.resources FOR DELETE TO authenticated USING ( public.current_app_role() = 'admin' )");
  });

  it('enforces operational check for viewing operational audit logs', () => {
    expect(rccSql).toContain('CREATE POLICY "Responders can read resource audit logs" ON public.resource_audit_logs FOR SELECT TO authenticated USING ( public.is_responder() )');
  });
});

describe('11. responder receives responder capabilities', () => {
  it('verifies RLS allows responder to create allocations and update statuses', () => {
    expect(rccSql).toContain('CREATE POLICY "Responders can create resource allocations" ON public.resource_allocations FOR INSERT TO authenticated WITH CHECK ( public.is_responder() )');
    expect(rccSql).toContain('CREATE POLICY "Responders can update resource allocations" ON public.resource_allocations FOR UPDATE TO authenticated USING ( public.is_responder() )');
  });
});

describe('12. admin receives admin capabilities', () => {
  it('verifies RLS allows admin deletion of allocations and compatibility management', () => {
    expect(rccSql).toContain("CREATE POLICY \"Admins can delete resource allocations\" ON public.resource_allocations FOR DELETE TO authenticated USING ( public.current_app_role() = 'admin' )");
    expect(rccSql).toContain("CREATE POLICY \"Admins can manage resource compatibility\" ON public.resource_incident_compatibility FOR ALL TO authenticated USING ( public.current_app_role() = 'admin' )");
  });

  it('verifies single authoritative admin-guarded operational account provisioning procedure exists and is restricted from anon', () => {
    expect(provisionSql).toContain('CREATE OR REPLACE FUNCTION public.provision_operational_account');
    expect(provisionSql).toContain("IF public.current_app_role() <> 'admin' THEN");
    expect(provisionSql).toContain("REVOKE ALL ON FUNCTION public.provision_operational_account(TEXT, TEXT) FROM anon");
    expect(provisionSql).toContain("GRANT EXECUTE ON FUNCTION public.provision_operational_account(TEXT, TEXT) TO authenticated");
  });
});

describe('13. citizen does not receive operational mutation capabilities', () => {
  it('verifies public.is_responder() strictly requires responder or admin', () => {
    expect(hardeningSql).toContain("SELECT public.current_app_role() IN ('responder', 'admin')");
  });

  it('verifies citizen cannot update profiles.role column', () => {
    expect(hardeningSql).toContain('REVOKE UPDATE ON public.profiles FROM authenticated');
    expect(hardeningSql).toContain('GRANT UPDATE (name, phone, latitude, longitude) ON public.profiles TO authenticated');
  });
});

describe('14. production migrations do NOT contain hardcoded personal evaluator emails', () => {
  it('ensures no production migration contains hardcoded personal evaluator emails or auto-promotions', () => {
    const migrationFiles = [
      '20260308175355_9dfc122f-c459-43ed-8fb2-9d7d1e88a2cc.sql',
      '20260330120000_security_hardening.sql',
      '20260930120000_sms_emergency_alerts.sql',
      '20261001120000_resource_command_center.sql',
      '20261001140000_urban_location_hierarchy.sql',
      '20261001150000_provision_demo_operational_roles.sql',
      '20261001170000_bootstrap_admin_account.sql',
    ];

    for (const file of migrationFiles) {
      const content = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
      expect(content).not.toContain('singhbhoomika29@gmail.com');
      expect(content).not.toMatch(/UPDATE auth\.users[\s\S]*?singhbhoomika29/i);
    }
  });
});

describe('15. bootstrap admin account provisioning (admin123@gmail.com)', () => {
  it('provisions admin123@gmail.com idempotently with role=admin and crypt password', () => {
    expect(bootstrapSql).toContain("SELECT id INTO v_user_id FROM auth.users WHERE LOWER(email) = 'admin123@gmail.com'");
    expect(bootstrapSql).toContain("jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', 'admin')");
    expect(bootstrapSql).toContain("INSERT INTO public.profiles (id, email, name, role, updated_at)");
    expect(bootstrapSql).toContain("VALUES (v_user_id, 'admin123@gmail.com', 'Operational Administrator', 'admin', now())");
  });

  it('resolves bootstrap admin user to admin role, isOperational=true, isAdmin=true', () => {
    const bootstrapUser = makeUser(
      { provider: 'email', providers: ['email'], role: 'admin' },
      { name: 'Operational Administrator' }
    );
    bootstrapUser.email = 'admin123@gmail.com';

    const { result } = renderHook(() => useAppRole(bootstrapUser));
    expect(result.current.role).toBe('admin');
    expect(result.current.isOperational).toBe(true);
    expect(result.current.isAdmin).toBe(true);
  });
});

describe('16. authoritative admin user management procedures', () => {
  it('enforces admin-only access on admin_list_operational_users', () => {
    expect(bootstrapSql).toContain('CREATE OR REPLACE FUNCTION public.admin_list_operational_users()');
    expect(bootstrapSql).toContain("IF public.current_app_role() <> 'admin' THEN");
    expect(bootstrapSql).toContain("REVOKE ALL ON FUNCTION public.admin_list_operational_users() FROM anon");
    expect(bootstrapSql).toContain("GRANT EXECUTE ON FUNCTION public.admin_list_operational_users() TO authenticated");
  });

  it('enforces admin-only and valid operational roles on admin_create_operational_user', () => {
    expect(bootstrapSql).toContain('CREATE OR REPLACE FUNCTION public.admin_create_operational_user');
    expect(bootstrapSql).toContain("IF public.current_app_role() <> 'admin' THEN");
    expect(bootstrapSql).toContain("IF user_role NOT IN ('responder', 'admin') THEN");
    expect(bootstrapSql).toContain("REVOKE ALL ON FUNCTION public.admin_create_operational_user(TEXT, TEXT, TEXT, TEXT) FROM anon");
  });

  it('enforces admin-only check and guards against sole admin demotion on admin_update_user_role', () => {
    expect(bootstrapSql).toContain('CREATE OR REPLACE FUNCTION public.admin_update_user_role');
    expect(bootstrapSql).toContain("IF public.current_app_role() <> 'admin' THEN");
    expect(bootstrapSql).toContain("IF new_role NOT IN ('citizen', 'responder', 'admin') THEN");
    expect(bootstrapSql).toContain('cannot demote the sole administrator');
  });

  it('provides admin_revoke_operational_access to demote accounts to citizen', () => {
    expect(bootstrapSql).toContain('CREATE OR REPLACE FUNCTION public.admin_revoke_operational_access');
    expect(bootstrapSql).toContain("RETURN public.admin_update_user_role(target_user_id, 'citizen')");
  });
});
