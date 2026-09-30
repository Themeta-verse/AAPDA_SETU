import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Send, AlertTriangle, Waves, Construction, Loader2, CheckCircle, FileWarning, Plus } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import { supabase } from '@/integrations/supabase/client';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useToast } from '@/hooks/use-toast';

interface CitizenReportingProps {
  language: Language;
  userId?: string;
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

const incidentTypes = [
  { id: 'flooding' as const, icon: Waves, color: 'text-primary' },
  { id: 'high_waves' as const, icon: Waves, color: 'text-warning' },
  { id: 'blocked_roads' as const, icon: Construction, color: 'text-danger' },
  { id: 'other' as const, icon: FileWarning, color: 'text-muted-foreground' },
];

export function CitizenReporting({ language, userId }: CitizenReportingProps) {
  const rl = reportLabels[language];
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<string>('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { position } = useGeolocation();
  const { toast } = useToast();

  const typeLabels: Record<string, string> = {
    flooding: rl.flooding, high_waves: rl.highWaves, blocked_roads: rl.blockedRoads, other: rl.other,
  };

  const handleSubmit = async () => {
    if (!type || !description.trim() || !userId) return;
    setSubmitting(true);

    try {
      let photoUrl: string | null = null;

      if (photo) {
        const ext = photo.name.split('.').pop();
        const path = `${userId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('incident-photos')
          .upload(path, photo);
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from('incident-photos').getPublicUrl(path);
          photoUrl = urlData.publicUrl;
        }
      }

      const { error } = await supabase.from('incident_reports').insert({
        user_id: userId,
        type: type as any,
        description: description.trim(),
        photo_url: photoUrl,
        latitude: position?.latitude ?? null,
        longitude: position?.longitude ?? null,
      });

      if (error) throw error;

      setSubmitted(true);
      toast({ title: '✅', description: rl.success });
      setTimeout(() => {
        setShowForm(false);
        setSubmitted(false);
        setType('');
        setDescription('');
        setPhoto(null);
      }, 2000);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
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

                  {/* Submit */}
                  <div className="flex gap-3">
                    <button
                      onClick={handleSubmit}
                      disabled={!type || !description.trim() || submitting}
                      className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {rl.submit}
                    </button>
                    <button
                      onClick={() => setShowForm(false)}
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
      </motion.div>
    </section>
  );
}
