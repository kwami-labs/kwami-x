import { z } from 'zod'
import bs58 from 'bs58'
import { parseSiwsMessage, validateSiwsMessage } from '#shared/auth/siws'
import { consumeNonce } from '~~/server/utils/nonce'
import { verifySolanaSignature } from '~~/server/utils/solana'

const Body = z.object({
  /** The exact message the wallet displayed. */
  message: z.string().min(1).max(4000),
  /** base58-encoded ed25519 signature. */
  signature: z.string().min(1).max(200),
  address: z.string().min(32).max(48),
})

/**
 * Exchange a signed SIWS message for a Supabase session.
 *
 * The order of checks matters. Parsing and field validation run *before*
 * signature verification so a malformed or replayed request is rejected
 * without spending a curve operation, and the nonce is consumed before the
 * signature is checked so a burst of retries with one nonce cannot be used to
 * grind at it.
 */
export default defineEventHandler(async (event) => {
  const body = Body.parse(await readBody(event))
  const config = useRuntimeConfig()

  const parsed = parseSiwsMessage(body.message)
  if (!parsed) throw createError({ statusCode: 400, statusMessage: 'Malformed sign-in message.' })

  // The address in the signed message is authoritative; the one in the body is
  // only a hint. Trusting the body would let a caller claim someone else's
  // signature belongs to their own wallet.
  if (parsed.address !== body.address) {
    throw createError({ statusCode: 400, statusMessage: 'Address does not match the signed message.' })
  }

  const nonceCheck = await consumeNonce(parsed.nonce, parsed.address)
  if (!nonceCheck.ok) throw createError({ statusCode: 400, statusMessage: nonceCheck.reason })

  const expectedDomain = new URL(config.public.siteUrl as string).host
  const validation = validateSiwsMessage(parsed, {
    expectedDomain,
    expectedNonce: parsed.nonce,
    expectedAddress: parsed.address,
  })
  if (!validation.valid) throw createError({ statusCode: 400, statusMessage: validation.reason })

  const signature = bs58.decode(body.signature)
  if (!verifySolanaSignature(body.message, signature, parsed.address)) {
    throw createError({ statusCode: 401, statusMessage: 'Signature does not verify.' })
  }

  return issueWalletSession(event, {
    chain: 'solana',
    address: parsed.address,
  })
})
