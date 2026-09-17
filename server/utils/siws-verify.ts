import bs58 from 'bs58'
import type { H3Event } from 'h3'
import { parseSiwsMessage, validateSiwsMessage, SOLANA_CHAIN_IDS } from '#shared/auth/siws'
import type { Cluster } from '#shared/solana/constants'
import { consumeNonce } from './nonce'
import { verifySolanaSignature } from './solana'

export interface SignedSiws {
  /** The exact message the wallet displayed. */
  message: string
  /** base58-encoded ed25519 signature. */
  signature: string
  address: string
}

export interface VerifySiwsOptions {
  /**
   * Hostnames this deployment answers on.
   *
   * Defaults to `siteUrl` alone. Callers that have the request should also pass
   * the Host header so a tunnel or `127.0.0.1` login is not rejected for
   * disagreeing with a localhost `siteUrl`.
   */
  expectedDomains?: string | readonly string[]
}

/**
 * Verify a Sign-In-With-Solana message and return the address it proves.
 *
 * Two routes need this and they must agree completely: `/api/auth/verify-solana`
 * turns a signature into a session, and `/api/me/wallet` attaches an address to
 * a session that already exists. If the two ever diverged — a different domain
 * check, a nonce consumed in one and not the other — the weaker of the pair
 * would become the way in, so there is exactly one implementation.
 *
 * The order of checks is deliberate. Parsing and field validation run before
 * signature verification so a malformed or replayed request is rejected without
 * spending a curve operation, and the nonce is consumed before the signature is
 * checked so a burst of retries with one nonce cannot be used to grind at it.
 */
export async function verifySignedSiws(
  input: SignedSiws,
  opts: VerifySiwsOptions = {},
): Promise<{ address: string }> {
  const config = useRuntimeConfig()

  const parsed = parseSiwsMessage(input.message)
  if (!parsed) throw createError({ statusCode: 400, statusMessage: 'Malformed sign-in message.' })

  // The address in the signed message is authoritative; the one in the body is
  // only a hint. Trusting the body would let a caller claim someone else's
  // signature belongs to their own wallet.
  if (parsed.address !== input.address) {
    throw createError({ statusCode: 400, statusMessage: 'Address does not match the signed message.' })
  }

  const nonceCheck = await consumeNonce(parsed.nonce, parsed.address)
  if (!nonceCheck.ok) throw createError({ statusCode: 400, statusMessage: nonceCheck.reason })

  const siteHost = new URL(config.public.siteUrl as string).host
  const expectedDomain = opts.expectedDomains ?? siteHost
  const cluster = (config.public.solanaCluster as Cluster) || 'devnet'

  const validation = validateSiwsMessage(parsed, {
    expectedDomain,
    expectedNonce: parsed.nonce,
    expectedAddress: parsed.address,
    expectedChainId: SOLANA_CHAIN_IDS[cluster],
  })
  if (!validation.valid) throw createError({ statusCode: 400, statusMessage: validation.reason })

  if (!verifySolanaSignature(input.message, bs58.decode(input.signature), parsed.address)) {
    throw createError({ statusCode: 401, statusMessage: 'Signature does not verify.' })
  }

  return { address: parsed.address }
}

/** Hostnames the SIWS domain check should accept for this request. */
export function siwsExpectedDomains(event: H3Event): string[] {
  const config = useRuntimeConfig()
  const siteHost = new URL(config.public.siteUrl as string).host
  const requestHost = getRequestURL(event).host
  return siteHost === requestHost ? [siteHost] : [siteHost, requestHost]
}
