/**
 * The "Connect Phantom" button, as the store sees it.
 *
 * Both cases here have been shipped broken before: a button that dead-ends
 * silently when Phantom is absent, and a download page shoved at somebody who
 * already has it because the mount-time verdict went stale. The guard used to
 * live in one component, so only that one component was right.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { PublicKey } from '@solana/web3.js'
import { PHANTOM_INSTALL_URL } from '~/utils/phantom'
import { parseSiwsMessage, validateSiwsMessage } from '#shared/auth/siws'

// `connect` refreshes balances on success. The RPC is not what is under test,
// and a real socket attempt prints ECONNREFUSED over the whole run.
vi.mock('@solana/web3.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@solana/web3.js')>()),
  Connection: class {
    getBalance = async () => 0
    getParsedTokenAccountsByOwner = async () => ({ value: [] })
  },
}))

// The store is written against Nuxt's auto-imports; hand it the three it uses.
Object.assign(globalThis, {
  ref,
  computed,
  useRuntimeConfig: () => ({
    public: {
      solanaRpcUrl: 'http://127.0.0.1:8899',
      solanaCluster: 'devnet',
      usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    },
  }),
})

const { useWalletStore } = await import('~/stores/wallet')

const KEY = PublicKey.unique()
const fakeProvider = () => ({
  isPhantom: true,
  publicKey: null,
  isConnected: false,
  connect: vi.fn().mockResolvedValue({ publicKey: KEY }),
  signIn: undefined as undefined | ReturnType<typeof vi.fn>,
  signMessage: vi.fn().mockResolvedValue({ signature: new Uint8Array(64), publicKey: KEY }),
  on: vi.fn(),
  off: vi.fn(),
})

/**
 * Replace `window.location` with something that records instead of navigating.
 *
 * happy-dom treats an href assignment as a real navigation, and the mobile path
 * is defined entirely by what it assigns.
 */
function captureNavigation() {
  const seen: string[] = []
  const original = Object.getOwnPropertyDescriptor(window, 'location')
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      origin: 'https://x.kwami.io',
      host: 'x.kwami.io',
      get href() {
        return 'https://x.kwami.io/play/abc'
      },
      set href(next: string) {
        seen.push(next)
      },
    },
  })
  return {
    seen,
    restore: () => {
      if (original) Object.defineProperty(window, 'location', original)
    },
  }
}

const onPhone = () =>
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')

describe('connect', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    delete (window as Record<string, unknown>).phantom
    delete (window as Record<string, unknown>).solana
    vi.restoreAllMocks()
  })

  it('offers the install page rather than dead-ending', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const wallet = useWalletStore()
    // The verdict mount-time `autoConnect` reaches when nothing injects.
    wallet.status = 'unavailable'

    await wallet.connect()

    expect(open).toHaveBeenCalledWith(PHANTOM_INSTALL_URL, '_blank', 'noopener')
    // And it says so, because a blocked popup would otherwise be silent too.
    expect(wallet.error).toMatch(/not installed/i)
  })

  it('never sends somebody who has Phantom to the download page', async () => {
    // Phantom landed after the wait gave up — Firefox does this. A stale
    // verdict must not outrank a live read of the provider.
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    ;(window as Record<string, unknown>).phantom = { solana: fakeProvider() }
    const wallet = useWalletStore()
    wallet.status = 'unavailable'

    await wallet.connect()

    expect(open).not.toHaveBeenCalled()
    expect(wallet.address).toBe(KEY.toBase58())
    expect(wallet.status).toBe('connected')
  })

  it('explains a refusal that is not a dismissal', async () => {
    const provider = fakeProvider()
    // 4900: Phantom is installed and locked — the case that used to leave every
    // button outside the header silently doing nothing.
    provider.connect.mockRejectedValue({ code: 4900, message: 'locked' })
    ;(window as Record<string, unknown>).phantom = { solana: provider }
    const wallet = useWalletStore()
    wallet.status = 'unavailable'

    await wallet.connect()

    expect(wallet.status).toBe('disconnected')
    expect(wallet.error).toMatch(/locked/i)
  })

  it('does not claim a tab it cannot know it opened', async () => {
    // Clicking before the mount-time wait has concluded takes the slow path,
    // which spends three seconds before it gives up. User activation does not
    // survive that, so the install tab may well be blocked — and `noopener`
    // makes `window.open` return null either way, so the message must not
    // describe what happened. It has to carry the URL instead.
    vi.useFakeTimers()
    vi.spyOn(window, 'open').mockReturnValue(null)
    const wallet = useWalletStore()
    expect(wallet.status).toBe('disconnected')

    const pending = wallet.connect()
    await vi.advanceTimersByTimeAsync(3100)
    await pending

    expect(wallet.error).toContain(PHANTOM_INSTALL_URL)
    expect(wallet.error).not.toMatch(/we opened|new tab/i)
    vi.useRealTimers()
  })

  it('joins the wait already running instead of starting a second one', async () => {
    vi.useFakeTimers()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const wallet = useWalletStore()

    const mounting = wallet.autoConnect()
    await vi.advanceTimersByTimeAsync(500)
    // Pressed Connect while the mount-time wait still has 2.5s to run.
    const clicking = wallet.connect()
    await vi.advanceTimersByTimeAsync(2700)

    // Two waits back to back would put this answer at 3500ms. It is here at
    // 3200ms because the click joined the wait already in flight.
    expect(open).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2000)
    await mounting
    await clicking
    vi.useRealTimers()
  })

  it('reopens the page inside Phantom on a phone instead of pushing a download', async () => {
    // The extension cannot exist in a phone browser, so the install page is the
    // one thing that is guaranteed useless there.
    onPhone()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const nav = captureNavigation()
    const wallet = useWalletStore()
    wallet.status = 'unavailable'

    await wallet.connect()

    expect(open).not.toHaveBeenCalled()
    expect(nav.seen[0]).toContain('phantom.app/ul/browse/')
    // Navigating away is not guaranteed — a blocked link must not leave the
    // button disabled on "Connecting…" forever.
    expect(wallet.status).toBe('disconnected')
    nav.restore()
  })
})

