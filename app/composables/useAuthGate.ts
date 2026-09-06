import { isSupabasePublicConfigured } from '#shared/config/supabase'

/**
 * Who has to sign in, and where.
 *
 * The gate is an overlay rather than a redirect. A redirect throws away the
 * page someone arrived at — a shared link to a specific Kwami becomes a sign-in
 * screen and then the homepage — and it hides the product behind a form before
 * anyone has seen why they would fill it in. The overlay lets the arena render
 * and load underneath, so the Kwamis are the first thing on screen and the
 * panel is visibly standing between the visitor and them.
 *
 * Some routes are never gated. `/docs` is documentation, `/embed` renders on
 * other people's sites where a sign-in modal would be an intrusion into a page
 * that is not ours, and `/auth/callback` is the step that produces the session
 * the gate is waiting for — gating it would deadlock.
 */
const OPEN_PREFIXES = ['/auth', '/docs', '/embed', '/onramp/done']

/**
 * Where the panel can be dismissed and the page read anyway.
 *
 * These are the pages that only *show* things. Someone who followed a link to a
 * specific Kwami should be able to see the pot, the game and the ledger before
 * being asked for an account — that page is the pitch, and a sign-in wall in
 * front of it turns every shared link into a dead end. The panel still opens
 * first, because signing in is what the visitor is meant to do next; it simply
 * is not a locked door.
 *
 * Everything else — playing, minting, managing — moves money or writes state,
 * and has nothing to show a visitor who cannot do either.
 */
const BROWSABLE_PREFIXES = ['/kwami', '/leaderboard']

export function useAuthGate() {
  const auth = useAuthStore()
  const route = useRoute()
  const config = useRuntimeConfig()

  /**
   * Whether signing in is even possible.
   *
   * With no Supabase project configured the app runs in demo mode, where every
   * sign-in method fails by design. Gating then would be a locked door with no
   * key — so a fresh clone is left open and simply explorable.
   *
   * Uses the same project-id + publishable-key check as the server, not a
   * non-empty string test. Those disagreed at first, and the result was the
   * worst of both: `cp .env.example .env` gave you demo Kwamis behind a
   * sign-in wall that could never open.
   */
  const configured = computed(() => isSupabasePublicConfigured(config))

  const exempt = computed(() => OPEN_PREFIXES.some((p) => route.path === p || route.path.startsWith(`${p}/`)))

  /** Someone who dismissed the panel gets to keep looking around this session. */
  const dismissed = useState('auth-gate-dismissed', () => false)

  const open = computed(
    () => configured.value && auth.ready && !auth.isSignedIn && !exempt.value && !dismissed.value,
  )

  const dismissible = computed(
    () =>
      route.path === '/' ||
      BROWSABLE_PREFIXES.some((p) => route.path === p || route.path.startsWith(`${p}/`)),
  )

  function dismiss() {
    dismissed.value = true
  }

  /** Re-open the panel — what "Sign in" in the header does. */
  function prompt() {
    dismissed.value = false
  }

  return { open, dismissible, dismiss, prompt, configured }
}
