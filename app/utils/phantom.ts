/**
 * A bespoke Phantom provider binding.
 *
 * Deliberately not `@solana/wallet-adapter`. Kwami leans on three Phantom
 * behaviours that the generic adapter abstracts away, and losing them costs
 * real conversions:
 *
 * 1. `signAndSendTransaction` — Phantom simulates server-side and shows the
 *    user a decoded preview of what the transaction does. Going through
 *    `signTransaction` + our own `sendRawTransaction` skips that entirely, and
 *    an unlabelled "unknown transaction" prompt is exactly what a first-time
 *    buyer bounces off.
 * 2. `signIn` (Sign In With Solana, CAIP-122) — one prompt that both connects
 *    and authenticates. The generic path is connect, then a second signMessage
 *    prompt, which reads as two separate asks.
 * 3. `accountChanged` — Phantom lets a user switch accounts without
 *    disconnecting. A game with money in escrow has to react to that
 *    immediately rather than keep signing as the wrong wallet.
 */
import { PublicKey } from '@solana/web3.js'
import type { Transaction, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'

export interface PhantomSignInInput {
  domain: string
  address?: string
  statement?: string
  uri?: string
  version?: string
  nonce: string
  chainId?: string
  issuedAt?: string
  resources?: string[]
}

export interface PhantomSignInOutput {
  /** Phantom's provider shape — a PublicKey or, on some builds, a base58 string. */
  address?: PublicKey | string
  /** Wallet-standard shape — used when the provider wraps the standard feature. */
  account?: { address?: string; publicKey?: Uint8Array }
  /** The exact SIWS message the wallet displayed and signed. */
  signedMessage: Uint8Array | string
  signature: Uint8Array | number[] | string
  signatureType?: string
}

/**
 * Collapse Phantom / wallet-standard `signIn` outputs into one shape.
 *
 * Phantom's injected provider has returned `address` as a PublicKey, as a
 * base58 string, and (via the wallet-standard bridge) as `account.address`.
 * Treating any one of those as canonical crashes the others, so normalise
 * once at the boundary rather than sprinkling defensive casts through the
 * store.
 */
export function normalizeSignInOutput(out: PhantomSignInOutput): {
  address: string
  message: string
  signature: Uint8Array
} {
  let address: string | null = null
  if (typeof out.address === 'string' && out.address.length > 0) {
    address = out.address
  } else if (out.address instanceof PublicKey) {
    address = out.address.toBase58()
  } else if (typeof out.account?.address === 'string' && out.account.address.length > 0) {
    address = out.account.address
  } else if (out.account?.publicKey) {
    address = new PublicKey(out.account.publicKey).toBase58()
  }
  if (!address) throw new Error('Phantom returned no address from sign-in.')

  const message =
    typeof out.signedMessage === 'string'
      ? out.signedMessage
      : new TextDecoder().decode(
          out.signedMessage instanceof Uint8Array ? out.signedMessage : Uint8Array.from(out.signedMessage),
        )

  let signature: Uint8Array
  if (typeof out.signature === 'string') {
    signature = bs58.decode(out.signature)
  } else if (out.signature instanceof Uint8Array) {
    signature = out.signature
  } else if (Array.isArray(out.signature)) {
    signature = Uint8Array.from(out.signature)
  } else {
    throw new Error('Phantom returned no signature from sign-in.')
  }

  return { address, message, signature }
}

export interface PhantomProvider {
  isPhantom?: boolean
  publicKey: PublicKey | null
  isConnected: boolean
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey }>
  disconnect(): Promise<void>
  signMessage(
    message: Uint8Array,
    encoding?: 'utf8' | 'hex',
  ): Promise<{ signature: Uint8Array; publicKey: PublicKey }>
  signIn?(input: PhantomSignInInput): Promise<PhantomSignInOutput>
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>
  signAndSendTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
    opts?: { skipPreflight?: boolean; maxRetries?: number },
  ): Promise<{ signature: string }>
  on(event: 'connect' | 'disconnect' | 'accountChanged', handler: (arg: unknown) => void): void
  off(event: 'connect' | 'disconnect' | 'accountChanged', handler: (arg: unknown) => void): void
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider; ethereum?: unknown }
    solana?: PhantomProvider
  }
}

/** Phantom's install page, used when the extension is absent on desktop. */
export const PHANTOM_INSTALL_URL = 'https://phantom.app/download'

export function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === 'undefined') return null
  // `window.phantom.solana` is the namespaced modern injection; `window.solana`
  // is the legacy one and can be another wallet impersonating Phantom, so it is
  // only accepted when it self-identifies.
  const provider = window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null)
  return provider?.isPhantom ? provider : null
}

export function isPhantomInstalled(): boolean {
  return getPhantomProvider() !== null
}

/**
 * Phantom does not inject synchronously on every browser — Firefox in
 * particular can land the provider after `DOMContentLoaded`. Rather than
 * showing "install Phantom" to someone who already has it, wait briefly.
 */
export function waitForPhantom(timeoutMs = 3000): Promise<PhantomProvider | null> {
  const existing = getPhantomProvider()
  if (existing) return Promise.resolve(existing)
  if (typeof window === 'undefined') return Promise.resolve(null)

  return new Promise((resolve) => {
    let settled = false
    const finish = (p: PhantomProvider | null) => {
      if (settled) return
      settled = true
      window.removeEventListener('phantom#initialized', onInit)
      clearInterval(poll)
      clearTimeout(timer)
      resolve(p)
    }
    const onInit = () => finish(getPhantomProvider())
    window.addEventListener('phantom#initialized', onInit, { once: true })
    const poll = setInterval(() => {
      const p = getPhantomProvider()
      if (p) finish(p)
    }, 100)
    const timer = setTimeout(() => finish(getPhantomProvider()), timeoutMs)
  })
}

/**
 * Mobile browsers cannot host the extension, so Phantom is reached through its
 * universal link, which reopens the current page inside Phantom's in-app
 * browser where the provider *is* injected.
 */
export function phantomDeeplink(url: string = window.location.href): string {
  const ref = encodeURIComponent(new URL(url).origin)
  return `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${ref}`
}

export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent)
}

/**
 * Phantom surfaces a numeric `code` alongside its message. 4001 is the user
 * closing the prompt — an ordinary outcome that should never be shown as an
 * error banner.
 */
export function isUserRejection(error: unknown): boolean {
  const code = (error as { code?: number })?.code
  if (code === 4001) return true
  const message = (error as { message?: string })?.message?.toLowerCase() ?? ''
  return message.includes('user rejected') || message.includes('user denied')
}

/** Turn a Phantom error into something worth putting in front of a person. */
export function describeWalletError(error: unknown): string {
  if (isUserRejection(error)) return 'You dismissed the wallet prompt.'
  const code = (error as { code?: number })?.code
  switch (code) {
    case 4900:
      return 'Phantom is locked. Open it and unlock, then try again.'
    case 4100:
      return 'Phantom has not authorised this site yet. Connect first.'
    case -32603:
      return 'Phantom could not process the transaction. It may have failed simulation.'
    default:
      return (error as { message?: string })?.message ?? 'Something went wrong talking to Phantom.'
  }
}
