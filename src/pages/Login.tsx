import { useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Mail, Lock, User, Phone, MapPin, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useToast } from '@/hooks/use-toast';

export default function Login() {
  const [isSignUp, setIsSignUp] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { signUp, signIn } = useAuth();
  const { requestLocation, permissionGranted, loading: geoLoading } = useGeolocation();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (isSignUp) {
        await signUp(email, password, name, phone || undefined);
        toast({ title: '✅ Account created!', description: 'Welcome to BayWatch.' });
      } else {
        await signIn(email, password);
        toast({ title: '✅ Welcome back!', description: 'Logged in successfully.' });
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'Something went wrong',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background waves */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/8 via-ocean/5 to-transparent" />
        <svg className="absolute bottom-0 left-0 w-[200%] h-40 ocean-wave-1 opacity-[0.07]" viewBox="0 0 1440 120" preserveAspectRatio="none">
          <path d="M0,40 C360,100 720,0 1080,60 C1260,90 1380,30 1440,50 L1440,120 L0,120Z" fill="hsl(var(--primary))" />
        </svg>
        <svg className="absolute bottom-0 left-0 w-[200%] h-32 ocean-wave-2 opacity-[0.05]" viewBox="0 0 1440 120" preserveAspectRatio="none">
          <path d="M0,80 C240,20 480,100 720,50 C960,0 1200,80 1440,40 L1440,120 L0,120Z" fill="hsl(var(--ocean-light))" />
        </svg>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <Shield className="w-10 h-10 text-primary" />
            <h1 className="text-4xl font-black tracking-tight text-foreground">BAYWATCH</h1>
          </div>
          <p className="text-primary font-semibold">Juhu Coastal Disaster Alert System</p>
          <p className="text-muted-foreground text-sm mt-1">
            {isSignUp ? 'Create your account to access the dashboard' : 'Sign in to your account'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="glass-card rounded-2xl p-6 sm:p-8 border-primary/20 space-y-4">
          {isSignUp && (
            <>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="Enter your name"
                    className="w-full bg-secondary rounded-xl pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Phone (Optional)</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 XXXXXXXXXX"
                    className="w-full bg-secondary rounded-xl pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full bg-secondary rounded-xl pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Min 6 characters"
                className="w-full bg-secondary rounded-xl pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {/* Location permission */}
          {isSignUp && (
            <div className="p-3 rounded-xl border border-primary/20 bg-primary/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">Allow Location Access</span>
                </div>
                <button
                  type="button"
                  onClick={requestLocation}
                  disabled={permissionGranted || geoLoading}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    permissionGranted
                      ? 'bg-safe/20 text-safe'
                      : 'bg-primary/20 text-primary hover:bg-primary/30'
                  }`}
                >
                  {geoLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : permissionGranted ? '✓ Granted' : 'Enable'}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Required for GPS tracking & distance calculations
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isSignUp ? 'Create Account & Enter Dashboard' : 'Sign In'}
          </button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        </form>

        {/* Emergency notice */}
        <div className="mt-4 p-3 rounded-xl border border-warning/30 bg-warning/5 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">
            In case of immediate emergency, call <strong className="text-warning">112</strong> or <strong className="text-warning">108</strong>. Do not wait for app login.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
