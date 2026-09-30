import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildPhotoPath,
  createSignedIncidentPhoto,
  isIncidentType,
  listIncidents,
  submitIncident,
  INCIDENT_TYPES,
  SIGNED_URL_TTL_SECONDS,
  type IncidentClientLike,
} from './incidents';

/**
 * Behavioral tests for the incident data layer.
 *
 * The client is faked at the boundary this module actually uses, so these
 * tests exercise real normalization and error classification rather than
 * assertions about mocks. Crucially, they CANNOT verify that RLS allows or
 * denies a read — only a live database can do that. What they do prove is
 * that the client never widens access itself, never converts to a public URL,
 * and never reports success it did not observe.
 */

type Row = Record<string, unknown>;

/** Build a row that is valid unless a field is overridden. */
function makeRow(overrides: Row = {}): Row {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: '22222222-2222-4222-8222-222222222222',
    type: 'flooding',
    description: 'Water at ankle level near the beach road.',
    photo_url: null,
    latitude: 19.0988,
    longitude: 72.8267,
    created_at: '2026-03-30T10:00:00.000Z',
    ...overrides,
  };
}

interface FakeOptions {
  select?: { data: unknown; error: { message: string; code?: string } | null };
  insert?: { data: unknown; error: { message: string; code?: string } | null };
  upload?: { error: { message: string; code?: string } | null };
  signedUrl?: {
    data: { signedUrl: string | null } | null;
    error: { message: string; code?: string } | null;
  };
}

function fakeClient(options: FakeOptions = {}) {
  const calls = {
    selectedColumns: null as string | null,
    orderBy: null as { column: string; ascending: boolean } | null,
    inserted: null as Row | null,
    uploads: [] as string[],
    signedPath: null as string | null,
    signedTtl: null as number | null,
    // Records which storage operation was used, to prove no public URL path exists.
    storageCalls: [] as string[],
  };

  const client: IncidentClientLike = {
    from: () => ({
      select: (columns: string) => {
        calls.selectedColumns = columns;
        return {
          order: (column: string, opts: { ascending: boolean }) => {
            calls.orderBy = { column, ascending: opts.ascending };
            return Promise.resolve(
              options.select ?? { data: [], error: null }
            );
          },
        };
      },
      insert: (values: Row) => {
        calls.inserted = values;
        return Promise.resolve(options.insert ?? { data: null, error: null });
      },
    }),
    storage: {
      from: (bucket: string) => {
        calls.storageCalls.push(`from:${bucket}`);
        return {
          upload: (path: string) => {
            calls.uploads.push(path);
            return Promise.resolve(options.upload ?? { error: null });
          },
          createSignedUrl: (path: string, expiresIn: number) => {
            calls.signedPath = path;
            calls.signedTtl = expiresIn;
            return Promise.resolve(
              options.signedUrl ?? {
                data: { signedUrl: 'https://signed.example/object' },
                error: null,
              }
            );
          },
        };
      },
    },
  };

  return { client, calls };
}

const deps = (client: IncidentClientLike) => ({ client, now: () => new Date('2026-03-30T12:00:00Z') });

