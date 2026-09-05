import { defineStore } from 'pinia'
import type { Session, User } from '@supabase/supabase-js'
import bs58 from 'bs58'
import { createApiFetch } from '~/utils/api'

export interface BoundWallet {
  chain: 'solana' | 'ethereum'
  address: string
  isPrimary: boolean
}

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
  /**
   * Whether the stored session has been read back yet.
   *
   * The sign-in gate keys off this rather than off `isSignedIn` alone: a
   * returning user's session lives in local storage, which is unreadable during
   * SSR and for the first tick after hydration. Gating on "not signed in" alone
   * would flash the sign-in modal in the face of someone who is already signed
   * in, on every single page load.
   */
  const ready = ref(false)

  /** Solana addresses already proven to the server, so a reconnect does not re-prompt. */
  const boundAddresses = ref<string[]>([])

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
    try {
      const { data } = await supabase.auth.getSession()
      session.value = data.session
      user.value = data.session?.user ?? null

      supabase.auth.onAuthStateChange((_event, next) => {
        session.value = next
        user.value = next?.user ?? null
        if (next?.user) void loadWallets()
      })
    } finally {
      // Even a failed read is a finished one. Leaving `ready` false on error
      // would hang the gate on a spinner with no way past it.
      ready.value = true
    }
    if (user.value) void loadWallets()
  }

  /** Record an error and abort. Returns `never`, so callers narrow correctly after it. */
  function fail(message: string): never {
    error.value = message
    loading.value = false
    throw new Error(message)
  }

  /** Prefer the server's statusMessage over ofetch's noisy wrapper. */
  function describeAuthError(e: unknown): string {
    const err = e as {
      data?: { statusMessage?: string; message?: string }
      statusMessage?: string
      message?: string
    }
    return (
      err.data?.statusMessage || err.data?.message || err.statusMessage || err.message || 'Sign-in failed.'
    )
  }

  /**
   * Prove the connected Solana address belongs to this account and store it.
   *
   * Kwami ownership and every payout are addressed on chain, but the app has to
   * know which account an address belongs to long before a wallet is connected
   * again — to show someone their own Kwamis, to name a winner in an activity
   * feed, to reach an owner. The server re-derives the binding from the
   * signature rather than trusting this call, so a hostile client can only bind
   * an address it can actually sign for.
   *
   * The already-bound check comes first and costs one GET, because the
   * alternative is a wallet popup on every page load for someone who bound the
   * same address last week — a prompt with nothing to approve is how users
   * learn to click through prompts without reading them.
   */
  async function bindWallet(): Promise<boolean> {
    if (!import.meta.client || !user.value || !wallet.address) return false
    const address = wallet.address
    if (boundAddresses.value.includes(address)) return true

    try {
      const { nonce } = await $fetch<{ nonce: string }>('/api/auth/nonce', { method: 'POST', body: {} })
      const signed = await wallet.signIn(nonce)
      const { wallets } = await authedFetch<{ wallets: BoundWallet[] }>('/api/me/wallet', {
        method: 'POST',
        body: { message: signed.message, signature: bs58.encode(signed.signature), address: signed.address },
      })
      boundAddresses.value = wallets.filter((w) => w.chain === 'solana').map((w) => w.address)
      return true
    } catch (e) {
      // A refused signature is a choice, not a fault. The user stays signed in
      // and simply has no payout address on file until they agree to prove one.
      error.value = describeAuthError(e)
      return false
    }
  }

  /** Read back the addresses already proven for this account. */
  async function loadWallets() {
    if (!import.meta.client || !user.value) return
    try {
      const { wallets } = await authedFetch<{ wallets: BoundWallet[] }>('/api/me/wallet')
      boundAddresses.value = wallets.filter((w) => w.chain === 'solana').map((w) => w.address)
    } catch {
      boundAddresses.value = []
    }
  }

  /**
   * `$fetch` with the Supabase access token attached.
   *
   * The store cannot call `useApi()` — that composable resolves this very store
   * — so it builds an instance from the same factory rather than growing a
   * second implementation that could drift from it.
   */
  const authedFetch = createApiFetch(() => session.value?.access_token)

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
      error.value = describeAuthError(e)
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
      error.value = describeAuthError(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    user.value = null
    session.value = null
    boundAddresses.value = []
  }

  return {
    user,
    session,
    loading,
    error,
    ready,
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
    boundAddresses,
    bindWallet,
    loadWallets,
    authedFetch,
    signOut,
  }
})
