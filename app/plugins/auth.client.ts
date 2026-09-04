/**
 * Restore the Supabase session before the app renders anything that depends on it.
 *
 * Client-only: the browser client owns token refresh, and constructing it during
 * SSR would open a refresh timer and a realtime socket per request.
 */
export default defineNuxtPlugin(async () => {
  const auth = useAuthStore()
  await auth.init()
})
