import { useMemo } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AppRole } from '@/integrations/supabase/types';

export type { AppRole };

/**
 * Roles the application recognises, mirroring the `profiles.role` CHECK
 * constraint. A value outside this set is not coerced into a real role: it
 * falls back to the least-privileged one.
 */
const APP_ROLES: readonly AppRole[] = ['citizen', 'responder', 'admin'] as const;

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value);
}

/**
 * Read the operational role from the AUTH CLAIM, not the profiles table.
 *
 * This matters. `supabase.auth.signUp({ options: { data } })` in
 * src/hooks/useAuth.ts writes to `user_metadata`, which the user can freely
 * edit via `updateUser()`. `app_metadata` can only be written with the
 * service-role key, and it is the exact claim
 * `public.current_app_role()` authorizes against in Postgres. Reading the
 * same claim here keeps the UI's idea of the role aligned with the database's
 * instead of letting the client disagree with its own RLS.
 *
 * A missing or unrecognised claim resolves to 'citizen'. We never default
 * upward, and we never treat 'admin' as a fallback.
 */
export function readAppRole(user: User | null | undefined): AppRole {
  const claim = user?.app_metadata?.role;
  return isAppRole(claim) ? claim : 'citizen';
}

export interface AppRoleState {
  role: AppRole;
  /** True only for responder and admin, matching `public.is_responder()`. */
  isOperational: boolean;
  isAdmin: boolean;
  isSignedIn: boolean;
}

export function useAppRole(user: User | null | undefined): AppRoleState {
  return useMemo(() => {
    const isSignedIn = !!user;
    const role = readAppRole(user);
    return {
      role,
      isOperational: role === 'responder' || role === 'admin',
      isAdmin: role === 'admin',
      isSignedIn,
    };
  }, [user]);
}