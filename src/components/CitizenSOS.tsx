import { useState } from 'react';
import {
  AlertOctagon,
  Waves,
  LifeBuoy,
  HeartPulse,
  HelpCircle,
  MapPin,
  MapPinOff,
  Send,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
} from 'lucide-react';
import { type Language } from '@/lib/translations';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  submitIncident,
  type IncidentClientLike,
  type IncidentType,
} from '@/integrations/supabase/incidents';

export type SosType = 'FLOOD' | 'TRAPPED' | 'MEDICAL' | 'OTHER';

interface CitizenSOSProps {
  language?: Language;
  userId?: string;
  client?: IncidentClientLike;
  onSosSubmitted?: (incidentId: string) => void;
}

export function CitizenSOS({
  language = 'en',
  userId,
  client,
  onSosSubmitted,
}: CitizenSOSProps) {
  const [selectedType, setSelectedType] = useState<SosType>('FLOOD');
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { position, error: geoError, refresh: refreshGeo } = useGeolocation();
  const { isOnline } = useNetworkStatus();
  const { toast } = useToast();

  const sosOptions: {
    type: SosType;
    label: string;
    icon: typeof Waves;
    desc: string;
    incidentType: IncidentType;
  }[] = [
    {
      type: 'FLOOD',
      label: 'FLOOD',
      icon: Waves,
      desc: 'Rapid water level rise / submergence',
      incidentType: 'flooding',
    },
    {
      type: 'TRAPPED',
      label: 'TRAPPED',
      icon: LifeBuoy,
      desc: 'Stranded without safe exit route',
      incidentType: 'flooding',
    },
    {
      type: 'MEDICAL',
      label: 'MEDICAL',
      icon: HeartPulse,
      desc: 'Critical health emergency / injury',
      incidentType: 'other',
    },
    {
      type: 'OTHER',
      label: 'OTHER',
      icon: HelpCircle,
      desc: 'Other acute life-safety threat',
      incidentType: 'other',
    },
  ];

  const handleSendSos = async () => {
    if (!userId) {
      const msg = 'Sign-in required to transmit an emergency SOS beacon to responders.';
      setError(msg);
      toast({
        variant: 'destructive',
        title: 'Authentication Required',
        description: msg,
      });
      return;
    }

    if (!isOnline) {
      const msg = 'Network disconnected. Emergency SOS requires an active network link.';
      setError(msg);
      toast({
        variant: 'destructive',
        title: 'Network Offline',
        description: msg,
      });
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const activeOption = sosOptions.find((o) => o.type === selectedType) ?? sosOptions[0];
    const descriptionText = `[URGENT SOS: ${selectedType}] ${
      details.trim() ? details.trim() : `${activeOption.desc}. Immediate assistance requested.`
    }`;

    // Real GPS coordinates only — NEVER fabricate coordinates
    const lat = position && Number.isFinite(position.latitude) ? position.latitude : null;
    const lon = position && Number.isFinite(position.longitude) ? position.longitude : null;

    try {
      const activeClient = client ?? (supabase as unknown as IncidentClientLike);
      const res = await submitIncident(
        { client: activeClient },
        {
          reporterId: userId,
          type: activeOption.incidentType,
          description: descriptionText,
          latitude: lat,
          longitude: lon,
          photo: null,
        }
      );

      if (!res.ok || !res.incidentId) {
        const errorMsg = res.error?.message || 'Emergency signal could not be transmitted.';
        setError(errorMsg);
        toast({
          variant: 'destructive',
          title: 'SOS Transmission Failed',
          description: errorMsg,
        });
        return;
      }

      setSubmittedId(res.incidentId);

      // Record audit event for SOS transmission
      if (typeof activeClient.from === 'function') {
        try {
          await activeClient.from('incident_audit_logs').insert({
            incident_id: res.incidentId,
            performed_by: userId,
            action: 'sos_created',
            previous_status: null,
            new_status: 'unverified',
            notes: `Citizen emergency SOS triggered (${selectedType}) via real beacon`,
          });
        } catch {
          // Non-blocking for audit failure
        }
      }

      toast({
        title: '🚨 Emergency SOS Dispatched',
        description: `Signal transmitted to Incident Command. Ref: #AS-${(res.incidentId || '').slice(0, 8).toUpperCase()}`,
      });

      if (onSosSubmitted) {
        onSosSubmitted(res.incidentId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transmission failed';
      setError(msg);
      toast({
        variant: 'destructive',
        title: 'SOS Failed',
        description: msg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmittedId(null);
    setDetails('');
    setError(null);
  };

  return (
    <section
      className="rounded-2xl border-2 border-red-500/40 bg-gradient-to-b from-red-950/30 to-background p-4 sm:p-5 shadow-lg shadow-red-950/20 space-y-4"
      aria-label="Citizen Emergency SOS"
      data-testid="citizen-sos-section"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-red-500/20">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-red-600/20 text-red-500 border border-red-500/30 animate-pulse">
            <AlertOctagon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-black tracking-wide text-foreground uppercase">
                Emergency Citizen SOS
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-600 text-white tracking-widest uppercase">
                Active Link
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Direct emergency beacon to Incident Command & Urban Rescue Teams
            </p>
          </div>
        </div>

        {/* Real Location Status */}
        <div className="flex items-center gap-1.5 text-xs">
          {position ? (
            <div
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-mono text-[11px]"
              data-testid="sos-gps-active"
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>
                GPS: {position.latitude.toFixed(4)}°, {position.longitude.toFixed(4)}°
              </span>
            </div>
          ) : (
            <div
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-[11px]"
              data-testid="sos-gps-unavailable"
            >
              <MapPinOff className="w-3.5 h-3.5" />
              <span>Location Unavailable</span>
              <button
                type="button"
                onClick={refreshGeo}
                className="ml-1 p-0.5 hover:text-foreground"
                title="Acquire GPS Location"
              >
                <RotateCw className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {submittedId ? (
        /* Confirmation State */
        <div
          className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3"
          data-testid="sos-success-state"
        >
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span>EMERGENCY BEACON TRANSMITTED & LOGGED</span>
          </div>

          <div className="text-xs text-muted-foreground space-y-1.5 font-mono">
            <p>
              Beacon Reference:{' '}
              <strong className="text-foreground text-sm">
                #AS-{(submittedId || '').slice(0, 8).toUpperCase()}
              </strong>
            </p>
            <p>Category: <strong className="text-foreground uppercase">{selectedType}</strong></p>
            <p>
              Location:{' '}
              {position
                ? `${position.latitude.toFixed(4)}°N, ${position.longitude.toFixed(4)}°E (GPS verified)`
                : 'No GPS coordinates supplied (unlocalized)'}
            </p>
          </div>

          <div className="p-3 rounded-lg bg-background/60 border border-border text-xs text-muted-foreground">
            <p className="font-semibold text-foreground mb-1">Incident Command Instructions:</p>
            <ul className="list-disc list-inside space-y-0.5 text-[11px]">
              <li>Your emergency signal is now visible to operational responders.</li>
              <li>Stay calm and move to an elevated or secured location if safe to do so.</li>
              <li>Keep your mobile device powered on; do not navigate through rapid flow.</li>
            </ul>
          </div>

          <div className="pt-1 flex items-center justify-end">
            <button
              onClick={handleReset}
              className="px-3.5 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors"
              data-testid="sos-send-another-btn"
            >
              Submit Another Update
            </button>
          </div>
        </div>
      ) : (
        /* Interactive SOS Form */
        <div className="space-y-3">
          {/* Emergency Category Chips */}
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block mb-1.5">
              Select Emergency Type:
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {sosOptions.map((opt) => {
                const Icon = opt.icon;
                const isSelected = selectedType === opt.type;
                return (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => setSelectedType(opt.type)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                      isSelected
                        ? 'border-red-500 bg-red-600 text-white shadow-md shadow-red-950/40 scale-[1.02]'
                        : 'border-border bg-card/60 hover:bg-secondary text-foreground'
                    }`}
                    data-testid={`sos-type-${opt.type.toLowerCase()}`}
                  >
                    <Icon className={`w-5 h-5 mb-1 ${isSelected ? 'text-white' : 'text-primary'}`} />
                    <span className="text-xs font-black tracking-wide">{opt.label}</span>
                    <span
                      className={`text-[10px] mt-0.5 line-clamp-1 ${
                        isSelected ? 'text-white/80' : 'text-muted-foreground'
                      }`}
                    >
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Situation Notes */}
          <div>
            <label
              htmlFor="sos-details"
              className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block mb-1"
            >
              Situation Details (Optional):
            </label>
            <input
              id="sos-details"
              type="text"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="e.g., 3 people on roof, water level rising rapidly..."
              maxLength={200}
              className="w-full px-3 py-2 rounded-xl border border-border bg-card/80 text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-red-500"
              data-testid="sos-details-input"
            />
          </div>

          {error && (
            <div
              className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-500 flex items-center gap-2"
              role="alert"
              data-testid="sos-error-banner"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Transmit Action */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <p className="text-[11px] text-muted-foreground">
              {position
                ? 'Your verified coordinates will be attached to the incident record.'
                : 'Reporting without GPS coordinates. Responders will rely on your profile context.'}
            </p>
            <button
              type="button"
              onClick={handleSendSos}
              disabled={isSubmitting}
              className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-sm tracking-wider uppercase flex items-center justify-center gap-2 shadow-lg shadow-red-950/40 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
              data-testid="send-sos-btn"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Transmitting Beacon...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Transmit Emergency SOS</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default CitizenSOS;
