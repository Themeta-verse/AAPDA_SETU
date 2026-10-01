export type IncidentType = 'flooding' | 'high_waves' | 'blocked_roads' | 'other';

export interface QueuedIncident {
  id: string;
  userId: string;
  type: IncidentType;
  description: string;
  photoBlob: Blob | null;
  photoName: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  status: 'queued' | 'syncing' | 'synced' | 'failed' | 'requires_action';
  retryCount: number;
  lastError: string | null;
  localQueueId: string;
}

export interface OfflineQueueStats {
  queued: number;
  syncing: number;
  synced: number;
  failed: number;
  requiresAction: number;
}

const DB_NAME = 'baywatch_offline';
const STORE_NAME = 'incident_queue';
const DB_VERSION = 1;

interface DBIncident extends QueuedIncident {
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'localQueueId' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
}
    };
  });
}

/**
 * Run an IndexedDB operation and resolve with its outcome.
 *
 * The callback may return either the raw IDBRequest (simple get/add/put/
 * delete) or a Promise that settles when a multi-step read-modify-write
 * finishes. Both shapes occur in this file, and the previous signature only
 * accepted IDBRequest: promise-returning callers had `.onsuccess` assigned
 * onto a Promise object, which never fires, so queue reads and status
 * updates hung forever without resolving or rejecting.
 */
function withStore<T>(mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest | Promise<T>): Promise<T> {
  return openDB().then(db => {
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result: IDBRequest | Promise<T>;
      try {
        result = callback(store);
      } catch (e) {
        reject(e);
        return;
      }
      if (result instanceof Promise) {
        result.then(resolve, reject);
      } else {
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      }
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => reject(transaction.error);
    });
  });
}

export function generateQueueId(): string {
  return `queue_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export async function queueIncident(incident: Omit<QueuedIncident, 'localQueueId' | 'status' | 'retryCount' | 'lastError' | 'createdAt' | 'id'>): Promise<string> {
  const localQueueId = generateQueueId();
  const now = new Date().toISOString();
  const dbIncident: DBIncident = {
    ...incident,
    // The server assigns the permanent id on sync; until then the local queue
    // id is the incident's identity (it is also the store keyPath).
    id: localQueueId,
    localQueueId,
    status: 'queued',
    retryCount: 0,
    lastError: null,
    createdAt: now,
    timestamp: Date.now(),
  };

  await withStore('readwrite', store => store.add(dbIncident));
  return localQueueId;
}

export async function getQueuedIncidents(): Promise<QueuedIncident[]> {
  return withStore('readonly', store => {
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const incidents = request.result.map(({ timestamp, ...rest }) => rest);
        resolve(incidents.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
      };
      request.onerror = () => reject(request.error);
    });
  });
}

export async function getIncidentsByStatus(status: QueuedIncident['status']): Promise<QueuedIncident[]> {
  return withStore('readonly', store => {
    const index = store.index('status');
    const request = index.getAll(status);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const incidents = request.result.map(({ timestamp, ...rest }) => rest);
        resolve(incidents.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
      };
      request.onerror = () => reject(request.error);
    });
  });
}

export async function getIncidentsByUserId(userId: string): Promise<QueuedIncident[]> {
  return withStore('readonly', store => {
    const index = store.index('userId');
    const request = index.getAll(userId);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const incidents = request.result.map(({ timestamp, ...rest }) => rest);
        resolve(incidents.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
      };
      request.onerror = () => reject(request.error);
    });
  });
}

export async function updateIncidentStatus(
  localQueueId: string,
  status: QueuedIncident['status'],
  error?: string
): Promise<void> {
  return withStore('readwrite', store => {
    const request = store.get(localQueueId);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const incident = request.result;
        if (!incident) {
          reject(new Error('Incident not found'));
          return;
        }
        incident.status = status;
        if (error) incident.lastError = error;
        if (status === 'syncing') incident.retryCount += 1;
        if (status === 'failed') incident.retryCount += 1;
        const putRequest = store.put(incident);
        putRequest.onsuccess = () => resolve(undefined);
        putRequest.onerror = () => reject(putRequest.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

export async function removeIncident(localQueueId: string): Promise<void> {
  return withStore('readwrite', store => store.delete(localQueueId));
}

export async function clearSyncedIncidents(): Promise<number> {
  const synced = await getIncidentsByStatus('synced');
  for (const incident of synced) {
    await removeIncident(incident.localQueueId);
  }
  return synced.length;
}

export async function getQueueStats(): Promise<OfflineQueueStats> {
  const all = await getQueuedIncidents();
  return {
    queued: all.filter(i => i.status === 'queued').length,
    syncing: all.filter(i => i.status === 'syncing').length,
    synced: all.filter(i => i.status === 'synced').length,
    failed: all.filter(i => i.status === 'failed').length,
    requiresAction: all.filter(i => i.status === 'requires_action').length,
  };
}

export async function clearAllIncidents(): Promise<void> {
  return withStore('readwrite', store => store.clear());
}