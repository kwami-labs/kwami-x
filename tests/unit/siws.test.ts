import { describe, expect, it } from 'vitest'
import {
  formatSiwsMessage,
  parseSiwsMessage,
  SIWS_STATEMENT,
  SOLANA_CHAIN_IDS,
  validateSiwsMessage,
  type SiwsMessage,
} from '#shared/auth/siws'

const BASE: SiwsMessage = {
  domain: 'x.kwami.io',
  address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  statement: SIWS_STATEMENT,
  uri: 'https://x.kwami.io',
  version: '1',
  chainId: SOLANA_CHAIN_IDS.devnet,
  nonce: 'abc123',
  issuedAt: '2026-09-04T12:00:00.000Z',
}

describe('formatSiwsMessage', () => {
  it('puts the domain and address on the first two lines, where the wallet renders them', () => {
    const lines = formatSiwsMessage(BASE).split('\n')
    expect(lines[0]).toBe('x.kwami.io wants you to sign in with your Solana account:')
    expect(lines[1]).toBe(BASE.address)
  })

  it('omits optional fields entirely rather than emitting empty ones', () => {
    const text = formatSiwsMessage({ ...BASE, statement: undefined, expirationTime: undefined })
    expect(text).not.toContain('Expiration Time')
    expect(text).not.toContain(SIWS_STATEMENT)
  })

  it('lists resources as a bulleted block', () => {
    const text = formatSiwsMessage({ ...BASE, resources: ['https://x.kwami.io/docs'] })
    expect(text).toContain('Resources:\n- https://x.kwami.io/docs')
  })
})

describe('parseSiwsMessage', () => {
  it('round-trips every field', () => {
    const message: SiwsMessage = {
      ...BASE,
      expirationTime: '2026-09-04T12:05:00.000Z',
      resources: ['a', 'b'],
    }
    expect(parseSiwsMessage(formatSiwsMessage(message))).toEqual(message)
  })

  it('round-trips without optional fields', () => {
    const message: SiwsMessage = { ...BASE, statement: undefined }
    expect(parseSiwsMessage(formatSiwsMessage(message))).toEqual({
      ...message,
      expirationTime: undefined,
      resources: undefined,
    })
  })

  it('recovers a multi-line statement intact', () => {
    const message = { ...BASE, statement: 'Line one.\nLine two.' }
    expect(parseSiwsMessage(formatSiwsMessage(message))?.statement).toBe('Line one.\nLine two.')
  })

  it('returns null rather than throwing on garbage', () => {
    expect(parseSiwsMessage('')).toBeNull()
    expect(parseSiwsMessage('hello')).toBeNull()
    expect(parseSiwsMessage('x.kwami.io wants you to sign in with your Solana account:\naddr')).toBeNull()
  })
})

describe('validateSiwsMessage', () => {
  const now = new Date('2026-09-04T12:01:00.000Z')
  const ctx = { expectedDomain: 'x.kwami.io', expectedNonce: 'abc123', now }

  it('accepts a fresh, well-formed message', () => {
    expect(validateSiwsMessage(BASE, ctx).valid).toBe(true)
  })

  it('rejects a signature farmed on another domain', () => {
    // This is the check that stops replay: the wallet showed the user a
    // specific domain, and this message carries a different one.
    const result = validateSiwsMessage({ ...BASE, domain: 'evil.example' }, ctx)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/domain/i)
  })

  it('rejects a nonce that was not the one issued', () => {
    expect(validateSiwsMessage(BASE, { ...ctx, expectedNonce: 'different' }).valid).toBe(false)
  })

  it('rejects a mismatched address when one is expected', () => {
    expect(validateSiwsMessage(BASE, { ...ctx, expectedAddress: 'someone-else' }).valid).toBe(false)
  })

  it('rejects a stale request', () => {
    const late = new Date('2026-09-04T12:06:00.000Z')
    expect(validateSiwsMessage(BASE, { ...ctx, now: late }).valid).toBe(false)
  })

  it('tolerates a little clock skew but not a message from the future', () => {
    const slightlyEarly = new Date('2026-09-04T11:59:30.000Z')
    expect(validateSiwsMessage(BASE, { ...ctx, now: slightlyEarly }).valid).toBe(true)

    const wayEarly = new Date('2026-09-04T11:50:00.000Z')
    expect(validateSiwsMessage(BASE, { ...ctx, now: wayEarly }).valid).toBe(false)
  })

  it('honours an explicit expiration time', () => {
    const expiring = { ...BASE, expirationTime: '2026-09-04T12:00:30.000Z' }
    expect(validateSiwsMessage(expiring, ctx).valid).toBe(false)
  })

  it('rejects an unsupported version', () => {
    expect(validateSiwsMessage({ ...BASE, version: '2' }, ctx).valid).toBe(false)
  })

  it('rejects a malformed timestamp instead of treating NaN as fresh', () => {
    expect(validateSiwsMessage({ ...BASE, issuedAt: 'yesterday' }, ctx).valid).toBe(false)
  })
})
