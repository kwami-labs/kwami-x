import { isConfigured } from './configured'

/**
 * Resolve the Supabase API base URL.
 *
 * Hosted projects are identified by project id (`svxh…`); the URL is derived.
 * Local `supabase start` still needs an explicit URL (`http://127.0.0.1:54321`),
 * which wins when set so a fresh clone can point at either without two mental
 * models for "where is the API".
 */
export function resolveSupabaseUrl(config: {
  public: { supabaseUrl?: unknown; supabaseProjectId?: unknown }
}): string {
  const url = config.public.supabaseUrl
  if (isConfigured(url)) return String(url).replace(/\/$/, '')

  const projectId = config.public.supabaseProjectId
  if (isConfigured(projectId)) return `https://${String(projectId)}.supabase.co`

  return ''
}

/** Browser / user-scoped clients: project reachable + publishable key present. */
export function isSupabasePublicConfigured(config: {
  public: {
    supabaseUrl?: unknown
    supabaseProjectId?: unknown
    supabasePublishableKey?: unknown
  }
}): boolean {
  return isConfigured(resolveSupabaseUrl(config)) && isConfigured(config.public.supabasePublishableKey)
}

/**
 * Server privileged client: API reachable + secret key present.
 * The secret must never be nested under `runtimeConfig.public`.
 */
export function isSupabaseServerConfigured(config: {
  public: { supabaseUrl?: unknown; supabaseProjectId?: unknown }
  supabaseSecretKey?: unknown
}): boolean {
  return isConfigured(resolveSupabaseUrl(config)) && isConfigured(config.supabaseSecretKey)
}
