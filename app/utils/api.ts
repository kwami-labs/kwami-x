import type { $Fetch } from 'nitropack'

/**
 * A `$fetch` that proves who is calling.
 *
 * Nitro cannot see the browser's Supabase session. Supabase keeps it in local
 * storage — deliberately, since that is what lets it refresh tokens without a
 * round trip — so nothing is sent automatically, and every route behind
 * `requireUser` answers 401 to a plain `$fetch`.
 *
 * A cookie is set on the wallet sign-in path, which is why that flow appeared to
 * work while email, phone, Google and GitHub did not: four of the six sign-in
 * methods could sign in perfectly and then fail at the first thing the account
 * was for. Attaching the bearer token here fixes all six at once, and leaves one
 * place to change rather than a dozen call sites that each have to remember.
 *
 * Only same-origin `/api/` requests get the header. A token is a bearer
 * credential — anything holding it can act as the user — so it must never ride
 * along to a third-party host because a URL happened to be passed in.
 */
export function createApiFetch(getToken: () => string | undefined | null): $Fetch {
  return $fetch.create({
    onRequest({ request, options }) {
      const url = typeof request === 'string' ? request : String(request)
      if (!url.startsWith('/api/')) return

      const token = getToken()
      if (!token) return

      // ofetch normalises `headers` to a `Headers` instance before this hook
      // runs, whatever shape the caller passed.
      //
      // An explicit header wins: a call that already set `authorization` is
      // saying something specific, and silently replacing it would make the
      // interceptor impossible to opt out of.
      if (!options.headers.has('authorization')) {
        options.headers.set('authorization', `Bearer ${token}`)
      }
    },
  })
}
