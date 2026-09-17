import { defineStore } from 'pinia'
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import type { Transaction, VersionedTransaction } from '@solana/web3.js'
import {
  PHANTOM_INSTALL_URL,
  describeWalletError,
  getPhantomProvider,
  isMobileBrowser,
  isUserRejection,
  normalizeSignInOutput,
  phantomDeeplink,
  waitForPhantom,
  type PhantomProvider,
} from '~/utils/phantom'
import { SIWS_STATEMENT, SIWS_VERSION, SOLANA_CHAIN_IDS, formatSiwsMessage } from '#shared/auth/siws'
import { USDC_BASE_UNITS } from '#shared/game/constants'
import type { Cluster } from '#shared/solana/constants'

export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'unavailable'

/**
 * The single source of truth for "who is signing and what can they pay with".
 *
 * Balances are cached with an explicit `refreshBalances()` rather than polled:
 * an RPC round trip per second per open tab is the fastest way to get rate
 * limited off a public endpoint, and the only moments the balance genuinely
 * changes are ones we already know about (a ticket, a payout, an on-ramp).
 */
export const useWalletStore = defineStore('wallet', () => {
  const config = useRuntimeConfig()

  const status = ref<WalletStatus>('disconnected')
  const address = ref<string | null>(null)
  const error = ref<string | null>(null)
  const lamports = ref(0n)
  const usdcBaseUnits = ref(0n)
  const balancesLoadedAt = ref<number | null>(null)

  const publicKey = computed(() => (address.value ? new PublicKey(address.value) : null))
  const isConnected = computed(() => status.value === 'connected' && address.value !== null)
  const sol = computed(() => Number(lamports.value) / LAMPORTS_PER_SOL)
  const usdc = computed(() => Number(usdcBaseUnits.value) / Number(USDC_BASE_UNITS))
  const shortAddress = computed(() =>
    address.value ? `${address.value.slice(0, 4)}…${address.value.slice(-4)}` : null,
  )

  let provider: PhantomProvider | null = null
  let connection: Connection | null = null
  /** The provider we have already subscribed to — rebinding would stack listeners. */
  let eventsBoundTo: PhantomProvider | null = null

  function rpc(): Connection {
    connection ??= new Connection(config.public.solanaRpcUrl as string, 'confirmed')
    return connection
  }

  function bindProviderEvents(p: PhantomProvider) {
    if (eventsBoundTo === p) return
    eventsBoundTo = p
    // Phantom lets the user switch accounts without disconnecting. Everything
    // downstream keys off `address`, so simply following it keeps signing,
    // balances and "is this my Kwami?" consistent with the wallet UI.
    p.on('accountChanged', (next) => {
      const key = next as PublicKey | null
      if (key) {
        address.value = key.toBase58()
        void refreshBalances()
      } else {
        reset()
      }
    })
    p.on('disconnect', () => reset())
  }

  function reset() {
    status.value = 'disconnected'
    address.value = null
    // A stale failure from a previous attempt has nothing to say about the
    // state the wallet is in now, and the banner has no other way to leave.
    error.value = null
    lamports.value = 0n
    usdcBaseUnits.value = 0n
    balancesLoadedAt.value = null
  }

  /**
   * There is no Phantom here — offer the way to get one.
   *
   * Every caller used to be left with `status: 'unavailable'` and an error
   * string that only the header button rendered, so "Connect Phantom" on the
   * mint, play, top-up and account pages was a button that did nothing at all
   * when pressed. The way out belongs next to the dead end, not in one
   * component that happened to remember it.
   */
  function offerPhantom() {
    if (isMobileBrowser()) {
      // The extension cannot exist in a phone browser; the universal link
      // reopens this page inside Phantom's, where the provider is injected.
      // Navigating away is not guaranteed — the link can be blocked, and the
      // user can come back with the page still alive — so do not leave the
      // button stuck on "Connecting…".
      status.value = 'disconnected'
      window.location.href = phantomDeeplink()
      return
    }
    status.value = 'unavailable'
    error.value = 'Phantom is not installed. We opened its download page in a new tab.'
    window.open(PHANTOM_INSTALL_URL, '_blank', 'noopener')
  }

  /**
   * The provider, or null with the escape hatch already offered.
   *
   * Stays synchronous whenever the answer is already known, because opening
   * the install page needs the click's own user gesture and an `await` first
   * spends it. `unavailable` is the verdict mount-time `autoConnect` reached
   * after waiting out a late injection, so when it holds there is nothing left
   * to wait for; the re-read covers a provider that landed since.
   */
  async function requireProvider(): Promise<PhantomProvider | null> {
    let p = provider ?? getPhantomProvider()
    if (!p && status.value !== 'unavailable') {
      // Show the wait — it can run the full three seconds, and a button that
      // looks inert for three seconds gets pressed again.
      status.value = 'connecting'
      p = await waitForPhantom()
      // Borrowed, not owned: `connect` sets it again on the next line, and
      // `signIn` can throw without ever reaching a status of its own — which
      // would leave every button on the page stuck on "Connecting…".
      if (p) status.value = 'disconnected'
    }
    if (!p) {
      offerPhantom()
      return null
    }
    provider = p
    bindProviderEvents(p)
    return p
  }

  /**
   * Reconnect without a prompt when the user has already authorised this site.
   *
   * Called on app mount. `onlyIfTrusted` throws when there is no prior grant,
   * which is the normal first-visit path, not an error worth surfacing.
   */
  async function autoConnect() {
    const p = await waitForPhantom()
    if (!p) {
      status.value = 'unavailable'
      // Phantom can still land after the wait gives up. Without this the
      // verdict is permanent, and every hint keyed off `unavailable` — the
      // "Get Phantom" label, the sign-in modal's "no Phantom detected" — goes
      // on lying to somebody who has it installed.
      window.addEventListener('phantom#initialized', () => void autoConnect(), { once: true })
      return
    }
    provider = p
    bindProviderEvents(p)
    try {
      const { publicKey: key } = await p.connect({ onlyIfTrusted: true })
      address.value = key.toBase58()
      status.value = 'connected'
      await refreshBalances()
    } catch {
      // This runs on mount and can land *after* a user has pressed Connect and
      // been approved — `onlyIfTrusted` is rejected for a site with no prior
      // grant, which is exactly the visit where someone connects by hand.
      // Reporting "disconnected" over the top of that would drop a live wallet.
      if (status.value !== 'connected') status.value = 'disconnected'
    }
  }

  async function connect() {
    error.value = null
    const p = await requireProvider()
    if (!p) return

    status.value = 'connecting'
    try {
      const { publicKey: key } = await p.connect()
      address.value = key.toBase58()
      status.value = 'connected'
      await refreshBalances()
    } catch (e) {
      status.value = 'disconnected'
      error.value = isUserRejection(e) ? null : describeWalletError(e, 'connect')
    }
  }

  async function disconnect() {
    try {
      await provider?.disconnect()
    } finally {
      reset()
    }
  }

  /**
   * Sign in with Solana.
   *
   * Prefers Phantom's native `signIn`, which connects and authenticates in a
   * single prompt and renders the message as structured fields rather than a
   * wall of text. Falls back to connect-then-signMessage for wallets that do
   * not implement SIWS, building the byte-identical message ourselves so the
   * server verifies both paths the same way.
   *
   * Every optional SIWS field the server requires (`uri`, `version`, `chainId`)
   * is passed in: Phantom only puts a field into the signed message when the
   * dapp supplies it, and our parser rejects messages that omit them.
   */
  async function signIn(nonce: string): Promise<{ message: string; signature: Uint8Array; address: string }> {
    // Same escape hatch as `connect` — `requireProvider` has already sent the
    // user to the install page or reopened this page inside Phantom — but this
    // one has to throw, because callers await a signature.
    const p = await requireProvider()
    if (!p) throw new Error(isMobileBrowser() ? 'Opening Phantom…' : 'Phantom is not installed.')

    const cluster = config.public.solanaCluster as Cluster
    const chainId = SOLANA_CHAIN_IDS[cluster]
    const domain = window.location.host
    const uri = window.location.origin
    const issuedAt = new Date().toISOString()

    if (p.signIn) {
      try {
        const out = normalizeSignInOutput(
          await p.signIn({
            domain,
            statement: SIWS_STATEMENT,
            uri,
            version: SIWS_VERSION,
            nonce,
            chainId,
            issuedAt,
          }),
        )
        address.value = out.address
        status.value = 'connected'
        void refreshBalances()
        // Sign exactly what the wallet showed, not a message we re-derive.
        return out
      } catch (e) {
        // User dismissed the prompt — surface that cleanly. Any other failure
        // falls through to connect + signMessage so an older Phantom build that
        // advertises `signIn` but mis-handles our input still lets people in.
        if (isUserRejection(e)) throw e
        console.warn('[wallet] signIn failed, falling back to signMessage', e)
      }
    }

    const { publicKey: key } = await p.connect()
    const addr = key.toBase58()
    const message = formatSiwsMessage({
      domain,
      address: addr,
      statement: SIWS_STATEMENT,
      uri,
      version: SIWS_VERSION,
      chainId,
      nonce,
      issuedAt,
    })
    const { signature } = await p.signMessage(new TextEncoder().encode(message), 'utf8')
    address.value = addr
    status.value = 'connected'
    void refreshBalances()
    return { message, signature, address: addr }
  }

  /**
   * Hand a transaction to Phantom to sign *and* broadcast.
   *
   * This is the path that gives the user Phantom's decoded preview — "you are
   * paying 0.05 SOL to Kwami Vault" instead of an unlabelled blob. It also
   * means Phantom owns retries and preflight, which is more reliable than a
   * browser tab racing a flaky public RPC.
   */
  async function signAndSend(tx: Transaction | VersionedTransaction): Promise<string> {
    const p = provider
    if (!p) throw new Error('Wallet not connected.')
    const { signature } = await p.signAndSendTransaction(tx)
    return signature
  }

  /** Sign without broadcasting — used when the server has to co-sign. */
  async function signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const p = provider
    if (!p) throw new Error('Wallet not connected.')
    return p.signTransaction(tx)
  }

  async function refreshBalances() {
    if (!publicKey.value) return
    const owner = publicKey.value
    try {
      const [solBalance, tokenAccounts] = await Promise.all([
        rpc().getBalance(owner, 'confirmed'),
        rpc().getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(config.public.usdcMint as string) }),
      ])
      lamports.value = BigInt(solBalance)
      const raw = tokenAccounts.value[0]?.account.data.parsed?.info?.tokenAmount?.amount
      usdcBaseUnits.value = raw ? BigInt(raw) : 0n
      balancesLoadedAt.value = Date.now()
    } catch (e) {
      // A failed balance read must never block gameplay — the chain is the
      // authority on whether a ticket can be paid, not this cache.
      console.warn('[wallet] balance refresh failed', e)
    }
  }

  return {
    status,
    address,
    shortAddress,
    publicKey,
    isConnected,
    error,
    lamports,
    usdcBaseUnits,
    sol,
    usdc,
    balancesLoadedAt,
    autoConnect,
    connect,
    disconnect,
    signIn,
    signAndSend,
    signTransaction,
    refreshBalances,
    rpc,
  }
})
