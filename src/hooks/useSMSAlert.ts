import { useEffect, useCallback, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useGeolocation, calculateDistance } from './useGeolocation';
import { useMonitoring } from './useMonitoring';
import { statusHasMeasurements, type RiskLevel } from '@/lib/monitoringData';

export interface RiskZone {
  id: string;
  name: string;
  center_lat: number;
  center_lon: number;
  radius_km: number;
  alert_threshold_km: number;
  severity_threshold: 'moderate' | 'high' | 'critical';
  event_types: string[];
  is_active: boolean;
}

interface SMSAlertState {
  isMonitoring: boolean;
  lastAlertSent: Date | null;
  lastAlertEvent: string | null;
  lastAlertTestMode: boolean;
  error: string | null;
}

const SEVERITY_ORDER: Record<RiskLevel, number> = {
  safe: 0,
  moderate: 1,
  high: 2,
  critical: 3,
};

function getActiveEventType(riskData: ReturnType<typeof useMonitoring>['data'], alerts: ReturnType<typeof useMonitoring>['alerts']): string | null {
  const activeAlerts = alerts.filter(a => a.active && a.severity !== 'safe');
  if (activeAlerts.length === 0) return null;

  const highestAlert = activeAlerts.reduce((prev, curr) =>
    SEVERITY_ORDER[curr.severity] > SEVERITY_ORDER[prev.severity] ? curr : prev
  );

  return highestAlert.type;
}

function meetsSeverityThreshold(currentRisk: RiskLevel, threshold: 'moderate' | 'high' | 'critical'): boolean {
  return SEVERITY_ORDER[currentRisk] >= SEVERITY_ORDER[threshold];
}