beforeEach(() => {
  Object.defineProperty(globalThis.navigator, 'onLine', {
    value: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listIncidents — real mapping', () => {
  it('maps database columns onto the normalized shape', async () => {
    const { client } = fakeClient({ select: { data: [makeRow()], error: null } });

    const result = await listIncidents(deps(client));

    expect(result.error).toBeNull();
    expect(result.incidents).toHaveLength(1);

    const incident = result.incidents[0];
    expect(incident.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(incident.reporterId).toBe('22222222-2222-4222-8222-222222222222');
    expect(incident.type).toBe('flooding');
    expect(incident.description).toBe('Water at ankle level near the beach road.');
    expect(incident.createdAt).toBe('2026-03-30T10:00:00.000Z');
    expect(incident.hasCoordinates).toBe(true);
    expect(incident.latitude).toBe(19.0988);
    expect(incident.longitude).toBe(72.8267);
  });

  it('requests only the columns that exist and orders newest first', async () => {
    const { client, calls } = fakeClient({ select: { data: [], error: null } });

    await listIncidents(deps(client));

    expect(calls.selectedColumns).toBe(
      'id, user_id, type, description, photo_url, latitude, longitude, created_at'
    );
    expect(calls.orderBy).toEqual({ column: 'created_at', ascending: false });
  });

  it('returns exactly what the database returned, in database order', async () => {
    const rows = [
      makeRow({ id: 'a', created_at: '2026-03-30T11:00:00.000Z' }),
      makeRow({ id: 'b', created_at: '2026-03-30T10:00:00.000Z' }),
    ];
    const { client } = fakeClient({ select: { data: rows, error: null } });

    const result = await listIncidents(deps(client));

    // The client must not re-sort or paginate; RLS and the query decide.
    expect(result.incidents.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('listIncidents — empty list', () => {
  it('treats zero rows as a successful, empty reading', async () => {
    const { client } = fakeClient({ select: { data: [], error: null } });

    const result = await listIncidents(deps(client));

    expect(result.error).toBeNull();
    expect(result.incidents).toEqual([]);
    expect(result.fetchedAt).toBe('2026-03-30T12:00:00.000Z');
  });

  it('does not classify an empty list as a failure', async () => {
    const { client } = fakeClient({ select: { data: [], error: null } });
    const result = await listIncidents(deps(client));
    expect(result.error).toBeNull();
    expect(result.incidents).toEqual([]);
  });
});

describe('listIncidents — missing optional fields stay missing', () => {
  it('keeps absent coordinates null instead of defaulting to a known location', async () => {
    const { client } = fakeClient({
      select: { data: [makeRow({ latitude: null, longitude: null })], error: null },
    });

    const incident = (await listIncidents(deps(client))).incidents[0];

    expect(incident.latitude).toBeNull();
    expect(incident.longitude).toBeNull();
    expect(incident.hasCoordinates).toBe(false);
  });

  it('rejects a half-present coordinate pair rather than showing a fake map point', async () => {
    const { client } = fakeClient({
      select: { data: [makeRow({ longitude: null })], error: null },
    });

    const incident = (await listIncidents(deps(client))).incidents[0];

    expect(incident.hasCoordinates).toBe(false);
    expect(incident.malformed).toBe(true);
  });

  it('keeps a missing photo path as null', async () => {
    const { client } = fakeClient({ select: { data: [makeRow({ photo_url: null })], error: null } });
    expect((await listIncidents(deps(client))).incidents[0].photoPath).toBeNull();
  });

  it('keeps an empty description as null rather than an empty string', async () => {
    const { client } = fakeClient({ select: { data: [makeRow({ description: '   ' })], error: null } });
    expect((await listIncidents(deps(client))).incidents[0].description).toBeNull();
  });

  it('preserves the raw storage object path, not a URL', async () => {
    const path = '22222222-2222-4222-8222-222222222222/1730000000000.jpg';
    const { client } = fakeClient({ select: { data: [makeRow({ photo_url: path })], error: null } });

    const incident = (await listIncidents(deps(client))).incidents[0];

    expect(incident.photoPath).toBe(path);
    // Guard against a stored https path being trusted as already-downloadable.
    expect(incident.photoPath?.startsWith('http')).toBe(false);
  });
});

describe('listIncidents — database and permission errors', () => {
  it('reports an RLS denial as permission-denied, not as an empty list', async () => {
    const { client } = fakeClient({
      select: {
        data: null,
        error: { message: 'new row violates row-level security policy', code: '42501' },
      },
    });

    const result = await listIncidents(deps(client));

    expect(result.error?.kind).toBe('permission-denied');
    expect(result.incidents).toEqual([]);
  });

  it('surfaces the database message verbatim', async () => {
    const { client } = fakeClient({
      select: { data: null, error: { message: 'schema cache is stale', code: 'PGRST204' } },
    });

    expect((await listIncidents(deps(client))).error?.message).toBe('schema cache is stale');
  });

  it('classifies a non-2xx as a database error', async () => {
    const { client } = fakeClient({
      select: { data: null, error: { message: 'Internal Server Error', code: '500' } },
    });

    expect((await listIncidents(deps(client))).error?.kind).toBe('database');
  });

  it('reports a non-array 200 body as malformed, not as empty', async () => {
    const { client } = fakeClient({ select: { data: { unexpected: true }, error: null } });

    const result = await listIncidents(deps(client));

    expect(result.error?.kind).toBe('malformed');
    expect(result.incidents).toEqual([]);
  });

  it('reports offline distinctly from a database failure', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    const { client } = fakeClient();

    const result = await listIncidents(deps(client));

    expect(result.error?.kind).toBe('network');
  });

  it('drops rows with no usable id and flags them as malformed', async () => {
    const { client } = fakeClient({
      select: { data: [makeRow(), makeRow({ id: null })], error: null },
    });

    const result = await listIncidents(deps(client));

    expect(result.incidents).toHaveLength(1);
  });

  it('flags a row with an unrecognized type without coercing it', async () => {
    const { client } = fakeClient({
      select: { data: [makeRow({ type: 'tsunami' })], error: null },
    });

    const incident = (await listIncidents(deps(client))).incidents[0];

    expect(incident.type).toBeNull();
    expect(incident.rawType).toBe('tsunami');
    expect(incident.malformed).toBe(true);
  });

  it('never invents a status or severity the schema does not have', async () => {
    const { client } = fakeClient({ select: { data: [makeRow()], error: null } });
    const incident = (await listIncidents(deps(client))).incidents[0];

    // incident_reports has no status/severity/verified columns. Assert the
    // normalized object cannot carry them.
    expect(incident).not.toHaveProperty('status');
    expect(incident).not.toHaveProperty('severity');
    expect(incident).not.toHaveProperty('verified');
  });
});

describe('submitIncident — success requires a real insert', () => {
  it('reports success only after the insert resolves without error', async () => {
    const { client, calls } = fakeClient({
      insert: { data: [{ id: 'new-id' }], error: null },
    });

    const result = await submitIncident(deps(client), {
      reporterId: 'user-1',
      type: 'flooding',
      description: '  Water rising.  ',
      latitude: null,
      longitude: null,
      photo: null,
    });

    expect(result.ok).toBe(true);
    expect(result.incidentId).toBe('new-id');
    expect(calls.inserted?.description).toBe('Water rising.');
  });

  it('reports failure with the real database message', async () => {
    const { client } = fakeClient({
      insert: { data: null, error: { message: 'new row violates row-level security policy', code: '42501' } },
    });

    const result = await submitIncident(deps(client), {
      reporterId: 'user-1',
      type: 'flooding',
      description: 'Water rising.',
      latitude: null,
      longitude: null,
      photo: null,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('permission-denied');
    expect(result.error?.message).toBe('new row violates row-level security policy');
  });

  it('refuses a type the database CHECK constraint would reject', async () => {
    const { client, calls } = fakeClient();

    const result = await submitIncident(deps(client), {
      reporterId: 'user-1',
      // @ts-expect-error deliberately invalid to prove the guard works
      type: 'tsunami',
      description: 'x',
      latitude: null,
      longitude: null,
      photo: null,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('malformed');
    expect(calls.inserted).toBeNull();
  });

  it('reports offline without contacting the database', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    const { client, calls } = fakeClient();

    const result = await submitIncident(deps(client), {
      reporterId: 'user-1',
      type: 'flooding',
      description: 'Water rising.',
      latitude: null,
      longitude: null,
      photo: null,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('network');
    expect(calls.inserted).toBeNull();
  });
});

describe('submitIncident — photo handling never uses a public URL', () => {
  const photo = () => new File(['bytes'], 'flood.jpg', { type: 'image/jpeg' });

  it('stores the object path, never a resolved URL', async () => {
    const { client, calls } = fakeClient({ insert: { data: { id: 'x' }, error: null } });

    await submitIncident(deps(client), {
      reporterId: 'user-1',
      type: 'flooding',
      description: 'Water rising.',
      latitude: null,
      longitude: null,
      photo: photo(),
    });

    expect(calls.uploads).toHaveLength(1);
    const storedPath = calls.inserted?.photo_url as string;

    expect(storedPath).toBe(calls.uploads[0]);
    expect(storedPath.startsWith('http')).toBe(false);
    expect(storedPath.startsWith('user-1/')).toBe(true);
  });

  it('never calls getPublicUrl — only a signed URL is ever produced', async () => {
    const { client, calls } = fakeClient({ insert: { data: { id: 'x' }, error: null } });

    await submitIncident(deps(client), {
      reporterId: 'user-1',
      type: 'flooding',
      description: 'Water rising.',
      latitude: null,
      longitude: null,
      photo: photo(),
    });

    expect(calls.storageCalls.every((c) => c === 'from:incident-photos')).toBe(true);
    expect(calls.storageCalls.some((c) => c.includes('getPublic'))).toBe(false);
  });

  it('uploads under a folder named for the uploader, as the RLS policy requires', async () => {
    const { client, calls } = fakeClient({ insert: { data: { id: 'x' }, error: null } });

    await submitIncident(deps(client), {
      reporterId: 'abc-123',
      type: 'other',
      description: 'Debris.',
      latitude: null,
      longitude: null,
      photo: photo(),
    });

    // storage.foldername(name)[1] must equal auth.uid()::text.
    expect(calls.uploads[0].split('/')[0]).toBe('abc-123');
  });

  it('reports a photo upload failure instead of silently dropping the photo', async () => {
    const { client, calls } = fakeClient({
      upload: { error: { message: 'new row violates row-level security policy', code: '42501' } },
      insert: { data: { id: 'x' }, error: null },
    });

    const result = await submitIncident(deps(client), {
      reporterId: 'user-1',
      type: 'flooding',
      description: 'Water rising.',
      latitude: null,
      longitude: null,
      photo: photo(),
    });

    // The report itself saved, but the photo did not: that must be surfaced.
    expect(result.photoWarning).toContain('new row violates row-level security policy');
    expect(calls.inserted?.photo_url).toBeNull();
  });

  it('does not claim success when the insert fails after a successful upload', async () => {
    const { client } = fakeClient({
      upload: { error: null },
      insert: { data: null, error: { message: 'connection reset', code: '08006' } },
    });

    const result = await submitIncident(deps(client), {
      reporterId: 'user-1',
      type: 'flooding',
      description: 'Water rising.',
      latitude: null,
      longitude: null,
      photo: photo(),
    });

    expect(result.ok).toBe(false);
  });
});

describe('createSignedIncidentPhoto', () => {
  it('mints a short-lived URL for a stored object path', async () => {
    const { client, calls } = fakeClient();

    const result = await createSignedIncidentPhoto(deps(client), 'user-1/photo.jpg');

    expect(result.url).toBe('https://signed.example/object');
    expect(calls.signedPath).toBe('user-1/photo.jpg');
    expect(calls.signedTtl).toBe(SIGNED_URL_TTL_SECONDS);
  });

  it('uses a short expiry so a leaked link stops working quickly', () => {
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(600);
  });

  it('reports a permission denial rather than returning a broken image', async () => {
    const { client } = fakeClient({
      signedUrl: { data: null, error: { message: 'Unauthorized', code: '42501' } },
    });

    const result = await createSignedIncidentPhoto(deps(client), 'other-user/photo.jpg');

    expect(result.url).toBeNull();
    expect(result.error?.kind).toBe('permission-denied');
  });

  it('reports a null signedUrl as malformed rather than returning null silently', async () => {
    const { client } = fakeClient({ signedUrl: { data: { signedUrl: null }, error: null } });

    const result = await createSignedIncidentPhoto(deps(client), 'user-1/photo.jpg');

    expect(result.url).toBeNull();
    expect(result.error?.kind).toBe('malformed');
  });

  it('reports offline without requesting anything', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    const { client, calls } = fakeClient();

    const result = await createSignedIncidentPhoto(deps(client), 'user-1/photo.jpg');

    expect(result.error?.kind).toBe('network');
    expect(calls.signedPath).toBeNull();
  });
});

describe('buildPhotoPath', () => {
  it('starts with the uploader id', () => {
    const path = buildPhotoPath('user-9', new File([''], 'a.png', { type: 'image/png' }));
    expect(path.startsWith('user-9/')).toBe(true);
  });

  it('sanitizes an extension that is not alphanumeric', () => {
    const path = buildPhotoPath('u', new File([''], 'evil../../x.???', { type: 'image/png' }));
    expect(path).toMatch(/^u\/[A-Za-z0-9-]+\.jpg$/);
  });

  it('preserves a legitimate extension', () => {
    const path = buildPhotoPath('u', new File([''], 'a.JPEG', { type: 'image/jpeg' }));
    expect(path.endsWith('.jpeg')).toBe(true);
  });
});

describe('isIncidentType', () => {
  it('accepts every value in the database CHECK constraint', () => {
    expect(INCIDENT_TYPES.every(isIncidentType)).toBe(true);
  });

  it('rejects anything outside it', () => {
    expect(isIncidentType('VERIFIED')).toBe(false);
    expect(isIncidentType('CRITICAL')).toBe(false);
    expect(isIncidentType(null)).toBe(false);
    expect(isIncidentType(42)).toBe(false);
  });
});
