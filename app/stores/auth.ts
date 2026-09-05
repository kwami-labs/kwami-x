import { defineStore } from 'pinia'
import type { Session, User } from '@supabase/supabase-js'
import bs58 from 'bs58'

export type AuthProvider = 'email' | 'phone' | 'google' | 'github' | 'phantom' | 'metamask'

/**
 * Session state across every sign-in method Kwami supports.
 *
 * Email, phone, Google and GitHub are ordinary Supabase flows. Phantom and
 * MetaMask are not: Supabase has no wallet provider, so those go out to
 * `/api/auth/*`, which verifies the signature and hands back a real Supabase
 * session. The important part is that all six converge on the *same*
 * `auth.users` row shape, so nothing downstream has to care which door someone
 * came through.
 */
export const useAuthStore = defineStore('auth', () => {
  const supabase = useSupabase()
  const wallet = useWalletStore()

  const user = ref<User | null>(null)
  const session = ref<Session | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isSignedIn = computed(() => user.value !== null)
  const displayName = computed(() => {
    const meta = user.value?.user_metadata
    return (meta?.display_name as string) ?? (meta?.full_name as string) ?? user.value?.email ?? null
  })
  /** The Solana address this account can actually be paid at. */
  const payoutAddress = computed(() => {
    const meta = user.value?.user_metadata
    if (meta?.wallet_chain === 'solana') return meta.wallet_address as string
    return wallet.address
  })

  async function init() {
    const { data } = await supabase.auth.getSession()
    session.value = data.session
    user.value = data.session?.user ?? null

    supabase.auth.onAuthStateChange((_event, next) => {
      session.value = next
      user.value = next?.user ?? null
    })
  }

  /** Record an error and abort. Returns `never`, so callers narrow correctly after it. */
  function fail(message: string): never {
    error.value = message
    loading.value = false
    throw new Error(message)
  }

  async function signInWithEmail(email: string, password: string) {
    loading.value = true
    error.value = null
    const { data, error: e } = await supabase.auth.signInWithPassword({ email, password })
    if (e) fail(e.message)
    session.value = data.session
    user.value = data.user
    loading.value = false
  }

  async function signUpWithEmail(email: string, password: string) {
    loading.value = true
    error.value = null
    const { error: e } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (e) fail(e.message)
    loading.value = false
  }

  /** Phone sign-in is two steps: request a code, then verify it. */
  async function signInWithPhone(phone: string) {
    loading.value = true
    error.value = null
    const { error: e } = await supabase.auth.signInWithOtp({ phone })
    if (e) fail(e.message)
    loading.value = false
  }

  async function verifyPhone(phone: string, token: string) {
    loading.value = true
    error.value = null
    const { data, error: e } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' })
    if (e) fail(e.message)
    session.value = data.session
    user.value = data.user
    loading.value = false
  }

  async function signInWithOAuth(provider: 'google' | 'github') {
    error.value = null
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (e) fail(e.message)
  }

  /**
   * Sign in with Phantom.
   *
   * One wallet prompt: Phantom's SIWS flow connects and authenticates at once.
   * The signature goes to the server, which verifies it and returns a Supabase
   * session, so from here on the user is indistinguishable from an email one.
   */
  async function signInWithPhantom() {
    loading.value = true
    error.value = null
    try {
      const { nonce } = await $fetch<{ nonce: string }>('/api/auth/nonce', { method: 'POST', body: {} })
      const signed = await wallet.signIn(nonce)

      const result = await $fetch<{ session: { access_token: string; refresh_token: string } }>(
        '/api/auth/verify-solana',
        {
          method: 'POST',
          body: {
            message: signed.message,
            signature: bs58.encode(signed.signature),
            address: signed.address,
          },
        },
      )

      // Hand the tokens to the browser client so it owns refresh from here.
      const { data, error: e } = await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      })
      if (e) fail(e.message)
      session.value = data.session
      user.value = data.user
    } catch (e) {
      error.value = (e as Error).message
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Sign in with MetaMask.
   *
   * Identity only — an Ethereum account can hold no Kwami and receive no
   * payout. The UI prompts for a Solana wallet at the point money is needed.
   */
  async function signInWithMetaMask() {
    loading.value = true
    error.value = null
    try {
      const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum
      if (!eth) fail('MetaMask is not installed.')

      const accounts = (await eth!.request({ method: 'eth_requestAccounts' })) as string[]
      const address = accounts[0]
      if (!address) return fail('MetaMask returned no account.')

      const { nonce } = await $fetch<{ nonce: string }>('/api/auth/nonce', {
        method: 'POST',
        body: {},
      })

      const { formatSiweMessage, SIWE_STATEMENT } = await import('#shared/auth/siwe')
      const message = formatSiweMessage({
        domain: window.location.host,
        address,
        statement: SIWE_STATEMENT,
        uri: window.location.origin,
        version: '1',
        chainId: 1,
        nonce,
        issuedAt: new Date().toISOString(),
      })

      const signature = (await eth!.request({
        method: 'personal_sign',
        params: [message, address],
      })) as string

      const result = await $fetch<{ session: { access_token: string; refresh_token: string } }>(
        '/api/auth/verify-ethereum',
        { method: 'POST', body: { message, signature, address } },
      )

      const { data, error: e } = await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      })
      if (e) fail(e.message)
      session.value = data.session
      user.value = data.user
    } catch (e) {
      error.value = (e as Error).message
      throw e
    } finally {
      loading.value = false
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    user.value = null
    session.value = null
  }

  return {
    user,
    session,
    loading,
    error,
    isSignedIn,
    displayName,
    payoutAddress,
    init,
    signInWithEmail,
    signUpWithEmail,
    signInWithPhone,
    verifyPhone,
    signInWithOAuth,
    signInWithPhantom,
    signInWithMetaMask,
    signOut,
  }
})
