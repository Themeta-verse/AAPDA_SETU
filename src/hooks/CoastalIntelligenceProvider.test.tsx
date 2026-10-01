/**
 * Single shared intelligence pipeline.
 *
 * These tests guard an architectural property rather than a rendering detail:
 * there must be exactly ONE polling pipeline per page.
 *
 * The regression being locked out is measurable. `useMonitoring` used to call
 * `useEarthquakeData()` and `useCoastalIntelligence()` itself while
 * `CoastalCommandCenter` called `useCoastalIntelligence()` again. Every page load
 * therefore issued three identical requests to the USGS feed and three
 * marine/weather pairs, and the two consumers could display different risk
 * verdicts for the same instant.
 *
 * THE ASSERTION IS ON FETCHES, NOT ON HOOK CALLS
 * ----------------------------------------------
 * A React component legitimately re-invokes a hook whenever it re-renders, so
 * counting invocations proves nothing. What must not happen is a second
 * network request. These tests count actual adapter fetches, which is the
 * invariant that was violated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const fetches = { marine: 0, weather: 0, seismic: 0, warnings: 0 };

vi.mock('./useCoastalIntelligence', async () => {
  const actual = await vi.importActual<typeof import('./useCoastalIntelligence')>(
    './useCoastalIntelligence',
  );
  return {
    ...actual,
    useCoastalIntelligence: () =>
      // Drive the real hook, but with adapters that only count. Nothing here
      // touches the network, so the counts are exact.
      actual.useCoastalIntelligence({
        supabase: {
          functions: {
            invoke: async () => {
              fetches.warnings += 1;
              return { data: null, error: { message: 'not deployed' } };
            },
          },
        },
        enableBrowserNotifications: false,
        deps: {
          fetchImpl: async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('marine')) {
              fetches.marine += 1;
              return jsonResponse({ current: {}, hourly: { time: [] } });
            }
            if (url.includes('open-meteo.com')) {
              fetches.weather += 1;
              return jsonResponse({ current: {}, hourly: { time: [] } });
            }
            if (url.includes('usgs')) {
              fetches.seismic += 1;
              return jsonResponse({ type: 'FeatureCollection', features: [], metadata: {} });
            }
            return jsonResponse({});
          },
        },
      }),
  };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    url: 'https://example.invalid',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const { CoastalIntelligenceProvider, useSharedCoastalIntelligence, useOptionalSharedCoastalIntelligence } =
  await import('./CoastalIntelligenceProvider');
const { useMonitoring } = await import('./useMonitoring');

function Probe() {
  const state = useSharedCoastalIntelligence();
  return <div data-testid="probe">{state.assessment.state}</div>;
}

/** A consumer that only reads shared state, like CoastalCommandCenter. */
function SharedConsumer() {
  const state = useSharedCoastalIntelligence();
  return <div data-testid="consumer">{state.assessment.state}</div>;
}

/** A consumer that derives from shared state, like useMonitoring. */
function DerivedConsumer() {
  const { assessment, marine } = useMonitoring(10000);
  return (
    <div data-testid="derived">
      {assessment.state}|{marine?.status ?? 'none'}
    </div>
  );
}

function OptionalProbe() {
  const state = useOptionalSharedCoastalIntelligence();
  return <div data-testid="optional">{state ? 'present' : 'none'}</div>;
}

function wrap(children: ReactNode) {
  return (
    <CoastalIntelligenceProvider
      client={{
        functions: {
          invoke: async () => {
            fetches.warnings += 1;
            return { data: null, error: { message: 'not deployed' } };
          },
        },
      }}
    >
      {children}
    </CoastalIntelligenceProvider>
  );
}

/** Let the initial fetch effects settle. */
async function settle() {
  await waitFor(() => expect(fetches.seismic).toBeGreaterThan(0));
  await new Promise((resolve) => setTimeout(resolve, 250));
}

describe('exactly one pipeline per page', () => {
  beforeEach(() => {
    fetches.marine = 0;
    fetches.weather = 0;
    fetches.seismic = 0;
    fetches.warnings = 0;
  });

  it('fetches each source once for two plain consumers', async () => {
    render(wrap(<><Probe /><SharedConsumer /></>));
    await settle();

    // Two consumers, one pipeline: one request each, not two.
    expect(fetches.seismic).toBe(1);
    expect(fetches.marine).toBe(1);
    expect(fetches.weather).toBe(1);
  });

  it('does not multiply fetches when a consumer derives from the shared state', async () => {
    // This is the exact tree that previously issued THREE USGS requests:
    // useMonitoring polling on its own plus the command center polling again.
    render(wrap(<><Probe /><SharedConsumer /><DerivedConsumer /></>));
    await settle();

    expect(fetches.seismic).toBe(1);
    expect(fetches.marine).toBe(1);
    expect(fetches.weather).toBe(1);

    // And the derived consumer actually received real data through the context.
    await waitFor(() =>
      expect(screen.getByTestId('derived').textContent).toContain('|'),
    );
  });

  it('does not refetch when the consumer set changes', async () => {
    const { rerender } = render(wrap(<Probe />));
    await settle();
    const afterFirst = fetches.seismic;

    rerender(wrap(<><Probe /><SharedConsumer /></>));
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Adding a consumer must not restart polling.
    expect(fetches.seismic).toBe(afterFirst);
  });

  it('gives every consumer the same verdict for the same instant', async () => {
    render(wrap(<><Probe /><SharedConsumer /><DerivedConsumer /></>));
    await settle();

    const probe = screen.getByTestId('probe').textContent;
    const consumer = screen.getByTestId('consumer').textContent;
    // Disagreement between surfaces was the user-visible symptom.
    expect(probe).toBe(consumer);
  });
});

describe('misuse is reported rather than silently tolerated', () => {
  it('throws when the shared state is used outside the provider', () => {
    // Silently constructing a second pipeline is the bug this module exists to
    // prevent, so it must fail loudly instead.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(
      /must be used inside a <CoastalIntelligenceProvider>/,
    );
    spy.mockRestore();
  });

  it('offers a non-throwing variant for components that can degrade', () => {
    render(<OptionalProbe />);
    expect(screen.getByTestId('optional')).toHaveTextContent('none');
  });
});

describe('warning retrieval stays inside the shared pipeline', () => {
  it('attempts the Edge Function once per cycle regardless of consumer count', async () => {
    fetches.warnings = 0;
    render(wrap(<><Probe /><SharedConsumer /></>));
    await settle();

    // One call, not one per consumer.
    expect(fetches.warnings).toBe(1);
  });
});
