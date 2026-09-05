import { describe, expect, it } from 'vitest'
import {
  formatSiweMessage,
  parseSiweMessage,
  SIWE_STATEMENT,
  validateSiweMessage,
  type SiweMessage,
} from '#shared/auth/siwe'

const BASE: SiweMessage = {
  domain: 'x.kwami.io',
  address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
  statement: SIWE_STATEMENT,
  uri: 'https://x.kwami.io',
  version: '1',
  chainId: 1,
  nonce: 'nonce-1',
  issuedAt: '2026-09-04T12:00:00.000Z',
}

describe('SIWE messages', () => {
  it('uses the EIP-4361 header wallets render specially', () => {
    expect(formatSiweMessage(BASE).split('\n')[0]).toBe(
      'x.kwami.io wants you to sign in with your Ethereum account:',
    )
  })

  it('round-trips, including the numeric chain id', () => {
    const parsed = parseSiweMessage(formatSiweMessage(BASE))
    expect(parsed).toEqual({ ...BASE, expirationTime: undefined })
    expect(parsed?.chainId).toBe(1)
  })

  it('returns null on a Solana-shaped message rather than mis-parsing it', () => {
    expect(parseSiweMessage('x.kwami.io wants you to sign in with your Solana account:\n0xabc')).toBeNull()
  })

  it('validates domain, nonce and freshness', () => {
    const now = new Date('2026-09-04T12:01:00.000Z')
    expect(
      validateSiweMessage(BASE, { expectedDomain: 'x.kwami.io', expectedNonce: 'nonce-1', now }).valid,
    ).toBe(true)
    expect(
      validateSiweMessage(BASE, { expectedDomain: 'evil.example', expectedNonce: 'nonce-1', now }).valid,
    ).toBe(false)
    expect(
      validateSiweMessage(BASE, { expectedDomain: 'x.kwami.io', expectedNonce: 'other', now }).valid,
    ).toBe(false)
    expect(
      validateSiweMessage(BASE, {
        expectedDomain: 'x.kwami.io',
        expectedNonce: 'nonce-1',
        now: new Date('2026-09-04T12:10:00.000Z'),
      }).valid,
    ).toBe(false)
  })

  it('says out loud that Ethereum is identity only', () => {
    // The statement is what the user actually reads in the wallet, so it is
    // worth asserting that it still tells them their pot settles elsewhere.
    expect(SIWE_STATEMENT).toMatch(/identity only/i)
    expect(SIWE_STATEMENT).toMatch(/Solana/)
  })
})
