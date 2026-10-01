import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { useNetworkStatus } from './useNetworkStatus';
import { supabase } from '@/integrations/supabase/client';
import {
  queueIncident,
  getQueuedIncidents,
  getIncidentsByStatus,
  getIncidentsByUserId,
  updateIncidentStatus,
  removeIncident,
  clearSyncedIncidents,
  getQueueStats,
  QueuedIncident,
  OfflineQueueStats,
} from '@/lib/offlineIncidentQueue';
import { useToast } from '@/hooks/use-toast';

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE_MS = 5000;

export interface QueuedIncidentWithActions extends QueuedIncident {
  retry: () => Promise<void>;
  remove: () => Promise<void>;
}

export function useOfflineIncidentQueue() {
  const { user, session } = useAuth();
  const { isOnline, status: connectionStatus } = useNetworkStatus();
  const { toast } = useToast();

  const [stats, setStats] = useState<OfflineQueueStats>({
    queued: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
    requiresAction: 0,
  });
  const [userIncidents, setUserIncidents] = useState<QueuedIncident[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);
  const syncTimeoutRef = useRef<number | null>(null);

  const refreshStats = useCallback(async () => {
    const [allStats, userIncidentsData] = await Promise.all([
      getQueueStats(),
      user ? getIncidentsByUserId(user.id) : Promise.resolve([]),
    ]);
    setStats(allStats);
    setUserIncidents(userIncidentsData);
  }, [user]);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    if (connectionStatus === 'online' && isOnline && !processingRef.current) {
      processQueue();
    }
  }, [connectionStatus, isOnline, user]);

  const processQueue = useCallback(async () => {
    if (!user || !session || processingRef.current || !isOnline) return;

    processingRef.current = true;
    setIsProcessing(true);

    try {
      const queuedIncidents = await getIncidentsByStatus('queued');

      for (const incident of queuedIncidents) {
        if (!isOnline) break;

        if (incident.userId !== user.id) {
          await updateIncidentStatus(incident.localQueueId, 'requires_action', 'User mismatch - cannot sync under different account');
          continue;
        }

        if (incident.retryCount >= MAX_RETRIES) {
          await updateIncidentStatus(incident.localQueueId, 'failed', `Max retries (${MAX_RETRIES}) exceeded`);
          continue;
        }

        await updateIncidentStatus(incident.localQueueId, 'syncing');

        try {
          let photoUrl: string | null = null;

          if (incident.photoBlob) {
            const ext = incident.photoName?.split('.').pop() || 'jpg';
            const path = `${incident.userId}/${Date.now()}.${ext}`;
            const { error: uploadErr } = await supabase.storage
              .from('incident-photos')
              .upload(path, incident.photoBlob);

            if (!uploadErr) {
              const { data: urlData } = supabase.storage.from('incident-photos').getPublicUrl(path);
              photoUrl = urlData.publicUrl;
            }
          }

          const { error } = await supabase.from('incident_reports').insert({
            user_id: incident.userId,
            type: incident.type,
            description: incident.description,
            photo_url: photoUrl,
            latitude: incident.latitude,
            longitude: incident.longitude,
          });

          if (error) throw error;

          await updateIncidentStatus(incident.localQueueId, 'synced');
          toast({ title: '✅', description: 'Offline report synced successfully' });
        } catch (err: any) {
          await updateIncidentStatus(incident.localQueueId, 'failed', err.message);
        }

        await new Promise(r => setTimeout(r, 500));
      }

      await clearSyncedIncidents();
    } catch (err) {
      console.error('Queue processing error:', err);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
      await refreshStats();
    }
  }, [user, session, isOnline, refreshStats]);

  const queueNewIncident = useCallback(async (
    type: QueuedIncident['type'],
    description: string,
    photo: File | null,
    latitude: number | null,
    longitude: number | null
  ): Promise<string> => {
    if (!user) throw new Error('User not authenticated');

    let photoBlob: Blob | null = null;
    let photoName: string | null = null;

    if (photo) {
      photoBlob = photo;
      photoName = photo.name;
    }

    const localQueueId = await queueIncident({
      userId: user.id,
      type,
      description: description.trim(),
      photoBlob,
      photoName,
      latitude,
      longitude,
      createdAt: '',
      status: 'queued',
      retryCount: 0,
      lastError: null,
      localQueueId: '',
      id: '',
    });

    await refreshStats();
    return localQueueId;
  }, [user, refreshStats]);

  const retryIncident = useCallback(async (localQueueId: string) => {
    await updateIncidentStatus(localQueueId, 'queued');
    await refreshStats();
    if (isOnline) processQueue();
  }, [refreshStats, isOnline, processQueue]);

  const removeQueuedIncident = useCallback(async (localQueueId: string) => {
    await removeIncident(localQueueId);
    await refreshStats();
  }, [refreshStats]);

  const clearHistory = useCallback(async () => {
    await clearSyncedIncidents();
    await refreshStats();
  }, [refreshStats]);

  const getUserIncidentsWithActions = useCallback((): QueuedIncidentWithActions[] => {
    return userIncidents.map(incident => ({
      ...incident,
      retry: () => retryIncident(incident.localQueueId),
      remove: () => removeQueuedIncident(incident.localQueueId),
    }));
  }, [userIncidents, retryIncident, removeQueuedIncident]);

  return {
    stats,
    userIncidents: getUserIncidentsWithActions(),
    isProcessing,
    connectionStatus,
    queueNewIncident,
    retryIncident,
    removeIncident: removeQueuedIncident,
    clearHistory,
    refreshStats,
    processQueue,
  };
}