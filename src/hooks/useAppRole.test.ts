import { describe, it, expect } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { isAppRole, readAppRole, useAppRole } from './useAppRole';

/**
 * The client-side role is a DISPLAY concern only — Postgres decides access via
 * `public.current_app_role()`, which reads the same `app_metadata` claim. These
 * tests pin that agreement: if the client ever read a different claim, the UI
 * would promise access the database would refuse.
 */

function userWith(appMetadata: Record<string, unknown>, userMetadata: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    app_metadata: appMetadata,
    user_metadata: userMetadata,
  } as unknown as User;
}

describe('readAppRole', () => {
  it('reads responder and admin from app_metadata', () => {
    expect(readAppRole(userWith({ role: 'responder' }))).toBe('responder');
    expect(readAppRole(userWith({ role: 'admin' }))).toBe('admin');
  });

  it('ignores a role claimed in user_metadata, which the user can edit', () => {
    // signUp({ options: { data } }) writes user_metadata and updateUser()
    // can change it freely, so this must never grant anything.
    const forged = userWith({}, { role: 'admin' });
    expect(readAppRole(forged)).toBe('citizen');
  });

  it('prefers app_metadata over a conflicting user_metadata claim', () => {
    const conflicting = userWith({ role: 'citizen' }, { role: 'admin' });
    expect(readAppRole(conflicting)).toBe('citizen');
  });

  it('defaults to citizen when no claim is present', () => {
    expect(readAppRole(userWith({}))).toBe('citizen');
    expect(readAppRole(null)).toBe('citizen');
    expect(readAppRole(undefined)).toBe('citizen');
  });

  it('refuses to default upward for an unrecognized claim', () => {
    // Never treat an unknown or misspelled role as elevated.
    expect(readAppRole(userWith({ role: 'superadmin' }))).toBe('citizen');
    expect(readAppRole(userWith({ role: 'Admin' }))).toBe('citizen');
    expect(readAppRole(userWith({ role: '' }))).toBe('citizen');
    expect(readAppRole(userWith({ role: 42 }))).toBe('citizen');
    expect(readAppRole(userWith({ role: null }))).toBe('citizen');
  });

  it('never returns a role outside the database CHECK constraint', () => {
    const claims = ['admin', 'responder', 'citizen', 'root', 'superuser', '', null, undefined, 7, {}];
    for (const claim of claims) {
      expect(isAppRole(readAppRole(userWith({ role: claim })))).toBe(true);
    }
  });
});

describe('isAppRole', () => {
  it('accepts exactly the three roles in the CHECK constraint', () => {
    expect(isAppRole('citizen')).toBe(true);
    expect(isAppRole('responder')).toBe(true);
    expect(isAppRole('admin')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isAppRole('ADMIN')).toBe(false);
    expect(isAppRole('moderator')).toBe(false);
    expect(isAppRole(null)).toBe(false);
  });
});

import { renderHook } from '@testing-library/react';

describe('useAppRole hook', () => {
  it('synchronously resolves admin role when present in app_metadata claim', () => {
    const adminUser = userWith({ role: 'admin' });
    const { result } = renderHook(() => useAppRole(adminUser));

    expect(result.current.role).toBe('admin');
    expect(result.current.isOperational).toBe(true);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isSignedIn).toBe(true);
    expect(result.current.isResolving).toBe(false);
  });

  it('synchronously resolves responder role when present in app_metadata claim', () => {
    const responderUser = userWith({ role: 'responder' });
    const { result } = renderHook(() => useAppRole(responderUser));

    expect(result.current.role).toBe('responder');
    expect(result.current.isOperational).toBe(true);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isSignedIn).toBe(true);
    expect(result.current.isResolving).toBe(false);
  });

  it('defaults to citizen and not resolving when user is null', () => {
    const { result } = renderHook(() => useAppRole(null));

    expect(result.current.role).toBe('citizen');
    expect(result.current.isOperational).toBe(false);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isSignedIn).toBe(false);
    expect(result.current.isResolving).toBe(false);
  });

  it('user_metadata.role cannot elevate role', () => {
    const forged = userWith({}, { role: 'admin' });
    const { result } = renderHook(() => useAppRole(forged));

    expect(result.current.role).toBe('citizen');
    expect(result.current.isOperational).toBe(false);
    expect(result.current.isAdmin).toBe(false);
  });
});
