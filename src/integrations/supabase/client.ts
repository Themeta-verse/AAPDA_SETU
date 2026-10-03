import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const rawKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured: boolean = Boolean(
  rawUrl &&
  rawKey &&
  typeof rawUrl === 'string' &&
  typeof rawKey === 'string' &&
  rawUrl.trim() !== '' &&
  rawKey.trim() !== '' &&
  !rawUrl.includes('your-project')
);

// Safe fallback credentials only prevent top-level module load crashes (`Uncaught Error: supabaseUrl is required.`)
// when environment variables are not yet injected into the bundle. They do NOT mock data.
const safeUrl = isSupabaseConfigured ? rawUrl : 'https://unconfigured.supabase.co';
const safeKey = isSupabaseConfigured ? rawKey : 'unconfigured-publishable-key';

export const supabase = createClient<Database>(safeUrl, safeKey, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: isSupabaseConfigured,
  },
});