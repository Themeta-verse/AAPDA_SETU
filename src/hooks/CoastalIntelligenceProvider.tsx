import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  useCoastalIntelligence,
  type CoastalIntelligenceState,
  type OfficialWarningSupabaseClient,
} from './useCoastalIntelligence';
import { supabase } from '@/integrations/supabase/client';

/**
 * ONE canonical intelligence pipeline for the whole application.
 *
 * ===================================================================
 * THE PROBLEM THIS SOLVES
 * ===================================================================
 *
 * `useCoastalIntelligence` is a polling hook. Calling it from two components
 * gives you two independent pipelines, each with its own timers, its own fetch
 * and its own copy of the world.
 *
 * That is exactly what was happening, and it was measurable in the network log:
 * every page load issued THREE identical requests to the USGS earthquake feed
 * and three separate marine/weather pairs, because:
 *
 *   useMonitoring()            -> useEarthquakeData() + useCoastalIntelligence()
 *   CoastalCommandCenter       -> useCoastalIntelligence()
 *
 * Three consumers of "the truth" means three chances for them to disagree, and
 * they did: the command center and the monitoring dashboard could display
 * different risk states from the same instant, and every one of them hammered
 * the public endpoints independently.
 *
 * ===================================================================
 * THE FIX
 * ===================================================================
 *
 * A provider owns the single hook instance and hands the same state object to
 * every consumer. There is exactly one fetch schedule, one single-flight guard,
 * one event log and one risk verdict per page.
 *
 * `useCoastalIntelligence` stays a plain hook so it remains directly testable;
 * this module is the application-level binding, not a rewrite of it.
 */

const CoastalIntelligenceContext = createContext<CoastalIntelligenceState | null>(null);

export interface CoastalIntelligenceProviderProps {
  children: ReactNode;
  /**
   * Overridable for tests. Production passes the shared Supabase client so
   * official warnings are retrieved through the JWT-gated Edge Function.
   */
  client?: OfficialWarningSupabaseClient;
  /** Disable browser notification prompts (tests). */
  enableBrowserNotifications?: boolean;
  /** Fixed clock (tests). */
  now?: () => Date;
}

export function CoastalIntelligenceProvider({
  children,
  client = supabase,
  enableBrowserNotifications,
  now,
}: CoastalIntelligenceProviderProps) {
  const state = useCoastalIntelligence({
    supabase: client,
    enableBrowserNotifications,
    now,
  });

  // The hook already memoises its slices; this keeps the context value stable so
  // consumers do not re-render on every parent render.
  const value = useMemo(() => state, [state]);

  return (
    <CoastalIntelligenceContext.Provider value={value}>
      {children}
    </CoastalIntelligenceContext.Provider>
  );
}

/**
 * Read the single shared intelligence state.
 *
 * Throws when used outside the provider rather than silently constructing a
 * second pipeline, because a silent second pipeline is precisely the bug this
 * provider exists to eliminate.
 */
export function useSharedCoastalIntelligence(): CoastalIntelligenceState {
  const state = useContext(CoastalIntelligenceContext);
  if (!state) {
    throw new Error(
      'useSharedCoastalIntelligence must be used inside a <CoastalIntelligenceProvider>. ' +
        'Calling useCoastalIntelligence() directly from a component would start a second, ' +
        'independent polling pipeline.',
    );
  }
  return state;
}

/** Non-throwing variant, for components that can degrade gracefully. */
export function useOptionalSharedCoastalIntelligence(): CoastalIntelligenceState | null {
  return useContext(CoastalIntelligenceContext);
}
