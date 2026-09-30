import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { IncidentIntelligence } from './IncidentIntelligence';
import type { IncidentClientLike } from '@/integrations/supabase/incidents';

/**
 * Component-level behavioral tests.
 *
 * Every assertion here is about what the operator is TOLD. The recurring
 * concern is honesty under failure: a denied read must not look like an empty
 * queue, a missing photo must not become a broken image, and a report with no
 * coordinates must not be pinned to a location the database never recorded.
 */

type Row = Record<string, unknown>;

function makeRow(overrides: Row = {}): Row {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'user-1',
    type: 'flooding',
    description: 'Water at ankle level.',
    photo_url: null,
    latitude: 19.0988,
    longitude: 72.8267,
    created_at: '2026-03-30T10:00:00.000Z',
    ...overrides,
  };
}

function fakeClient(options: {
  select?: { data: unknown; error: { message: string; code?: string } | null };
  signedUrl?: {
    data: { signedUrl: string | null } | null;
    error: { message: string; code?: string } | null;
  };
} = {}) {
  const client: IncidentClientLike = {
    from: () => ({
      select: () => ({
        order: () =>
          Promise.resolve(options.select ?? { data: [], error: null }),
      }),
      insert: () => Promise.resolve({ data: null, error: null }),
    }),
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ error: null }),
        createSignedUrl: () =>
          Promise.resolve(
            options.signedUrl ?? { data: { signedUrl: 'https://signed.example/o' }, error: null }
          ),
      }),
    },
  };
  return client;
}

function responder() {
  return {
    id: 'user-1',
    app_metadata: { role: 'responder' },
    user_metadata: {},
  } as unknown as User;
}

function citizen() {
  return { id: 'user-1', app_metadata: {}, user_metadata: {} } as unknown as User;
}

beforeEach(() => {
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
});

describe('role gating', () => {
  it('shows operational data to a responder', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({ select: { data: [makeRow()], error: null } })}
      />
    );

    expect(await screen.findByTestId('incident-card')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-role-notice')).not.toBeInTheDocument();
  });

  it('shows operational data to an admin', async () => {
    const admin = { id: 'u', app_metadata: { role: 'admin' }, user_metadata: {} } as unknown as User;
    render(
      <IncidentIntelligence
        language="en"
        user={admin}
        client={fakeClient({ select: { data: [makeRow()], error: null } })}
      />
    );

    expect(await screen.findByTestId('incident-card')).toBeInTheDocument();
  });

  it('tells a citizen they do not have operational access', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={citizen()}
        client={fakeClient({ select: { data: [makeRow()], error: null } })}
      />
    );

    expect(await screen.findByTestId('incident-role-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-card')).not.toBeInTheDocument();
  });

  it('does not trust a role claimed in user_metadata', async () => {
    const forged = {
      id: 'u',
      app_metadata: {},
      user_metadata: { role: 'admin' },
    } as unknown as User;

    render(
      <IncidentIntelligence
        language="en"
        user={forged}
        client={fakeClient({ select: { data: [makeRow()], error: null } })}
      />
    );

    expect(await screen.findByTestId('incident-role-notice')).toBeInTheDocument();
  });

  it('requires a signed-in user', async () => {
    render(<IncidentIntelligence language="en" user={null} client={fakeClient()} />);

    expect(await screen.findByTestId('incident-role-notice')).toBeInTheDocument();
  });
});

describe('view states', () => {
  it('shows an explicit empty state when there are no reports', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({ select: { data: [], error: null } })}
      />
    );

    expect(await screen.findByTestId('incident-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-list')).not.toBeInTheDocument();
  });

  it('shows a permission error distinctly from an empty list', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({
          select: {
            data: null,
            error: { message: 'new row violates row-level security policy', code: '42501' },
          },
        })}
      />
    );

    expect(await screen.findByTestId('incident-denied')).toBeInTheDocument();
    // Crucially NOT the empty state: "no reports" would be a false answer.
    expect(screen.queryByTestId('incident-empty')).not.toBeInTheDocument();
  });

  it('shows a database error with the real message', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({
          select: { data: null, error: { message: 'schema cache is stale', code: 'PGRST204' } },
        })}
      />
    );

    const error = await screen.findByTestId('incident-error');
    expect(error).toHaveTextContent('schema cache is stale');
  });

  it('shows an offline state', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });

    render(<IncidentIntelligence language="en" user={responder()} client={fakeClient()} />);

    expect(await screen.findByTestId('incident-offline')).toBeInTheDocument();
  });

  it('shows a loading state while the query is in flight', async () => {
    // A client that never resolves, so the loading state is observable.
    const pending: IncidentClientLike = {
      from: () => ({
        select: () => ({ order: () => new Promise(() => {}) }),
        insert: () => Promise.resolve({ data: null, error: null }),
      }),
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ error: null }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'x' }, error: null }),
        }),
      },
    };

    render(<IncidentIntelligence language="en" user={responder()} client={pending} />);

    expect(await screen.findByTestId('incident-loading')).toBeInTheDocument();
  });

  it('flags structurally incomplete rows rather than hiding them', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({
          select: { data: [makeRow({ longitude: null })], error: null },
        })}
      />
    );

    await screen.findByTestId('incident-card');
    expect(screen.getByTestId('incident-degraded')).toBeInTheDocument();
    expect(screen.getByTestId('incident-malformed')).toBeInTheDocument();
  });

  it('shows a malformed response as an error, not as zero incidents', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({ select: { data: { nope: true }, error: null } })}
      />
    );

    expect(await screen.findByTestId('incident-error')).toBeInTheDocument();
  });
});

