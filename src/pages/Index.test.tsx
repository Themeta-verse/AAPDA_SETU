import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * REGRESSION: Index must not crash for a signed-in user.
 *
 * `useMonitoring` reads the single shared pipeline via
 * `useSharedCoastalIntelligence`, which throws outside a
 * `CoastalIntelligenceProvider`. Index previously called the hook in its own
 * body while rendering the provider *below* that call, so every signed-in
 * load threw "must be used inside a <CoastalIntelligenceProvider>" instead of
 * rendering the dashboard. The provider must wrap the content.
 */

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'op@test.in', user_metadata: { name: 'Op' } },
    loading: false,
    signOut: vi.fn(),
  }),
}));

import Index from './Index';

describe('Index provider ordering', () => {
  beforeEach(() => {
    // Every source unreachable: the page must render honest unknown states,
    // not throw and not attempt real network.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline in test')));
  });

  it('renders the dashboard shell for a signed-in user without throwing', async () => {
    const { container } = render(<Index />);
    // Header brand renders: we got past the hook calls without a throw.
    expect(screen.getByText(/BAYWATCH/)).toBeInTheDocument();
    // The command center (inside the provider) mounted.
    expect(
      container.querySelector('[data-testid="coastal-command-center"]')
    ).toBeInTheDocument();
  });
});
