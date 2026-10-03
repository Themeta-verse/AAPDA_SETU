import { describe, it, expect } from 'vitest';
import { isSupabaseConfigured, supabase } from './client';

describe('Supabase Client Configuration Guard', () => {
  it('instantiates the client without throwing unhandled exceptions', () => {
    expect(supabase).toBeDefined();
    expect(typeof supabase.from).toBe('function');
    expect(typeof supabase.auth).toBe('object');
  });

  it('exports a boolean flag indicating whether Supabase is configured', () => {
    expect(typeof isSupabaseConfigured).toBe('boolean');
  });
});