describe('missing fields', () => {
  it('shows real coordinates when present', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({ select: { data: [makeRow()], error: null } })}
      />
    );

    await screen.findByTestId('incident-card');
    expect(screen.getByTestId('incident-coordinates')).toHaveTextContent('19.0988, 72.8267');
    expect(screen.queryByTestId('incident-no-location')).not.toBeInTheDocument();
  });

  it('states that location was not provided instead of inventing one', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({
          select: { data: [makeRow({ latitude: null, longitude: null })], error: null },
        })}
      />
    );

    await screen.findByTestId('incident-card');
    expect(screen.getByTestId('incident-no-location')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-coordinates')).not.toBeInTheDocument();
  });

  it('states that no photo was attached instead of showing a broken image', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({ select: { data: [makeRow()], error: null } })}
      />
    );

    await screen.findByTestId('incident-card');
    expect(screen.getByTestId('incident-no-photo')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-view-photo')).not.toBeInTheDocument();
  });

  it('states that no description was provided', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({
          select: { data: [makeRow({ description: '' })], error: null },
        })}
      />
    );

    await screen.findByTestId('incident-card');
    expect(screen.getByTestId('incident-card')).toHaveTextContent('No description provided');
  });

  it('never fabricates a status, severity or verification badge', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({ select: { data: [makeRow()], error: null } })}
      />
    );

    const card = await screen.findByTestId('incident-card');
    const text = card.textContent ?? '';
    for (const fabricated of ['VERIFIED', 'CRITICAL', 'RESOLVED', 'Escalated', 'Confirmed']) {
      expect(text).not.toContain(fabricated);
    }
  });
});

describe('photos use signed URLs only', () => {
  it('renders no image until an authorized viewer asks for one', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({
          select: { data: [makeRow({ photo_url: 'user-1/photo.jpg' })], error: null },
        })}
      />
    );

    await screen.findByTestId('incident-card');
    expect(screen.getByTestId('incident-view-photo')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-photo')).not.toBeInTheDocument();
  });

  it('shows the signed image once requested', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({
          select: { data: [makeRow({ photo_url: 'user-1/photo.jpg' })], error: null },
        })}
      />
    );

    await screen.findByTestId('incident-view-photo');
    fireEvent.click(screen.getByTestId('incident-view-photo'));

    await waitFor(() => expect(screen.getByTestId('incident-photo')).toBeInTheDocument());
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'https://signed.example/o'
    );
  });

  it('reports a signed URL failure instead of rendering a broken image', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({
          select: { data: [makeRow({ photo_url: 'other-user/photo.jpg' })], error: null },
          signedUrl: { data: null, error: { message: 'Unauthorized', code: '42501' } },
        })}
      />
    );

    await screen.findByTestId('incident-view-photo');
    fireEvent.click(screen.getByTestId('incident-view-photo'));

    const error = await screen.findByTestId('incident-photo-error');
    expect(error).toHaveTextContent('Unauthorized');
    expect(screen.queryByTestId('incident-photo')).not.toBeInTheDocument();
  });
});

describe('manual refresh', () => {
  it('does not claim the data is live', async () => {
    render(
      <IncidentIntelligence
        language="en"
        user={responder()}
        client={fakeClient({ select: { data: [makeRow()], error: null } })}
      />
    );

    await screen.findByTestId('incident-card');
    // Realtime is not confirmed on incident_reports, so no LIVE badge.
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
    expect(screen.getByTestId('incident-refresh')).toBeInTheDocument();
  });

  it('re-queries on refresh', async () => {
    const order = vi.fn(() => Promise.resolve({ data: [makeRow()], error: null }));
    const client: IncidentClientLike = {
      from: () => ({
        select: () => ({ order }),
        insert: () => Promise.resolve({ data: null, error: null }),
      }),
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ error: null }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'x' }, error: null }),
        }),
      },
    };

    render(<IncidentIntelligence language="en" user={responder()} client={client} />);
    await screen.findByTestId('incident-card');
    expect(order).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('incident-refresh'));
    await waitFor(() => expect(order).toHaveBeenCalledTimes(2));
  });
});

describe('localization', () => {
  it('renders the selected language', async () => {
    render(
      <IncidentIntelligence
        language="hi"
        user={responder()}
        client={fakeClient({ select: { data: [], error: null } })}
      />
    );

    expect(await screen.findByText('घटना सूचना')).toBeInTheDocument();
  });
});
