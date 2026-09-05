import { createApiFetch } from '~/utils/api'

/**
 * The app's HTTP client for routes that need a signed-in caller.
 *
 * Use this rather than bare `$fetch` for anything under `/api/` that is not
 * public — see `createApiFetch` for why a plain call cannot authenticate.
 * Public reads (`/api/kwami`, `/api/docs`) can keep using `useFetch`, which
 * also runs during SSR where there is no session to attach.
 *
 * The token is read at request time, not at construction, so an instance
 * created in `setup` keeps working across a sign-in, a sign-out and every
 * silent refresh in between.
 */
export function useApi() {
  const auth = useAuthStore()
  return createApiFetch(() => auth.session?.access_token)
}
