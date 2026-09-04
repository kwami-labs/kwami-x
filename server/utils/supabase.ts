import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'

/**
 * Two Supabase clients, with very different powers.
 *
 * `serviceClient()` bypasses row level security and is the only thing allowed
 * to read encrypted secrets or write settlement rows. It must never be handed
 * a value that came from a request body without validation.
 *
 * `userClient()` carries the caller's JWT, so every query it runs is filtered
 * by the same RLS policies the browser would hit. Anything that answers "what
 * may *this* user see" should use it, so a policy bug fails closed.
 */

let cachedService: SupabaseClient | null = null

export function serviceClient(): SupabaseClient {
  if (cachedService) return cachedService
  const config = useRuntimeConfig()
  const url = config.public.supabaseUrl as string
  const key = config.supabaseServiceKey
  if (!url || !key) {
    throw createError({ statusCode: 500, statusMessage: 'Supabase service credentials are not configured.' })
  }
  cachedService = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cachedService
}

export function userClient(event: H3Event): SupabaseClient {
  const config = useRuntimeConfig()
  const token = getRequestToken(event)
  return createClient(config.public.supabaseUrl as string, config.public.supabaseAnonKey as string, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  })
}

export function getRequestToken(event: H3Event): string | null {
  const header = getRequestHeader(event, 'authorization')
  if (header?.startsWith('Bearer ')) return header.slice(7)
  // The browser client stores its session in a cookie; SSR calls arrive that way.
  return getCookie(event, 'sb-access-token') ?? null
}

export interface AuthedUser {
  id: string
  email?: string
  walletAddress?: string
}

/** Resolve the caller, or throw 401. */
export async function requireUser(event: H3Event): Promise<AuthedUser> {
  const token = getRequestToken(event)
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Not signed in.' })

  const { data, error } = await serviceClient().auth.getUser(token)
  if (error || !data.user) throw createError({ statusCode: 401, statusMessage: 'Session is not valid.' })

  return {
    id: data.user.id,
    email: data.user.email ?? undefined,
    walletAddress: (data.user.user_metadata?.wallet_address as string | undefined) ?? undefined,
  }
}

/** Resolve the caller if there is one, without failing anonymous requests. */
export async function maybeUser(event: H3Event): Promise<AuthedUser | null> {
  try {
    return await requireUser(event)
  } catch {
    return null
  }
}
