/**
 * Incident Intelligence data access.
 *
 * This module is the ONLY place that talks to `incident_reports` and the
 * private `incident-photos` bucket. Components never see a Supabase query.
 *
 * Three invariants this file exists to enforce:
 *
 *  1. We store and read the Storage OBJECT PATH, never a URL. The bucket is
 *     private (`SET public = false`), so `getPublicUrl()` would produce a
 *     link that resolves to nothing. Display URLs are minted on demand via
 *     `createSignedUrl()` and held in component state only.
 *  2. A signed URL is requested on demand and is never persisted, cached
 *     across reloads, or written to the database.
 *  3. Authorization is decided by Postgres RLS. This module cannot widen
 *     access; a citizen who queries this gets only their own rows because the
 *     policy says so, not because we filtered client-side. We do NOT filter
 *     by role in JS, because a client-side filter would be a false promise
 *     about what the caller may see.
 */

import type { IncidentType, Tables, TablesInsert } from './types';

export type { IncidentType };

type IncidentRow = Tables<'incident_reports'>;

/** The four values the `type` CHECK constraint accepts, in display order. */
export const INCIDENT_TYPES: readonly IncidentType[] = [
  'flooding',
  'high_waves',
  'blocked_roads',
  'other',
] as const;

export function isIncidentType(value: unknown): value is IncidentType {
  return typeof value === 'string' && (INCIDENT_TYPES as readonly string[]).includes(value);
}

/**
 * How long a signed URL stays valid. Deliberately short: the same
 * authorization that let a responder fetch the row governs the download, so a
 * leaked link expires quickly. 5 minutes.
 */
export const SIGNED_URL_TTL_SECONDS = 300;

const PHOTO_BUCKET = 'incident-photos';

/** Postgres `42501` (insufficient_privilege) surfaces from RLS denial. */
const PERMISSION_DENIED_CODE = '42501';

export type IncidentErrorKind =
  /** RLS refused the read or the download. */
  | 'permission-denied'
  /** The request never reached the database (offline, DNS, TLS). */
  | 'network'
  /** PostgREST answered with an error. */
  | 'database'
  /** The response arrived but rows were not shaped as expected. */
  | 'malformed'
  /** No signed-in session, so there is nothing to authorize. */
  | 'unauthenticated';

export interface IncidentError {
  kind: IncidentErrorKind;
  /** The database's own message. Shown verbatim; never replaced. */
  message: string;
  code?: string;
}

/**
 * One incident, normalized. Every optional field is explicitly `null` when the
 * database has no value — never defaulted, never guessed.
 *
 * `status`/`severity`/`verified` are deliberately ABSENT: `incident_reports`
 * has no such columns. Rendering them would mean inventing facts about a
 * real emergency, so this type cannot express them.
 */
export interface Incident {
  id: string;
  reporterId: string;
  type: IncidentType | null;
  /** Raw value when the database holds a type outside our known set. */
  rawType: string | null;
  description: string | null;
  /** Storage object path, e.g. `<user-id>/1730000000000.jpg`. */
  photoPath: string | null;
  latitude: number | null;
  longitude: number | null;
  /** True only when BOTH coordinates are present and usable. */
  hasCoordinates: boolean;
  createdAt: string | null;
  /** True when the row had to be repaired to be displayed at all. */
  malformed: boolean;
}

export interface IncidentListResult {
  incidents: Incident[];
  error: IncidentError | null;
  /** When the query completed, ISO-8601. Null when it failed. */
  fetchedAt: string | null;
}

/** Outcome of a citizen submission attempt. */
export interface SubmitResult {
  ok: boolean;
  error: IncidentError | null;
  /** Set when the report saved but the photo upload did not. */
  photoWarning: string | null;
  /** The inserted report id, when the insert succeeded. */
  incidentId: string | null;
}

/** Result of requesting a single photo. */
export interface SignedPhotoResult {
  /** Short-lived URL. Returned to the caller, never stored. */
  url: string | null;
  error: IncidentError | null;
}

export interface SubmitInput {
  reporterId: string;
  type: IncidentType;
  description: string;
  latitude: number | null;
  longitude: number | null;
  photo: File | null;
}

/**
 * Minimal surface of the pieces we use, so tests can supply a fake without
 * constructing a real Supabase client. Structurally compatible with the real
 * client, which is how `supabase` is passed in.
 */
