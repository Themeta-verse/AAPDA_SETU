import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Send, AlertTriangle, Waves, Construction, Loader2, CheckCircle, FileWarning, Plus, Clock, Upload, WifiOff } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import { supabase } from '@/integrations/supabase/client';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useToast } from '@/hooks/use-toast';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useOfflineIncidentQueue } from '@/hooks/useOfflineIncidentQueue';
import {
  isIncidentType,
  submitIncident,
  listIncidents,
  type Incident,
  type IncidentClientLike,
  type IncidentType,
} from '@/integrations/supabase/incidents';

interface CitizenReportingProps {
  language: Language;
  userId?: string;
  /** Injectable for tests. */
  client?: IncidentClientLike;
}

const reportLabels: Record<Language, {
  title: string; desc: string; flooding: string; highWaves: string; blockedRoads: string; other: string;
  description: string; addPhoto: string; submit: string; success: string; selectType: string;
  recentReports: string; noReports: string;
}> = {
  en: {
    title: 'Citizen Incident Reporting', desc: 'Report hazards to help the community stay safe',
    flooding: 'Flooding', highWaves: 'High Waves', blockedRoads: 'Blocked Roads', other: 'Other',
    description: 'Describe the incident...', addPhoto: 'Add Photo', submit: 'Submit Report',
    success: 'Report submitted successfully!', selectType: 'Select incident type',
    recentReports: 'Recent Reports', noReports: 'No reports yet',
  },
  hi: {
    title: 'नागरिक घटना रिपोर्टिंग', desc: 'समुदाय को सुरक्षित रखने में मदद करें',
    flooding: 'बाढ़', highWaves: 'ऊंची लहरें', blockedRoads: 'अवरुद्ध सड़कें', other: 'अन्य',
    description: 'घटना का वर्णन करें...', addPhoto: 'फोटो जोड़ें', submit: 'रिपोर्ट भेजें',
    success: 'रिपोर्ट सफलतापूर्वक भेजी गई!', selectType: 'घटना प्रकार चुनें',
    recentReports: 'हाल की रिपोर्ट', noReports: 'अभी तक कोई रिपोर्ट नहीं',
  },
  mr: {
    title: 'नागरिक घटना अहवाल', desc: 'समुदायाला सुरक्षित ठेवण्यात मदत करा',
    flooding: 'पूर', highWaves: 'उंच लाटा', blockedRoads: 'अवरोधित रस्ते', other: 'इतर',
    description: 'घटनेचे वर्णन करा...', addPhoto: 'फोटो जोडा', submit: 'अहवाल पाठवा',
    success: 'अहवाल यशस्वीपणे पाठवला!', selectType: 'घटना प्रकार निवडा',
    recentReports: 'अलीकडील अहवाल', noReports: 'अजून कोणतेही अहवाल नाहीत',
  },
  gu: {
    title: 'નાગરિક ઘટના અહેવાલ', desc: 'સમુદાયને સુરક્ષિત રાખવામાં મદદ કરો',
    flooding: 'પૂર', highWaves: 'ઊંચા મોજા', blockedRoads: 'અવરોધિત રસ્તા', other: 'અન્ય',
    description: 'ઘટનાનું વર્ણન કરો...', addPhoto: 'ફોટો ઉમેરો', submit: 'અહેવાલ મોકલો',
    success: 'અહેવાલ સફળતાપૂર્વક મોકલાયો!', selectType: 'ઘટના પ્રકાર પસંદ કરો',
    recentReports: 'તાજેતરના અહેવાલ', noReports: 'હજુ સુધી કોઈ અહેવાલ નથી',
  },
};

const incidentTypes: { id: IncidentType; icon: typeof Waves; color: string }[] = [
  { id: 'flooding', icon: Waves, color: 'text-primary' },
  { id: 'high_waves', icon: Waves, color: 'text-warning' },
  { id: 'blocked_roads', icon: Construction, color: 'text-danger' },
  { id: 'other', icon: FileWarning, color: 'text-muted-foreground' },
];

