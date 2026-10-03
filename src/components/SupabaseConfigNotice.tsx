import React from 'react';
import { AlertTriangle, Database, ExternalLink, RefreshCw } from 'lucide-react';

export function SupabaseConfigNotice() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="max-w-xl w-full bg-slate-900 border border-amber-500/30 rounded-xl shadow-2xl p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              Supabase Configuration Required
            </h1>
            <p className="text-sm text-slate-400">
              AAPDA SETU frontend deployment check
            </p>
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4 text-sm text-slate-300 space-y-3">
          <p>
            The application mounted successfully, but live Supabase credentials were not detected in this build environment.
          </p>
          <p className="text-xs text-slate-400">
            Because Vite bakes <code className="text-amber-300 font-mono">VITE_*</code> environment variables at build time, these variables must be present during the Vercel build phase.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" /> Required Environment Variables
          </h2>
          <div className="bg-slate-950 rounded-lg border border-slate-800 p-3 space-y-2 font-mono text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-800/80 pb-2">
              <span className="text-amber-300 font-semibold">VITE_SUPABASE_URL</span>
              <span className="text-slate-400 text-[11px]">https://&lt;project&gt;.supabase.co</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pt-1">
              <span className="text-amber-300 font-semibold">VITE_SUPABASE_PUBLISHABLE_KEY</span>
              <span className="text-slate-400 text-[11px]">sb_publishable_... or anon key</span>
            </div>
          </div>
        </div>

        <div className="space-y-2 text-xs text-slate-400 bg-slate-950/40 p-4 rounded-lg border border-slate-800/60">
          <h3 className="font-semibold text-slate-300">How to fix this on Vercel:</h3>
          <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
            <li>Go to your project dashboard on Vercel: <strong>Settings &gt; Environment Variables</strong>.</li>
            <li>Add <code className="text-amber-300 font-mono">VITE_SUPABASE_URL</code> and <code className="text-amber-300 font-mono">VITE_SUPABASE_PUBLISHABLE_KEY</code>.</li>
            <li>Ensure all target environments (<strong>Production</strong>, <strong>Preview</strong>, <strong>Development</strong>) are checked.</li>
            <li>Ensure there are <strong>no duplicate rows</strong> or empty rows in the table.</li>
            <li>Go to <strong>Deployments &gt; Redeploy</strong> (without build cache) to compile the variables into the bundle.</li>
          </ol>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-800">
          <a
            href="https://vercel.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs transition-colors"
          >
            Open Vercel Dashboard <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button
            onClick={() => window.location.reload()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh Application
          </button>
        </div>
      </div>
    </div>
  );
}
