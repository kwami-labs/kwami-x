import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveSupabaseUrl } from '#shared/config/supabase'

let client: SupabaseClient | null = null

/**
 * The browser Supabase client.
 *
 * Uses the publishable key only — never the secret key. Created lazily and
 * cached at module scope rather than provided by a Nuxt plugin: the client
 * opens a token-refresh timer and a realtime socket on construction, and a
 * per-request instance during SSR would leak both.
 */
export function useSupabase(): SupabaseClient {
  if (client) return client
  const config = useRuntimeConfig()
  const url = resolveSupabaseUrl(config)
  const key = config.public.supabasePublishableKey as string
  client = createClient(url, key, {
    auth: {
      persistSession: import.meta.client,
      autoRefreshToken: import.meta.client,
      detectSessionInUrl: import.meta.client,
      flowType: 'pkce',
    },
  })
  return client
}
