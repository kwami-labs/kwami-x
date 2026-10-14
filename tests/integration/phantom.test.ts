import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeWalletError,
  getPhantomProvider,
  isMobileBrowser,
  isPhantomInstalled,
  isUserRejection,
  normalizeSignInOutput,
  phantomDeeplink,
  waitForPhantom,
} from '~/utils/phantom'
import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'

describe('provider detection', () => {
  beforeEach(() => {
    delete (window as Record<string, unknown>).phantom
    delete (window as Record<string, unknown>).solana
  })

  it('finds the namespaced modern injection', () => {
    ;(window as Record<string, unknown>).phantom = { solana: { isPhantom: true } }
    expect(getPhantomProvider()).not.toBeNull()
    expect(isPhantomInstalled()).toBe(true)
  })

  it('accepts the legacy injection only when it self-identifies', () => {
    // `window.solana` can be another wallet impersonating Phantom, so the flag
    // is the only thing that makes it trustworthy.
    ;(window as Record<string, unknown>).solana = { isPhantom: false }
    expect(getPhantomProvider()).toBeNull()
    ;(window as Record<string, unknown>).solana = { isPhantom: true }
    expect(getPhantomProvider()).not.toBeNull()
  })

  it('reports nothing when no wallet is present', () => {
    expect(getPhantomProvider()).toBeNull()
    expect(isPhantomInstalled()).toBe(false)
  })

  it('reports nothing when there is no window, which is the SSR path', () => {
    const win = globalThis.window
    vi.stubGlobal('window', undefined)
    try {
      expect(getPhantomProvider()).toBeNull()
    } finally {
      vi.stubGlobal('window', win)
    }
  })
})

describe('normalizeSignInOutput', () => {
  const message = 'x.kwami.io wants you to sign in with your Solana account:\naddr'
  const signature = new Uint8Array(64).fill(7)
  const key = PublicKey.unique()

  it('reads Phantom PublicKey address shape', () => {
    const out = normalizeSignInOutput({
      address: key,
      signedMessage: new TextEncoder().encode(message),
      signature,
    })
    expect(out.address).toBe(key.toBase58())
    expect(out.message).toBe(message)
    expect(out.signature).toEqual(signature)
  })

  it('reads a base58 address string', () => {
    const out = normalizeSignInOutput({
      address: key.toBase58(),
      signedMessage: message,
      signature,
    })
    expect(out.address).toBe(key.toBase58())
    expect(out.message).toBe(message)
  })

  it('reads the wallet-standard account shape', () => {
    const out = normalizeSignInOutput({
      account: { address: key.toBase58() },
      signedMessage: new TextEncoder().encode(message),
      signature: Array.from(signature),
    })
    expect(out.address).toBe(key.toBase58())
    expect(out.signature).toEqual(signature)
  })

  it('decodes a signed message that arrived as a byte array rather than a Uint8Array', () => {
    const out = normalizeSignInOutput({
      address: key.toBase58(),
      signedMessage: Array.from(new TextEncoder().encode(message)) as unknown as Uint8Array,
      signature,
    })
    expect(out.message).toBe(message)
  })

  it('derives the address from a raw public key when the string is missing', () => {
    const out = normalizeSignInOutput({
      account: { publicKey: key.toBytes() },
      signedMessage: message,
      signature,
    })
    expect(out.address).toBe(key.toBase58())
  })

  it('accepts a base58 signature string', () => {
    const out = normalizeSignInOutput({
      address: key.toBase58(),
      signedMessage: message,
      signature: bs58.encode(signature),
    })
    expect(out.signature).toEqual(signature)
  })

  it('throws when Phantom returns nothing usable', () => {
    expect(() =>
      normalizeSignInOutput({
        signedMessage: message,
        signature,
      }),
    ).toThrow(/no address/i)
  })

  it('throws when the signature is a shape it does not know', () => {
    expect(() =>
      normalizeSignInOutput({
        address: key.toBase58(),
        signedMessage: message,
        signature: { r: 1 } as never,
      }),
    ).toThrow(/no signature/i)
  })
})