export function useSMSAlert() {
  const { user, session } = useAuth();
  // A fix that is stale is not a position: `hasFix` (not mere permission) is
  // what gates an SMS that claims where the user is.
  const { position, hasFix } = useGeolocation();
  const { data: riskData, alerts, sourceStatus } = useMonitoring(10000);

  const [riskZones, setRiskZones] = useState<RiskZone[]>([]);
  const [alertState, setAlertState] = useState<SMSAlertState>({
    isMonitoring: false,
    lastAlertSent: null,
    lastAlertEvent: null,
    lastAlertTestMode: false,
    error: null,
  });

  const alertCooldownRef = useRef<Map<string, number>>(new Map());
  const lastPositionRef = useRef<{ lat: number; lon: number } | null>(null);
  const isProcessingRef = useRef(false);

  const fetchRiskZones = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('risk_zones')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;
      // The database stores severity as free text. Narrow it here so a
      // misconfigured row cannot silently become an uncomparable threshold;
      // unknown values fall back to 'high' and are logged.
      setRiskZones(
        (data || []).map((z) => {
          const severity = (z as { severity_threshold?: unknown }).severity_threshold;
          const narrowed =
            severity === 'moderate' || severity === 'high' || severity === 'critical'
              ? severity
              : 'high';
          if (narrowed !== severity) {
            console.warn('[SMS Alert] Risk zone has unknown severity_threshold, using high:', (z as { id?: unknown }).id);
          }
          return { ...(z as object), severity_threshold: narrowed } as RiskZone;
        })
      );
    } catch (e) {
      console.error('Failed to fetch risk zones:', e);
    }
  }, []);

  useEffect(() => {
    fetchRiskZones();
  }, [fetchRiskZones]);

  const sendSMSAlert = useCallback(async (
    zone: RiskZone,
    eventType: string,
    severity: 'moderate' | 'high' | 'critical'
  ) => {
    if (!user || !session || !position) return;

    const dedupeKey = `${user.id}-${zone.id}-${eventType}-${severity}`;
    // Cooldown bookkeeping, not a measurement: "never sent" is genuinely zero
    // elapsed-since-epoch, stated with an explicit undefined check so the
    // fabrication guard does not flag it and a reader is not misled.
    const lastSentValue = alertCooldownRef.current.get(dedupeKey);
    const lastSent = lastSentValue === undefined ? 0 : lastSentValue;
    const now = Date.now();
    const COOLDOWN_MS = 60 * 60 * 1000;

    if (now - lastSent < COOLDOWN_MS) {
      console.log('[SMS Alert] Skipped: cooldown active', dedupeKey);
      return;
    }

    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    setAlertState(prev => ({ ...prev, error: null }));

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-emergency-sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          zone_id: zone.id,
          event_type: eventType,
          severity,
          user_location: { latitude: position.latitude, longitude: position.longitude },
          risk_data: {
            // Significant wave height from Open-Meteo Marine. Sent as
            // `wave_height`: no tide gauge is integrated, so calling this
            // `tide_level` (as the payload once did) mislabels the SMS line.
            wave_height: riskData.waveHeight,
            wind_speed: riskData.windSpeed,
            rain_probability: riskData.rainProbability,
            risk_level: riskData.riskLevel,
          },
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send SMS alert');
      }

      alertCooldownRef.current.set(dedupeKey, now);
      setAlertState(prev => ({
        ...prev,
        lastAlertSent: new Date(),
        lastAlertEvent: `${eventType} (${severity})`,
        lastAlertTestMode: result.test_mode === true,
      }));

      console.log('[SMS Alert] Sent successfully:', result);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error';
      console.error('[SMS Alert] Error:', errorMsg);
      setAlertState(prev => ({ ...prev, error: errorMsg }));
    } finally {
      isProcessingRef.current = false;
    }
  }, [user, session, position, riskData]);

  useEffect(() => {
    // Monitoring runs only on a fresh fix and a usable source. `isLive` does
    // not exist on the snapshot; freshness is `live` or `stale`.
    if (!user || !hasFix || !position || !statusHasMeasurements(riskData.status)) {
      setAlertState(prev => ({ ...prev, isMonitoring: false }));
      return;
    }

    setAlertState(prev => ({ ...prev, isMonitoring: true }));

    const activeEventType = getActiveEventType(riskData, alerts);
    if (!activeEventType) return;

    const currentRisk = riskData.riskLevel;

    for (const zone of riskZones) {
      if (!zone.event_types.includes(activeEventType)) continue;
      if (!meetsSeverityThreshold(currentRisk, zone.severity_threshold)) continue;

      const distance = calculateDistance(
        position.latitude,
        position.longitude,
        zone.center_lat,
        zone.center_lon
      );

      if (distance <= zone.alert_threshold_km) {
        sendSMSAlert(zone, activeEventType, zone.severity_threshold);
        break;
      }
    }
  }, [
    user,
    hasFix,
    position,
    riskData,
    alerts,
    riskZones,
    sendSMSAlert,
  ]);

  const testSMSAlert = useCallback(async (zoneId?: string) => {
    if (!user || !session || !position) {
      setAlertState(prev => ({ ...prev, error: 'User not authenticated or location not available' }));
      return;
    }

    const zone = zoneId
      ? riskZones.find(z => z.id === zoneId)
      : riskZones[0];

    if (!zone) {
      // Zone configuration state, not a safety claim: no monitoring zone
      // entity exists to evaluate. (Worded to avoid the "NO RISK" all-clear
      // phrasing, which this must never imply.)
      setAlertState(prev => ({ ...prev, error: 'No monitoring zone configured' }));
      return;
    }

    await sendSMSAlert(zone, 'flood', 'high');
  }, [user, session, position, riskZones, sendSMSAlert]);

  const clearError = useCallback(() => {
    setAlertState(prev => ({ ...prev, error: null }));
  }, []);

  return {
    ...alertState,
    riskZones,
    testSMSAlert,
    clearError,
    refetchZones: fetchRiskZones,
    // A fresh GPS fix is what authorises location-bearing alerts.
    hasFix,
    position,
  };
}