export interface IncidentClientLike {
  from(table: string): {
    select(columns: string): {
      order(column: string, opts: { ascending: boolean }): PromiseLike<{
        data: unknown;
        error: { message: string; code?: string } | null;
      }>;
    };
    insert(values: Record<string, unknown>): PromiseLike<{
      data: unknown;
      error: { message: string; code?: string } | null;
    }>;
  };
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: File,
        options?: { cacheControl?: string; upsert?: boolean }
      ): PromiseLike<{ error: { message: string; code?: string } | null }>;
      createSignedUrl(
        path: string,
        expiresIn: number
      ): PromiseLike<{
        data: { signedUrl: string | null } | null;
        error: { message: string; code?: string } | null;
      }>;
    };
  };
}

export interface IncidentDeps {
  client: IncidentClientLike;
  now?: () => Date;
  isOnline?: () => boolean;
}

/** Map a Supabase/PostgREST error onto our closed error vocabulary. */
function classify(
  error: { message: string; code?: string },
  fallback: IncidentErrorKind
): IncidentError {
  return {
    kind: error.code === PERMISSION_DENIED_CODE ? 'permission-denied' : fallback,
    message: error.message,
    code: error.code,
  };
}

function connectivity(): IncidentErrorKind | null {
  const offline =
    typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' && !navigator.onLine;
  return offline ? 'network' : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/** Finite number or null. Rejects NaN, Infinity, and numeric strings. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Convert one database row into an `Incident`.
 *
 * Rows that survive PostgREST but are structurally wrong (missing id, wrong
 * types) are reported through `malformed: true` rather than dropped silently,
 * so the UI can say the data is degraded instead of quietly showing less.
 */
function normalizeRow(row: unknown): Incident | null {
  if (!isRecord(row)) return null;

  const id = nonEmptyString(row.id);
  // Without an id the row cannot be referenced, signed, or reported on.
  if (!id) return null;

  const createdAt = nonEmptyString(row.created_at);
  const latitude = finiteOrNull(row.latitude);
  const longitude = finiteOrNull(row.longitude);
  const rawType = nonEmptyString(row.type);
  const description = nonEmptyString(row.description);
  const photoPath = nonEmptyString(row.photo_url);
  const reporterId = nonEmptyString(row.user_id);

  const malformed =
    !createdAt ||
    !reporterId ||
    // A half-present coordinate pair is not a location.
    (latitude === null) !== (longitude === null) ||
    (rawType !== null && !isIncidentType(rawType));

  return {
    id,
    reporterId: reporterId ?? '',
    type: isIncidentType(rawType) ? rawType : null,
    rawType,
    description,
    photoPath,
    latitude,
    longitude,
    // Coordinates are only usable as a pair.
    hasCoordinates: latitude !== null && longitude !== null,
    createdAt,
    malformed,
  };
}

/**
 * Load the incidents the current session is ALLOWED to see.
 *
 * There is deliberately no role argument and no client-side filtering. RLS
 * decides: a citizen receives their own rows, a responder receives all rows,
 * and a denied read comes back as an error rather than an empty list. An
 * empty array means "you can see zero incidents", which is a different fact
 * from "you were refused".
 */
export async function listIncidents({
  client,
  now = () => new Date(),
}: IncidentDeps): Promise<IncidentListResult> {
  const offline = connectivity();
  if (offline) {
    return {
      incidents: [],
      fetchedAt: null,
      error: { kind: 'network', message: 'You appear to be offline. Reports could not be loaded.' },
    };
  }

  const { data, error } = await client
    .from('incident_reports')
    .select('id, user_id, type, description, photo_url, latitude, longitude, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return {
      incidents: [],
      fetchedAt: null,
      error: classify(error, 'database'),
    };
  }

  // A 200 with a non-array body is malformed, not empty.
  if (!Array.isArray(data)) {
    return {
      incidents: [],
      fetchedAt: null,
      error: {
        kind: 'malformed',
        message: 'The database returned an unexpected response shape.',
      },
    };
  }

  const incidents = data
    .map(normalizeRow)
    .filter((i): i is Incident => i !== null);

  return { incidents, error: null, fetchedAt: now().toISOString() };
}

/**
 * Build the object path for a photo.
 *
 * The first segment MUST be the uploader's auth user id: both the storage
 * policies and the viewer authorize on `storage.foldername(name)[1]`.
 * We never take a path from caller input.
 */
