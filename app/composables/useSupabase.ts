import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

/**
 * The browser Supabase client.
 *
 * Created lazily and cached at module scope rather than provided by a Nuxt
 * plugin: the client opens a token-refresh timer and a realtime socket on
 * construction, and a per-request instance during SSR would leak both.
 */
export function useSupabase(): SupabaseClient {
  if (client) return client
  const config = useRuntimeConfig()
  client = createClient(config.public.supabaseUrl as string, config.public.supabaseAnonKey as string, {
    auth: {
      persistSession: import.meta.client,
      autoRefreshToken: import.meta.client,
      detectSessionInUrl: import.meta.client,
      flowType: 'pkce',
    },
  })
  return client
}