describe('waitForPhantom', () => {
  beforeEach(() => {
    delete (window as Record<string, unknown>).phantom
  })

  it('returns immediately when the provider is already there', async () => {
    ;(window as Record<string, unknown>).phantom = { solana: { isPhantom: true } }
    await expect(waitForPhantom(50)).resolves.not.toBeNull()
  })

  it('picks up a provider that injects late', async () => {
    // Firefox in particular can land the provider after DOMContentLoaded, and
    // telling somebody to install a wallet they already have is worse than
    // waiting a moment.
    setTimeout(() => {
      ;(window as Record<string, unknown>).phantom = { solana: { isPhantom: true } }
    }, 120)
    await expect(waitForPhantom(1000)).resolves.not.toBeNull()
  })

  it('gives up after the timeout rather than hanging', async () => {
    await expect(waitForPhantom(60)).resolves.toBeNull()
  })

  it('picks up the initialized event', async () => {
    const pending = waitForPhantom(1000)
    ;(window as Record<string, unknown>).phantom = { solana: { isPhantom: true } }
    window.dispatchEvent(new Event('phantom#initialized'))
    await expect(pending).resolves.not.toBeNull()
  })

  it('resolves null without a window rather than waiting for one', async () => {
    const win = globalThis.window
    vi.stubGlobal('window', undefined)
    try {
      await expect(waitForPhantom(10)).resolves.toBeNull()
    } finally {
      vi.stubGlobal('window', win)
    }
  })
})

describe('error interpretation', () => {
  it('recognises a dismissed prompt, which is not an error worth showing', () => {
    expect(isUserRejection({ code: 4001 })).toBe(true)
    expect(isUserRejection(new Error('User rejected the request'))).toBe(true)
    expect(isUserRejection({ message: 'User denied transaction signature' })).toBe(true)
  })

  it('does not treat a real failure as a dismissal', () => {
    expect(isUserRejection({ code: -32603, message: 'Internal error' })).toBe(false)
    expect(isUserRejection(undefined)).toBe(false)
  })

  it('explains the codes a person can act on', () => {
    expect(describeWalletError({ code: 4001 })).toMatch(/dismissed/i)
    expect(describeWalletError({ code: 4900 })).toMatch(/locked/i)
    expect(describeWalletError({ code: 4100 })).toMatch(/authorised|connect/i)
    expect(describeWalletError({ code: 4100 }, 'connect')).toMatch(/unlocked|authorise/i)
    expect(describeWalletError({ code: -32603 })).toMatch(/simulation|process/i)
  })

  it('never blames a transaction for a failure to connect', () => {
    // Phantom returns -32603 from every method, so the description used to tell
    // someone pressing "Connect wallet" on a browser where Phantom is installed
    // but never set up that their transaction had failed simulation: untrue,
    // unactionable, and it sends them looking for a problem with their money.
    const connecting = describeWalletError({ code: -32603 }, 'connect')
    expect(connecting).not.toMatch(/transaction|simulation/i)
    // And it has to say what to actually do about it.
    expect(connecting).toMatch(/set(ting)? up|reload/i)
  })

  it('names the connection, not a generic prompt, when one is dismissed', () => {
    expect(describeWalletError({ code: 4001 }, 'connect')).toMatch(/connection/i)
  })

  it('leaves the transaction paths alone, which is what the default is for', () => {
    // Four call sites send transactions and pass no action; changing what they
    // say was never the point of making this operation-aware.
    for (const code of [4001, 4900, 4100, -32603]) {
      expect(describeWalletError({ code }), String(code)).toBe(describeWalletError({ code }, 'send'))
    }
    expect(describeWalletError({ code: -32603 }, 'send')).toMatch(/simulation/i)
  })

  it('falls back to the underlying message', () => {
    expect(describeWalletError(new Error('blockhash not found'))).toBe('blockhash not found')
    expect(describeWalletError({})).toMatch(/something went wrong/i)
  })
})

describe('mobile', () => {
  it('builds a universal link back to the current page', () => {
    const link = phantomDeeplink('https://x.kwami.io/kwami/abc')
    expect(link).toContain('phantom.app/ul/browse/')
    expect(link).toContain(encodeURIComponent('https://x.kwami.io/kwami/abc'))
    expect(link).toContain(`ref=${encodeURIComponent('https://x.kwami.io')}`)
  })

  it('detects mobile user agents', () => {
    const original = navigator.userAgent
    const set = (ua: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)

    set('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
    expect(isMobileBrowser()).toBe(true)

    set('Mozilla/5.0 (Linux; Android 14)')
    expect(isMobileBrowser()).toBe(true)

    set('Mozilla/5.0 (X11; Linux x86_64)')
    expect(isMobileBrowser()).toBe(false)

    const nav = globalThis.navigator
    vi.stubGlobal('navigator', undefined)
    expect(isMobileBrowser()).toBe(false)
    vi.stubGlobal('navigator', nav)

    set(original)
  })
})
