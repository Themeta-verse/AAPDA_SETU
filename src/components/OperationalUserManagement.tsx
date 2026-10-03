import { useState, useEffect, useCallback, useId } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { readAppRole, type AppRole } from '@/hooks/useAppRole';
import type { Language } from '@/lib/translations';
import {
  ShieldAlert,
  UserPlus,
  ShieldCheck,
  Radio,
  UserX,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Eye,
  EyeOff,
  UserCheck
} from 'lucide-react';

export interface OperationalUserItem {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  created_at: string;
  last_sign_in_at?: string | null;
  status: 'active' | 'pending' | 'suspended';
}

interface OperationalUserManagementProps {
  language: Language;
  user: User | null;
}

export function OperationalUserManagement({ language: _language, user }: OperationalUserManagementProps) {
  const currentRole = readAppRole(user);
  const isAdmin = currentRole === 'admin';

  const [users, setUsers] = useState<OperationalUserItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'responder' | 'citizen'>('all');

  // Provisioning Form State
  const [isProvisioningOpen, setIsProvisioningOpen] = useState<boolean>(false);
  const [formName, setFormName] = useState<string>('');
  const [formEmail, setFormEmail] = useState<string>('');
  const [formPassword, setFormPassword] = useState<string>('');
  const [formRole, setFormRole] = useState<'responder' | 'admin'>('responder');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Status feedback
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);

  const filterId = useId();

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    setActionError(null);

    try {
      // 1. Primary: Call authoritative admin_list_operational_users RPC
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rpcData, error: rpcError } = await (supabase.rpc as any)('admin_list_operational_users');

      if (!rpcError && Array.isArray(rpcData)) {
        setUsers(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rpcData.map((u: any) => ({
            id: u.id,
            email: u.email || '—',
            name: u.name || 'Unnamed Personnel',
            role: (u.role === 'admin' || u.role === 'responder' ? u.role : 'citizen') as AppRole,
            created_at: u.created_at || new Date().toISOString(),
            last_sign_in_at: u.last_sign_in_at,
            status: u.status === 'suspended' ? 'suspended' : u.status === 'pending' ? 'pending' : 'active',
          }))
        );
        setIsLoading(false);
        return;
      }

      // 2. Fallback: Query profiles table if RPC is not yet deployed to remote instance
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .order('role', { ascending: true });

      if (profileError) {
        throw new Error(profileError.message);
      }

      if (profileData) {
        setUsers(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          profileData.map((p: any) => ({
            id: p.id,
            email: p.email || (p.id === user?.id ? user.email || '—' : 'operational@aapda.gov.in'),
            name: p.name || 'Operational Personnel',
            role: (p.role === 'admin' || p.role === 'responder' ? p.role : 'citizen') as AppRole,
            created_at: p.created_at || new Date().toISOString(),
            status: 'active',
          }))
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch operational users';
      setActionError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, user]);

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
    }
  }, [isAdmin, loadUsers]);

  // Provision New Operational User (Responder or Admin)
  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    const email = formEmail.trim().toLowerCase();
    const name = formName.trim();
    const password = formPassword.trim();

    if (!email || !email.includes('@')) {
      setActionError('Please provide a valid official email address.');
      return;
    }
    if (!password || password.length < 6) {
      setActionError('Password must be at least 6 characters long.');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      // Authoritatively call admin_create_operational_user RPC
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('admin_create_operational_user', {
        user_email: email,
        user_password: password,
        user_name: name || undefined,
        user_role: formRole,
      });

      if (error) {
        // Fallback: If RPC not present on live remote DB, attempt provision_operational_account
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: fallbackErr } = await (supabase.rpc as any)('provision_operational_account', {
          target_email: email,
          target_role: formRole,
        });

        if (fallbackErr) {
          throw new Error(error.message || fallbackErr.message);
        }
      }

      setActionSuccess(
        `Successfully provisioned operational account for ${email} with role "${formRole}".`
      );
      setFormName('');
      setFormEmail('');
      setFormPassword('');
      setIsProvisioningOpen(false);
      await loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to provision operational user';
      setActionError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Change Operational Role (responder <-> admin)
  const handleRoleChange = async (targetUser: OperationalUserItem, newRole: AppRole) => {
    if (!isAdmin) return;
    if (targetUser.role === newRole) return;

    if (targetUser.id === user?.id && newRole !== 'admin') {
      const confirmSelf = window.confirm(
        'Warning: You are demoting your own administrator account. You will lose access to administrative controls. Proceed?'
      );
      if (!confirmSelf) return;
    }

    setActionInProgressId(targetUser.id);
    setActionError(null);
    setActionSuccess(null);

    try {
      // Call admin_update_user_role RPC
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)('admin_update_user_role', {
        target_user_id: targetUser.id,
        new_role: newRole,
      });

      if (error) {
        // Fallback to legacy set_user_role
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: fallbackErr } = await (supabase.rpc as any)('set_user_role', {
          target_user_id: targetUser.id,
          new_role: newRole,
        });

        if (fallbackErr) throw new Error(error.message || fallbackErr.message);
      }

      setActionSuccess(`Updated ${targetUser.email} role to "${newRole}".`);
      await loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to change role';
      setActionError(msg);
    } finally {
      setActionInProgressId(null);
    }
  };

  // Revoke Operational Access (demote to citizen)
  const handleRevokeAccess = async (targetUser: OperationalUserItem) => {
    if (!isAdmin) return;
    const confirmRevoke = window.confirm(
      `Revoke operational privileges for ${targetUser.email}? Their role will be reset to citizen.`
    );
    if (!confirmRevoke) return;

    setActionInProgressId(targetUser.id);
    setActionError(null);
    setActionSuccess(null);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)('admin_revoke_operational_access', {
        target_user_id: targetUser.id,
      });

      if (error) {
        // Fallback
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: fallbackErr } = await (supabase.rpc as any)('admin_update_user_role', {
          target_user_id: targetUser.id,
          new_role: 'citizen',
        });
        if (fallbackErr) throw new Error(error.message || fallbackErr.message);
      }

      setActionSuccess(`Revoked operational access for ${targetUser.email}. User is now citizen.`);
      await loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to revoke access';
      setActionError(msg);
    } finally {
      setActionInProgressId(null);
    }
  };

  // Security layer check: strictly non-admins render nothing
  if (!isAdmin) {
    return null;
  }

  // Filtered users
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      (u.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.name || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const adminCount = users.filter((u) => u.role === 'admin').length;
  const responderCount = users.filter((u) => u.role === 'responder').length;
  const citizenCount = users.filter((u) => u.role === 'citizen').length;

  return (
    <section
      className="p-6 rounded-2xl bg-card border border-primary/25 shadow-lg space-y-6"
      data-testid="operational-user-management"
      aria-labelledby="user-mgmt-heading"
    >
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span>AUTHORITATIVE ACCESS CONTROL</span>
          </div>
          <h2 id="user-mgmt-heading" className="text-xl font-black text-foreground mt-1 flex items-center gap-2">
            Operational User & Role Management
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Authoritative administration of municipal disaster personnel. Manage operational responders,
            elevate administrators, and enforce strict PostgreSQL RLS and Auth metadata authorization.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadUsers}
            disabled={isLoading}
            className="p-2.5 rounded-xl border border-border bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium transition-colors flex items-center gap-1.5"
            title="Refresh user registry"
            aria-label="Refresh user registry"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-primary' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setIsProvisioningOpen(!isProvisioningOpen)}
            className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors shadow-sm flex items-center gap-2"
            data-testid="provision-user-btn"
          >
            <UserPlus className="w-4 h-4" />
            <span>{isProvisioningOpen ? 'Close Form' : 'Provision Personnel'}</span>
          </button>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-purple-500/20 bg-purple-500/5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-purple-400 uppercase">Administrators</span>
            <ShieldAlert className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-lg font-bold text-foreground mt-1" data-testid="count-admin">
            {adminCount}
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-cyan-400 uppercase">Responders</span>
            <Radio className="w-4 h-4 text-cyan-400" />
          </div>
          <p className="text-lg font-bold text-foreground mt-1" data-testid="count-responder">
            {responderCount}
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-border bg-card/60">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground uppercase">Citizens</span>
            <UserCheck className="w-4 h-4 text-muted-foreground" />
          </div>
          <p className="text-lg font-bold text-foreground mt-1" data-testid="count-citizen">
            {citizenCount}
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-emerald-400 uppercase">Total Accounts</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-lg font-bold text-foreground mt-1" data-testid="count-total">
            {users.length}
          </p>
        </div>
      </div>

      {/* Action Messages */}
      {actionSuccess && (
        <div
          className="p-3.5 rounded-xl border border-safe/30 bg-safe/10 text-safe text-xs flex items-center gap-2 animate-fade-in"
          role="status"
          data-testid="action-success-banner"
        >
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span className="font-medium">{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div
          className="p-3.5 rounded-xl border border-danger/30 bg-danger/10 text-danger text-xs flex items-center gap-2 animate-fade-in"
          role="alert"
          data-testid="action-error-banner"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="font-medium">{actionError}</span>
        </div>
      )}

      {/* Provisioning Drawer / Modal Form */}
      {isProvisioningOpen && (
        <div
          className="p-5 rounded-2xl bg-secondary/50 border border-primary/30 space-y-4 animate-slide-in"
          data-testid="provision-user-form"
        >
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                <UserPlus className="w-4 h-4 text-primary" />
                Provision Operational Account
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Creates or promotes an account with authoritative Supabase Auth credentials.
              </p>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">
              Admin Privilege
            </span>
          </div>

          <form onSubmit={handleProvisionSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {/* Name */}
              <div className="space-y-1.5">
                <label htmlFor="user-name-input" className="text-xs font-semibold text-foreground">
                  Full Name / Call Sign
                </label>
                <input
                  id="user-name-input"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Commander Rajesh Varma"
                  className="w-full px-3 py-2 rounded-xl bg-background border border-border text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  data-testid="input-user-name"
                />
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label htmlFor="user-email-input" className="text-xs font-semibold text-foreground">
                  Official Email Address <span className="text-danger">*</span>
                </label>
                <input
                  id="user-email-input"
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="officer@aapda.gov.in"
                  className="w-full px-3 py-2 rounded-xl bg-background border border-border text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  data-testid="input-user-email"
                />
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label htmlFor="user-password-input" className="text-xs font-semibold text-foreground">
                  Initial Password <span className="text-danger">*</span>
                </label>
                <div className="relative">
                  <input
                    id="user-password-input"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full pl-3 pr-10 py-2 rounded-xl bg-background border border-border text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                    data-testid="input-user-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Role Selection */}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-foreground">Operational Role Designation</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <label
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    formRole === 'responder'
                      ? 'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500'
                      : 'border-border bg-background hover:bg-secondary/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="role-select"
                    value="responder"
                    checked={formRole === 'responder'}
                    onChange={() => setFormRole('responder')}
                    className="mt-0.5 text-cyan-500 focus:ring-cyan-500"
                    data-testid="radio-role-responder"
                  />
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                      <Radio className="w-3.5 h-3.5 text-cyan-400" />
                      Responder (Field Officer)
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Grants tactical field response access, resource deployments, and operational command views.
                    </p>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    formRole === 'admin'
                      ? 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500'
                      : 'border-border bg-background hover:bg-secondary/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="role-select"
                    value="admin"
                    checked={formRole === 'admin'}
                    onChange={() => setFormRole('admin')}
                    className="mt-0.5 text-purple-500 focus:ring-purple-500"
                    data-testid="radio-role-admin"
                  />
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                      <ShieldAlert className="w-3.5 h-3.5 text-purple-400" />
                      Administrator (Operations Lead)
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Full administrative authority, resource provisioning, personnel role management, and audit logs.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsProvisioningOpen(false)}
                className="px-4 py-2 rounded-xl border border-border bg-secondary hover:bg-secondary/80 text-foreground text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                data-testid="submit-provision-user"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Provisioning...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Provision Account</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search personnel by name or email..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-secondary/60 border border-border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid="search-user-input"
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-xl border border-border self-start sm:self-auto">
          {(['all', 'admin', 'responder', 'citizen'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(r)}
              className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                roleFilter === r
                  ? 'bg-card text-foreground shadow-sm font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              data-testid={`filter-${r}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Users Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card/40">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="user-management-table">
            <thead className="bg-secondary/40 text-muted-foreground uppercase text-[10px] tracking-wider border-b border-border">
              <tr>
                <th className="py-3 px-4 font-semibold">Personnel</th>
                <th className="py-3 px-4 font-semibold">Authoritative Role</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold">Registered</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {isLoading && users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                      <span>Loading operational personnel...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground" data-testid="no-users-msg">
                    No personnel found matching current filters.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isCurrent = u.id === user?.id;
                  const isWorking = actionInProgressId === u.id;

                  return (
                    <tr
                      key={u.id}
                      className="hover:bg-secondary/20 transition-colors"
                      data-testid={`user-row-${u.id}`}
                    >
                      {/* Name & Email */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                              u.role === 'admin'
                                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                : u.role === 'responder'
                                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {((u.name || u.email || '?').charAt(0)).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-foreground flex items-center gap-1.5">
                              <span>{u.name}</span>
                              {isCurrent && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] bg-primary/20 text-primary border border-primary/30">
                                  You
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono">{u.email}</div>
                          </div>
                        </div>
                      </td>

                      {/* Authoritative Role */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                            u.role === 'admin'
                              ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                              : u.role === 'responder'
                              ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                              : 'bg-muted/80 text-muted-foreground border-border'
                          }`}
                          data-testid={`role-badge-${u.id}`}
                        >
                          {u.role === 'admin' && <ShieldAlert className="w-3 h-3" />}
                          {u.role === 'responder' && <Radio className="w-3 h-3" />}
                          {u.role === 'citizen' && <UserCheck className="w-3 h-3" />}
                          {u.role}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-medium capitalize ${
                            u.status === 'active'
                              ? 'text-emerald-400'
                              : u.status === 'pending'
                              ? 'text-amber-400'
                              : 'text-rose-400'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              u.status === 'active'
                                ? 'bg-emerald-400'
                                : u.status === 'pending'
                                ? 'bg-amber-400'
                                : 'bg-rose-400'
                            }`}
                          />
                          {u.status}
                        </span>
                      </td>

                      {/* Created Date */}
                      <td className="py-3 px-4 text-[11px] text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Role Toggle: responder <-> admin */}
                          {u.role === 'responder' && (
                            <button
                              type="button"
                              onClick={() => handleRoleChange(u, 'admin')}
                              disabled={isWorking}
                              className="px-2.5 py-1 rounded-lg border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 text-[11px] font-medium transition-colors"
                              data-testid={`promote-admin-btn-${u.id}`}
                              title="Promote responder to administrator"
                            >
                              Promote to Admin
                            </button>
                          )}

                          {u.role === 'admin' && (
                            <button
                              type="button"
                              onClick={() => handleRoleChange(u, 'responder')}
                              disabled={isWorking}
                              className="px-2.5 py-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-[11px] font-medium transition-colors"
                              data-testid={`demote-responder-btn-${u.id}`}
                              title="Change role to responder"
                            >
                              Demote to Responder
                            </button>
                          )}

                          {u.role === 'citizen' && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleRoleChange(u, 'responder')}
                                disabled={isWorking}
                                className="px-2 py-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-[11px] font-medium"
                                data-testid={`grant-responder-btn-${u.id}`}
                              >
                                Make Responder
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRoleChange(u, 'admin')}
                                disabled={isWorking}
                                className="px-2 py-1 rounded-lg border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 text-[11px] font-medium"
                                data-testid={`grant-admin-btn-${u.id}`}
                              >
                                Make Admin
                              </button>
                            </div>
                          )}

                          {/* Revoke Operational Access */}
                          {(u.role === 'admin' || u.role === 'responder') && (
                            <button
                              type="button"
                              onClick={() => handleRevokeAccess(u)}
                              disabled={isWorking}
                              className="p-1 rounded-lg text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors"
                              data-testid={`revoke-access-btn-${u.id}`}
                              title="Revoke operational access (demote to citizen)"
                              aria-label={`Revoke access for ${u.email}`}
                            >
                              <UserX className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
export default OperationalUserManagement;
