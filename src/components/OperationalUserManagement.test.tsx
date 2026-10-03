import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OperationalUserManagement } from './OperationalUserManagement';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

function makeUser(role: string = 'admin', email: string = 'admin123@gmail.com'): User {
  return {
    id: 'admin-user-id',
    email,
    app_metadata: { role },
    user_metadata: { name: 'Operational Administrator' },
  } as unknown as User;
}

const mockOperationalUsers = [
  {
    id: 'user-admin-1',
    email: 'admin123@gmail.com',
    name: 'Operational Administrator',
    role: 'admin',
    created_at: '2026-03-01T10:00:00Z',
    last_sign_in_at: '2026-03-30T12:00:00Z',
    status: 'active',
  },
  {
    id: 'user-resp-1',
    email: 'responder1@aapda.gov.in',
    name: 'Field Commander Sharma',
    role: 'responder',
    created_at: '2026-03-05T11:00:00Z',
    last_sign_in_at: '2026-03-29T08:00:00Z',
    status: 'active',
  },
  {
    id: 'user-cit-1',
    email: 'citizen@example.com',
    name: 'Public Citizen',
    role: 'citizen',
    created_at: '2026-03-10T14:00:00Z',
    last_sign_in_at: null,
    status: 'pending',
  },
];

describe('OperationalUserManagement Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementation of RPC calls
    vi.spyOn(supabase, 'rpc').mockImplementation(((fn: string) => {
      if (fn === 'admin_list_operational_users') {
        return Promise.resolve({ data: mockOperationalUsers, error: null });
      }
      if (fn === 'admin_create_operational_user') {
        return Promise.resolve({
          data: { success: true, user_id: 'new-user-id', role: 'responder' },
          error: null,
        });
      }
      if (fn === 'admin_update_user_role') {
        return Promise.resolve({
          data: { success: true, role: 'admin' },
          error: null,
        });
      }
      if (fn === 'admin_revoke_operational_access') {
        return Promise.resolve({
          data: { success: true, role: 'citizen' },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }) as unknown as typeof supabase.rpc);
  });

  describe('Security Gating & Access Control', () => {
    it('strictly renders nothing if caller is a citizen', () => {
      const citizenUser = makeUser('citizen', 'citizen@example.com');
      const { container } = render(<OperationalUserManagement language="en" user={citizenUser} />);

      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId('operational-user-management')).toBeNull();
    });

    it('strictly renders nothing if caller is a responder', () => {
      const responderUser = makeUser('responder', 'responder@aapda.gov.in');
      const { container } = render(<OperationalUserManagement language="en" user={responderUser} />);

      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId('operational-user-management')).toBeNull();
    });

    it('renders the complete management interface if caller is an admin', async () => {
      const adminUser = makeUser('admin', 'admin123@gmail.com');
      render(<OperationalUserManagement language="en" user={adminUser} />);

      expect(screen.getByTestId('operational-user-management')).toBeDefined();
      expect(screen.getByText('Operational User & Role Management')).toBeDefined();

      await waitFor(() => {
        expect(screen.getByTestId('user-management-table')).toBeDefined();
        expect(screen.getByText('Field Commander Sharma')).toBeDefined();
      });
    });
  });

  describe('User Listing & Distinction', () => {
    it('displays operational users with Name, Email, Role, Status, and Registered date', async () => {
      const adminUser = makeUser('admin', 'admin123@gmail.com');
      render(<OperationalUserManagement language="en" user={adminUser} />);

      await waitFor(() => {
        expect(screen.getByText('Operational Administrator')).toBeDefined();
        expect(screen.getByText('admin123@gmail.com')).toBeDefined();
        expect(screen.getByText('Field Commander Sharma')).toBeDefined();
        expect(screen.getByText('responder1@aapda.gov.in')).toBeDefined();
      });

      // Role badges exist and distinguish roles
      expect(screen.getByTestId('role-badge-user-admin-1').textContent).toContain('admin');
      expect(screen.getByTestId('role-badge-user-resp-1').textContent).toContain('responder');
      expect(screen.getByTestId('role-badge-user-cit-1').textContent).toContain('citizen');
    });

    it('filters users by search query and role filter chips', async () => {
      const adminUser = makeUser('admin', 'admin123@gmail.com');
      render(<OperationalUserManagement language="en" user={adminUser} />);

      await waitFor(() => {
        expect(screen.getByText('Field Commander Sharma')).toBeDefined();
      });

      // Search by email
      const searchInput = screen.getByTestId('search-user-input');
      fireEvent.change(searchInput, { target: { value: 'responder1' } });

      expect(screen.getByText('responder1@aapda.gov.in')).toBeDefined();
      expect(screen.queryByText('admin123@gmail.com')).toBeNull();

      // Reset search
      fireEvent.change(searchInput, { target: { value: '' } });

      // Filter by role chip
      fireEvent.click(screen.getByTestId('filter-admin'));
      expect(screen.getByText('admin123@gmail.com')).toBeDefined();
      expect(screen.queryByText('responder1@aapda.gov.in')).toBeNull();
    });
  });

  describe('Provisioning Operational Users', () => {
    it('admin can provision a new Responder with email, name, password, and role=responder', async () => {
      const adminUser = makeUser('admin', 'admin123@gmail.com');
      render(<OperationalUserManagement language="en" user={adminUser} />);

      // Open provisioning form
      const openBtn = screen.getByTestId('provision-user-btn');
      fireEvent.click(openBtn);

      expect(screen.getByTestId('provision-user-form')).toBeDefined();

      // Fill form
      fireEvent.change(screen.getByTestId('input-user-name'), {
        target: { value: 'Officer Anita Desai' },
      });
      fireEvent.change(screen.getByTestId('input-user-email'), {
        target: { value: 'anita.desai@aapda.gov.in' },
      });
      fireEvent.change(screen.getByTestId('input-user-password'), {
        target: { value: 'SecureResp#2026' },
      });
      fireEvent.click(screen.getByTestId('radio-role-responder'));

      // Submit
      fireEvent.click(screen.getByTestId('submit-provision-user'));

      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalledWith('admin_create_operational_user', {
          user_email: 'anita.desai@aapda.gov.in',
          user_password: 'SecureResp#2026',
          user_name: 'Officer Anita Desai',
          user_role: 'responder',
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('action-success-banner')).toBeDefined();
        expect(screen.getByTestId('action-success-banner').textContent).toContain('Successfully provisioned');
      });
    });

    it('admin can provision another Admin with email, name, password, and role=admin', async () => {
      const adminUser = makeUser('admin', 'admin123@gmail.com');
      render(<OperationalUserManagement language="en" user={adminUser} />);

      // Open provisioning form
      fireEvent.click(screen.getByTestId('provision-user-btn'));

      // Fill form for another admin
      fireEvent.change(screen.getByTestId('input-user-name'), {
        target: { value: 'Deputy Operations Director' },
      });
      fireEvent.change(screen.getByTestId('input-user-email'), {
        target: { value: 'director@baywatch.org' },
      });
      fireEvent.change(screen.getByTestId('input-user-password'), {
        target: { value: 'AdminPass#2026' },
      });
      fireEvent.click(screen.getByTestId('radio-role-admin'));

      // Submit
      fireEvent.click(screen.getByTestId('submit-provision-user'));

      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalledWith('admin_create_operational_user', {
          user_email: 'director@baywatch.org',
          user_password: 'AdminPass#2026',
          user_name: 'Deputy Operations Director',
          user_role: 'admin',
        });
      });
    });
  });

  describe('Role Modification & Revocation', () => {
    it('admin can promote a responder to admin', async () => {
      const adminUser = makeUser('admin', 'admin123@gmail.com');
      render(<OperationalUserManagement language="en" user={adminUser} />);

      await waitFor(() => {
        expect(screen.getByTestId('promote-admin-btn-user-resp-1')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('promote-admin-btn-user-resp-1'));

      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalledWith('admin_update_user_role', {
          target_user_id: 'user-resp-1',
          new_role: 'admin',
        });
      });
    });

    it('admin can demote an admin to responder', async () => {
      // Mock confirm
      window.confirm = vi.fn().mockReturnValue(true);

      const adminUser = makeUser('admin', 'admin123@gmail.com');
      render(<OperationalUserManagement language="en" user={adminUser} />);

      await waitFor(() => {
        expect(screen.getByTestId('demote-responder-btn-user-admin-1')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('demote-responder-btn-user-admin-1'));

      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalledWith('admin_update_user_role', {
          target_user_id: 'user-admin-1',
          new_role: 'responder',
        });
      });
    });

    it('admin can revoke operational access and demote user to citizen', async () => {
      window.confirm = vi.fn().mockReturnValue(true);

      const adminUser = makeUser('admin', 'admin123@gmail.com');
      render(<OperationalUserManagement language="en" user={adminUser} />);

      await waitFor(() => {
        expect(screen.getByTestId('revoke-access-btn-user-resp-1')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('revoke-access-btn-user-resp-1'));

      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalledWith('admin_revoke_operational_access', {
          target_user_id: 'user-resp-1',
        });
      });
    });
  });
});
