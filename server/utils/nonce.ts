import { randomToken } from './crypto'

/**
 * Single-use nonces for wallet sign-in.
 *
 * Backed by Nitro's storage layer rather than a module-level `Map`, because a
 * serverless deployment spreads requests across instances: a nonce issued by
 * one worker has to be redeemable by another, and a replayed nonce has to be
 * rejected by all of them.
 *
 * `consume` is the only read path, and it deletes as it reads — a nonce that
 * has been spent once can never be spent again, which is the entire point.
 */

const TTL_MS = 5 * 60 * 1000

interface NonceRecord {
  nonce: string
  issuedAt: number
  /** Optional binding, so a nonce minted for one wallet cannot be used by another. */
  address?: string
}

function store() {
  return useStorage<NonceRecord>('auth-nonce')
}

export async function issueNonce(address?: string): Promise<string> {
  const nonce = randomToken(16)
  await store().setItem(nonce, { nonce, issuedAt: Date.now(), address })
  return nonce
}

export interface NonceCheck {
  ok: boolean
  reason?: string
}

/** Redeem a nonce. Always deletes it, whether or not it turned out to be valid. */
export async function consumeNonce(nonce: string, address?: string): Promise<NonceCheck> {
  const record = await store().getItem(nonce)
  await store().removeItem(nonce)

  if (!record) return { ok: false, reason: 'Unknown or already-used nonce.' }
  if (Date.now() - record.issuedAt > TTL_MS) return { ok: false, reason: 'Sign-in request expired.' }
  if (record.address && address && record.address !== address) {
    return { ok: false, reason: 'Nonce was issued for a different wallet.' }
  }
  return { ok: true }
}
