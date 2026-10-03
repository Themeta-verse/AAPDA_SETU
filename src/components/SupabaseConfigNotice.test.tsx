import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SupabaseConfigNotice } from './SupabaseConfigNotice';

describe('SupabaseConfigNotice', () => {
  it('renders helpful configuration instructions when Supabase credentials are missing', () => {
    render(<SupabaseConfigNotice />);
    expect(screen.getByText('Supabase Configuration Required')).toBeDefined();
    expect(screen.getAllByText('VITE_SUPABASE_URL').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('VITE_SUPABASE_PUBLISHABLE_KEY').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Open Vercel Dashboard')).toBeDefined();
  });
});