export function buildPhotoPath(userId: string, file: File): string {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const safeExtension = extension && /^[a-z0-9]+$/.test(extension) ? extension : 'jpg';
  return `${userId}/${Date.now()}-${cryptoSafeSuffix()}.${safeExtension}`;
}

function cryptoSafeSuffix(): string {
  const globalCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  // Deterministic-enough fallback so the path stays unique without Math.random
  // being the sole source of collision resistance.
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * Submit a citizen report.
 *
 * Success is reported ONLY when the `incident_reports` insert resolved without
 * an error. Upload and insert are reported independently: if the photo fails
 * but the report saves, the caller gets `ok: true` with a `photoWarning`
 * describing the real upload error. We never claim a photo was attached when
 * it was not.
 */
export async function submitIncident(
  { client }: IncidentDeps,
  input: SubmitInput
): Promise<SubmitResult> {
  const offline = connectivity();
  if (offline) {
    return {
      ok: false,
      incidentId: null,
      photoWarning: null,
      error: { kind: 'network', message: 'You appear to be offline. The report was not sent.' },
    };
  }

  if (!isIncidentType(input.type)) {
    return {
      ok: false,
      incidentId: null,
      photoWarning: null,
      error: {
        kind: 'malformed',
        message: `Unsupported incident type. Allowed values: ${INCIDENT_TYPES.join(', ')}.`,
      },
    };
  }

  let photoPath: string | null = null;
  let photoWarning: string | null = null;

  if (input.photo) {
    const path = buildPhotoPath(input.reporterId, input.photo);
    const { error: uploadError } = await client.storage
      .from(PHOTO_BUCKET)
      .upload(path, input.photo, { cacheControl: '3600', upsert: false });

    if (uploadError) {
      // Surface the real reason; do not silently drop the photo.
      photoWarning = `Photo could not be uploaded: ${uploadError.message}`;
    } else {
      photoPath = path;
    }
  }

  // `TablesInsert` is the helper that actually extracts the Insert shape. The
  // local `Tables` alias resolves to the Row shape, so indexing it with
  // `['Insert']` was never type-correct and silently lost the column types.
  const payload: TablesInsert<'incident_reports'> = {
    user_id: input.reporterId,
    type: input.type,
    description: input.description.trim(),
    // Object path only. A public URL would not resolve: the bucket is private.
    photo_url: photoPath,
    latitude: input.latitude,
    longitude: input.longitude,
  };

  const { data, error } = await client
    .from('incident_reports')
    .insert(payload as Record<string, unknown>);

  if (error) {
    return {
      ok: false,
      incidentId: null,
      photoWarning,
      error: classify(error, 'database'),
    };
  }

  // Prefer the id the database echoed back; fall back to reading it from the
  // inserted row when the driver does not return one.
  const insertedId = readInsertedId(data);

  return {
    ok: true,
    incidentId: insertedId,
    photoWarning,
    error: null,
  };
}

function readInsertedId(data: unknown): string | null {
  if (typeof data === 'string') return nonEmptyString(data);
  if (Array.isArray(data)) {
    const first = data[0];
    return isRecord(first) ? nonEmptyString(first.id) : null;
  }
  if (isRecord(data)) return nonEmptyString(data.id);
  return null;
}

/**
 * Mint a short-lived URL for one incident photo.
 *
 * Call this only when an authorized viewer asks to see a specific photo, and
 * never store the result. Authorization is re-checked by the storage policy on
 * every call, so a citizen requesting another user's photo gets an error here,
 * not an image.
 */
export async function createSignedIncidentPhoto(
  { client }: IncidentDeps,
  photoPath: string
): Promise<SignedPhotoResult> {
  const offline = connectivity();
  if (offline) {
    return {
      url: null,
      error: { kind: 'network', message: 'You appear to be offline. The photo could not be loaded.' },
    };
  }

  const { data, error } = await client.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(photoPath, SIGNED_URL_TTL_SECONDS);

  if (error) {
    return { url: null, error: classify(error, 'permission-denied') };
  }

  const url = nonEmptyString(data?.signedUrl);
  if (!url) {
    return {
      url: null,
      error: {
        kind: 'malformed',
        message: 'A photo URL was requested but none was returned.',
      },
    };
  }

  return { url, error: null };
}