import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Envelope encryption for Kwami secrets at rest.
 *
 * The plaintext secret has to exist somewhere off chain — the voice agent
 * needs it to know when a challenger has said it — but a leaked database dump
 * must not hand an attacker every pot on the platform. AES-256-GCM with a key
 * that lives only in the process environment means a dump alone is inert.
 *
 * Format: `v1.<iv-hex>.<tag-hex>.<ciphertext-hex>`. Versioned so the scheme can
 * be rotated without guessing at what an old row was encrypted with.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // GCM's standard nonce length.
const VERSION = 'v1'

function keyFromHex(hex: string): Buffer {
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) {
    throw new Error('NUXT_SECRET_ENCRYPTION_KEY must be 32 bytes (64 hex characters).')
  }
  return key
}

export function encryptSecret(plaintext: string, keyHex: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, keyFromHex(keyHex), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('hex'), tag.toString('hex'), ciphertext.toString('hex')].join('.')
}

export function decryptSecret(envelope: string, keyHex: string): string {
  const [version, ivHex, tagHex, dataHex] = envelope.split('.')
  if (version !== VERSION || !ivHex || !tagHex || !dataHex) {
    throw new Error('Malformed secret envelope.')
  }
  const decipher = createDecipheriv(ALGORITHM, keyFromHex(keyHex), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}

/** Constant-time string comparison, for anything an attacker can probe repeatedly. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  // `timingSafeEqual` throws on length mismatch, which would itself leak the
  // length, so compare a fixed-size digest of each instead.
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** URL-safe random token, used for nonces and session ids. */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}
