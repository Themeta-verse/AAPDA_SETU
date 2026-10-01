import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AppRole } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';

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
  isResolving: boolean;
}

export function useAppRole(user: User | null | undefined): AppRoleState {
  const initialRole = readAppRole(user);
  const [resolvedRole, setResolvedRole] = useState<AppRole>(initialRole);
  const [isResolving, setIsResolving] = useState<boolean>(() => {
    if (!user) return false;
    const claim = user.app_metadata?.role;
    // If claim is already an elevated operational role, no async verification required
    return !(claim === 'admin' || claim === 'responder');
  });

  const userId = user?.id;
  const userClaim = user?.app_metadata?.role;

  useEffect(() => {
    if (!user) {
      setResolvedRole('citizen');
      setIsResolving(false);
      return;
    }

    const claim = user.app_metadata?.role;
    if (claim === 'admin' || claim === 'responder') {
      setResolvedRole(claim);
      setIsResolving(false);
      return;
    }

    // Once an operational role is already confirmed for this user, do not re-trigger async resolution
    if (resolvedRole === 'admin' || resolvedRole === 'responder') {
      setIsResolving(false);
      return;
    }

    // When app_metadata role is not yet elevated in the current token,
    // verify against the authoritative profiles table row for this user.
    // `Promise.resolve` lifts the supabase thenable (which has no `.catch`)
    // into a real promise so network failures still reach the fallback.
    let cancelled = false;
    setIsResolving(true);

    Promise.resolve(
      supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
    )
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data?.role && isAppRole(data.role) && data.role !== 'citizen') {
          setResolvedRole(data.role);
        } else {
          setResolvedRole(readAppRole(user));
        }
        setIsResolving(false);
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedRole(readAppRole(user));
          setIsResolving(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userId, userClaim, resolvedRole]);

  const role = (userClaim === 'admin' || userClaim === 'responder') ? userClaim : resolvedRole;
  const isOperational = role === 'responder' || role === 'admin';

  return {
    role,
    isOperational,
    isAdmin: role === 'admin',
    isSignedIn: !!user,
    // When role is confirmed operational (admin or responder), authorization resolution is complete
    isResolving: isOperational ? false : isResolving,
  };
}