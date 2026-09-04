import { defineStore } from 'pinia'
import { Connection, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction, type Transaction } from '@solana/web3.js'
import {
  describeWalletError,
  getPhantomProvider,
  isMobileBrowser,
  isUserRejection,
  phantomDeeplink,
  waitForPhantom,
  type PhantomProvider,
} from '~/utils/phantom'
import { SIWS_STATEMENT, SOLANA_CHAIN_IDS, formatSiwsMessage } from '#shared/auth/siws'
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

  function rpc(): Connection {
    connection ??= new Connection(config.public.solanaRpcUrl as string, 'confirmed')
    return connection
  }

  function bindProviderEvents(p: PhantomProvider) {
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
    lamports.value = 0n
    usdcBaseUnits.value = 0n
    balancesLoadedAt.value = null
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
      status.value = 'disconnected'
    }
  }

  async function connect() {
    error.value = null
    status.value = 'connecting'

    const p = provider ?? (await waitForPhantom())
    if (!p) {
      // On a phone the extension can never exist; the universal link reopens
      // this page inside Phantom's browser, where it does.
      if (isMobileBrowser()) {
        window.location.href = phantomDeeplink()
        return
      }
      status.value = 'unavailable'
      error.value = 'Phantom is not installed.'
      return
    }

    provider = p
    bindProviderEvents(p)
    try {
      const { publicKey: key } = await p.connect()
      address.value = key.toBase58()
      status.value = 'connected'
      await refreshBalances()
    } catch (e) {
      status.value = 'disconnected'
      error.value = isUserRejection(e) ? null : describeWalletError(e)
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
   */
  async function signIn(nonce: string): Promise<{ message: string; signature: Uint8Array; address: string }> {
    const p = provider ?? (await waitForPhantom())
    if (!p) throw new Error('Phantom is not installed.')
    provider = p

    const cluster = config.public.solanaCluster as Cluster
    const domain = window.location.host
    const uri = window.location.origin
    const issuedAt = new Date().toISOString()

    if (p.signIn) {
      const out = await p.signIn({
        domain,
        statement: SIWS_STATEMENT,
        nonce,
        chainId: SOLANA_CHAIN_IDS[cluster],
        issuedAt,
      })
      address.value = out.address.toBase58()
      status.value = 'connected'
      bindProviderEvents(p)
      return {
        // Sign exactly what the wallet showed, not a message we re-derive.
        message: new TextDecoder().decode(out.signedMessage),
        signature: out.signature,
        address: out.address.toBase58(),
      }
    }

    const { publicKey: key } = await p.connect()
    const addr = key.toBase58()
    const message = formatSiwsMessage({
      domain,
      address: addr,
      statement: SIWS_STATEMENT,
      uri,
      version: '1',
      chainId: SOLANA_CHAIN_IDS[cluster],
      nonce,
      issuedAt,
    })
    const { signature } = await p.signMessage(new TextEncoder().encode(message), 'utf8')
    address.value = addr
    status.value = 'connected'
    bindProviderEvents(p)
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
