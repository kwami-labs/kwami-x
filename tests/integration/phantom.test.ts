import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeWalletError,
  getPhantomProvider,
  isMobileBrowser,
  isPhantomInstalled,
  isUserRejection,
  phantomDeeplink,
  waitForPhantom,
} from '~/utils/phantom'

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
    expect(describeWalletError({ code: -32603 })).toMatch(/simulation|process/i)
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

    set('Mozilla/5.0 (X11; Linux x86_64)')
    expect(isMobileBrowser()).toBe(false)

    set(original)
  })
})