describe('autoConnect', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    delete (window as Record<string, unknown>).phantom
    delete (window as Record<string, unknown>).solana
    vi.restoreAllMocks()
  })

  it('stops reporting Phantom missing once it injects late', async () => {
    vi.useFakeTimers()
    const wallet = useWalletStore()

    const settling = wallet.autoConnect()
    await vi.advanceTimersByTimeAsync(3100)
    await settling
    expect(wallet.status).toBe('unavailable')

    // Firefox lands the provider after the wait has already given up. The
    // verdict used to be permanent, so "Get Phantom" and the sign-in modal's
    // "no Phantom detected" went on lying to somebody who had it installed.
    ;(window as Record<string, unknown>).phantom = { solana: fakeProvider() }
    window.dispatchEvent(new Event('phantom#initialized'))
    await vi.advanceTimersByTimeAsync(100)

    expect(wallet.status).toBe('connected')
    vi.useRealTimers()
  })
})

describe('signIn', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    delete (window as Record<string, unknown>).phantom
    delete (window as Record<string, unknown>).solana
    vi.restoreAllMocks()
  })

  it('offers the install page rather than only throwing', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const wallet = useWalletStore()
    wallet.status = 'unavailable'

    await expect(wallet.signIn('nonce')).rejects.toThrow(/not installed/i)

    // Callers await a signature, so this one has to throw — but throwing was
    // all it used to do, which left the sign-in modal with a dead button.
    expect(open).toHaveBeenCalledWith(PHANTOM_INSTALL_URL, '_blank', 'noopener')
  })

  it('never leaves a button stuck on Connecting… when the prompt is dismissed', async () => {
    vi.useFakeTimers()
    const nav = captureNavigation()
    const provider = fakeProvider()
    provider.signIn = vi.fn().mockRejectedValue({ code: 4001, message: 'User rejected the request' })
    const wallet = useWalletStore()

    const pending = wallet.signIn('nonce')
    // Attached now, not after the timers run: the rejection lands while they
    // are being advanced, and an unattached one fails the run as unhandled.
    const settled = pending.then(
      () => null,
      (e: unknown) => e,
    )
    // Landing mid-wait is the one path that borrows `connecting` from the
    // caller, and `signIn` throws without ever reaching a status of its own.
    ;(window as Record<string, unknown>).phantom = { solana: provider }
    await vi.advanceTimersByTimeAsync(200)

    expect(await settled).toMatchObject({ code: 4001 })
    expect(wallet.status).not.toBe('connecting')
    nav.restore()
    vi.useRealTimers()
  })

  it('falls back to connect + signMessage in a form the server accepts', async () => {
    const nav = captureNavigation()
    const provider = fakeProvider() // no `signIn` — not every wallet has SIWS
    ;(window as Record<string, unknown>).phantom = { solana: provider }
    const wallet = useWalletStore()
    wallet.status = 'unavailable'

    const out = await wallet.signIn('nonce-abc')

    expect(provider.signMessage).toHaveBeenCalled()
    expect(out.address).toBe(KEY.toBase58())

    // The whole point of building the message ourselves is that the server
    // verifies both paths identically, so assert against the server's own
    // parser rather than a substring that could drift out of spec unnoticed.
    const parsed = parseSiwsMessage(out.message)
    expect(parsed).not.toBeNull()
    expect(
      validateSiwsMessage(parsed!, {
        expectedDomain: 'x.kwami.io',
        expectedNonce: 'nonce-abc',
        expectedAddress: KEY.toBase58(),
        expectedChainId: 'devnet',
      }),
    ).toMatchObject({ valid: true })
    nav.restore()
  })

  it('falls through to signMessage when an older build mishandles signIn', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const nav = captureNavigation()
    const provider = fakeProvider()
    // Advertises SIWS but rejects our input. A dismissal must still surface;
    // anything else has to leave a way in rather than locking the user out.
    provider.signIn = vi.fn().mockRejectedValue(new Error('unsupported input'))
    ;(window as Record<string, unknown>).phantom = { solana: provider }
    const wallet = useWalletStore()
    wallet.status = 'unavailable'

    const out = await wallet.signIn('nonce-xyz')

    expect(provider.signIn).toHaveBeenCalled()
    expect(provider.signMessage).toHaveBeenCalled()
    expect(parseSiwsMessage(out.message)?.nonce).toBe('nonce-xyz')
    nav.restore()
  })
})