export function CitizenReporting({ language, userId, client }: CitizenReportingProps) {
  const rl = reportLabels[language];
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<IncidentType | ''>('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { position } = useGeolocation();
  const { isOnline, status: connectionStatus } = useNetworkStatus();
  const { queueNewIncident, stats } = useOfflineIncidentQueue();
  const { toast } = useToast();
  const [myReports, setMyReports] = useState<Incident[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);

  const fetchMyReports = useCallback(async () => {
    if (!userId) return;
    setLoadingReports(true);
    try {
      const activeClient = client ?? (supabase as unknown as IncidentClientLike);
      const res = await listIncidents({ client: activeClient });
      if (res.ok) {
        setMyReports(res.data);
      }
    } catch {
      // Graceful offline fallback
    } finally {
      setLoadingReports(false);
    }
  }, [userId, client]);

  useEffect(() => {
    fetchMyReports();
  }, [fetchMyReports]);

const typeLabels: Record<string, string> = {
    flooding: rl.flooding, high_waves: rl.highWaves, blocked_roads: rl.blockedRoads, other: rl.other,
  };

  const resetForm = () => {
    setShowForm(false);
    setSubmitted(false);
    setType('');
    setDescription('');
    setPhoto(null);
    setFormError(null);
  };

  const getConnectionLabel = () => {
    if (!isOnline) return { label: 'OFFLINE', icon: WifiOff, color: 'text-muted-foreground', bg: 'bg-muted/20 border-muted/30' };
    if (connectionStatus === 'reconnecting') return { label: 'RECONNECTING...', icon: Upload, color: 'text-warning', bg: 'bg-warning/10 border-warning/30' };
    return { label: 'ONLINE', icon: Upload, color: 'text-safe', bg: 'bg-safe/10 border-safe/30' };
  };

  const connectionInfo = getConnectionLabel();
  const ConnectionIcon = connectionInfo.icon;

  const handleSubmit = async () => {
    // Guard the invariants the database also enforces, so an invalid value is
    // never sent and never reported as a success.
    if (!userId || !isIncidentType(type) || !description.trim()) return;

    setSubmitting(true);
    setFormError(null);

const activeClient = client ?? (supabase as unknown as IncidentClientLike);

    try {
      if (isOnline) {
        const result = await submitIncident(
          { client: activeClient },
          {
            reporterId: userId,
            type,
            description: description.trim(),
            latitude: position?.latitude ?? null,
            longitude: position?.longitude ?? null,
            photo,
          }
        );

        if (!result.ok) {
          // Show the database's own message. Never a generic "something went wrong".
          const message = result.error?.message ?? 'The report could not be submitted.';
          setFormError(message);
          toast({ variant: 'destructive', title: 'Error', description: message });
          return;
        }

        // Success means the INSERT resolved. A photo failure is reported
        // separately rather than being presented as a fully successful report.
        if (result.photoWarning) {
          toast({ variant: 'destructive', title: 'Error', description: result.photoWarning });
          setFormError(result.photoWarning);
          return;
        }

        setSubmitted(true);
        toast({ title: '✅', description: rl.success });
        setTimeout(resetForm, 2000);
      } else {
        await queueNewIncident(
          type as 'flooding' | 'high_waves' | 'blocked_roads' | 'other',
          description,
          photo,
          position?.latitude ?? null,
          position?.longitude ?? null
        );
        setSubmitted(true);
        toast({ title: '📦', description: 'Incident saved offline. Will upload when connection is restored.' });
        setTimeout(() => {
          setShowForm(false);
          setSubmitted(false);
          setType('');
          setDescription('');
          setPhoto(null);
        }, 2000);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      toast({ variant: 'destructive', title: 'Error', description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="container py-8" aria-label={rl.title}>
      <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-warning" />
          {rl.title}
        </h2>
        <p className="text-muted-foreground mb-6 text-sm">{rl.desc}</p>

        {/* Connection Status & Offline Queue Indicator */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium ${connectionInfo.bg}`}>
            <ConnectionIcon className={`w-4 h-4 ${connectionInfo.color}`} />
            <span className={`${connectionInfo.color} font-medium`}>{connectionInfo.label}</span>
          </div>
          {(stats.queued > 0 || stats.syncing > 0 || stats.failed > 0) && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm font-medium">
              <Clock className="w-4 h-4" />
              <span>Queued: {stats.queued + stats.syncing + stats.failed}</span>
              {stats.syncing > 0 && <span className="px-1.5 py-0.5 text-[10px] bg-warning/20 text-warning rounded">Syncing: {stats.syncing}</span>}
              {stats.failed > 0 && <span className="px-1.5 py-0.5 text-[10px] bg-danger/20 text-danger rounded">Failed: {stats.failed}</span>}
            </div>
          )}
        </div>

        {!showForm ? (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowForm(true)}
            className="flex items-center gap-3 px-6 py-4 rounded-xl bg-warning/10 border border-warning/30 text-warning font-semibold hover:bg-warning/20 transition-colors"
          >
            <Plus className="w-5 h-5" />
            {rl.title}
          </motion.button>
        ) : (
          <div className="glass-card rounded-2xl p-5 sm:p-6 border-warning/20">
            <AnimatePresence mode="wait">
              {submitted ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-8"
                >
                  <CheckCircle className="w-12 h-12 text-safe mx-auto mb-3" />
                  <p className="text-safe font-semibold">{rl.success}</p>
                </motion.div>
              ) : (
                <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                  {/* Type selector */}
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">{rl.selectType}</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {incidentTypes.map((it) => (
                        <button
                          key={it.id}
                          onClick={() => setType(it.id)}
                          className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all ${
                            type === it.id
                              ? 'border-primary bg-primary/10 ring-2 ring-primary ring-offset-2 ring-offset-background'
                              : 'border-border hover:border-primary/30'
                          }`}
                        >
                          <it.icon className={`w-4 h-4 ${it.color}`} />
                          {typeLabels[it.id]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={rl.description}
                      rows={3}
                      className="w-full bg-secondary rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                    />
                  </div>

                  {/* Photo upload */}
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-secondary hover:bg-secondary/80 cursor-pointer transition-colors">
                      <Camera className="w-4 h-4 text-primary" />
                      <span className="text-sm">{rl.addPhoto}</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => setPhoto(e.target.files?.[0] || null)}
                      />
                    </label>
                    {photo && <span className="text-xs text-muted-foreground">{photo.name}</span>}
                  </div>

                  {/* Surface the real failure reason inline, not just in a toast. */}
                  {formError && (
                    <p
                      className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2"
                      role="alert"
                      data-testid="citizen-report-error"
                    >
                      {formError}
                    </p>
                  )}

                  {/* Submit */}
                  <div className="flex gap-3">
                    <button
                      onClick={handleSubmit}
                      disabled={!userId || !type || !description.trim() || submitting}
                      className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {rl.submit}
                    </button>
                    <button
                      onClick={resetForm}
                      className="px-4 py-3 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        {/* Citizen's Own Submitted Reports & Lifecycle Tracking */}
        {userId && myReports.length > 0 && (
          <div className="mt-8 border-t border-border pt-6" data-testid="citizen-my-reports">
            <h3 className="text-lg font-bold text-foreground mb-1 flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Your Reported Hazards ({myReports.length})
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Track the verification and dispatch lifecycle of hazards you reported.
            </p>
            <div className="space-y-3">
              {myReports.map((report) => {
                const status = report.status ?? 'unverified';
                const typeName = report.type ? typeLabels[report.type] : report.rawType || 'Hazard';
                return (
                  <div
                    key={report.id}
                    className="p-4 rounded-xl border border-border bg-card/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    data-testid="citizen-report-item"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground">{typeName}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          Ref: #{report.id.slice(0, 8)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {report.description || 'No description provided'}
                      </p>
                      {report.createdAt && (
                        <p className="text-[11px] text-muted-foreground/80">
                          Reported: {new Date(report.createdAt).toLocaleString()}
                        </p>
                      )}
                      {report.rejectionReason && (
                        <p className="text-xs text-destructive mt-1">
                          Notice: {report.rejectionReason}
                        </p>
                      )}
                    </div>
                    <div>
                      <span
                        className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider border ${
                          status === 'verified'
                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30'
                            : status === 'dispatched'
                            ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30'
                            : status === 'resolved'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                            : status === 'rejected'
                            ? 'bg-destructive/10 text-destructive border-destructive/30'
                            : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30'
                        }`}
                        data-testid={`citizen-report-status-${status}`}
                      >
                        {status === 'unverified' ? 'PENDING REVIEW' : status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </motion.div>
    </section>
  );
}
