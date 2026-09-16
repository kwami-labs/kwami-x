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
  on: vi.fn(),
  off: vi.fn(),
})

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
})
