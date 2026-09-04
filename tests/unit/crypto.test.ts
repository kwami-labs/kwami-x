import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, randomToken, safeEqual } from '~~/server/utils/crypto'

const KEY = 'a'.repeat(64)
const OTHER_KEY = 'b'.repeat(64)

describe('secret envelopes', () => {
  it('round-trips', () => {
    expect(decryptSecret(encryptSecret('the moon remembers', KEY), KEY)).toBe('the moon remembers')
  })

  it('round-trips unicode intact', () => {
    const secret = 'café ñandú 🌙 привет'
    expect(decryptSecret(encryptSecret(secret, KEY), KEY)).toBe(secret)
  })

  it('produces a different ciphertext every time, so identical secrets are not identifiable', () => {
    // Two Kwamis with the same phrase must not have visibly identical rows.
    expect(encryptSecret('same', KEY)).not.toBe(encryptSecret('same', KEY))
  })

  it('is versioned, so the scheme can be rotated later', () => {
    expect(encryptSecret('x', KEY).startsWith('v1.')).toBe(true)
  })

  it('refuses the wrong key rather than returning garbage', () => {
    const envelope = encryptSecret('the moon remembers', KEY)
    expect(() => decryptSecret(envelope, OTHER_KEY)).toThrow()
  })

  it('detects tampering, because GCM authenticates the ciphertext', () => {
    const envelope = encryptSecret('the moon remembers', KEY)
    const parts = envelope.split('.')
    // Flip one nibble of the ciphertext.
    parts[3] = (parts[3][0] === '0' ? '1' : '0') + parts[3].slice(1)
    expect(() => decryptSecret(parts.join('.'), KEY)).toThrow()
  })

  it('rejects a malformed envelope', () => {
    expect(() => decryptSecret('not-an-envelope', KEY)).toThrow(/Malformed/)
    expect(() => decryptSecret('v2.aa.bb.cc', KEY)).toThrow(/Malformed/)
  })

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encryptSecret('x', 'abcd')).toThrow(/32 bytes/)
  })
})

describe('safeEqual', () => {
  it('compares equal strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
  })

  it('rejects different strings without throwing on a length mismatch', () => {
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcdef')).toBe(false)
    expect(safeEqual('', 'x')).toBe(false)
  })
})

describe('randomToken', () => {
  it('is URL-safe and unique', () => {
    const a = randomToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a).not.toBe(randomToken())
  })
})
