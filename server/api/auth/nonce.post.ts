import { z } from 'zod'
import { issueNonce } from '~~/server/utils/nonce'
import { isValidAddress } from '~~/server/utils/solana'

const Body = z.object({
  /** Optional — binds the nonce to one wallet so it cannot be handed to another. */
  address: z.string().optional(),
})

/**
 * Issue a single-use sign-in nonce.
 *
 * Unauthenticated by design: this is the first step of logging in. It is
 * cheap, stores 40 bytes with a five-minute TTL, and hands back nothing an
 * attacker can use on its own — a nonce is only worth anything paired with a
 * signature from the wallet it names.
 */
export default defineEventHandler(async (event) => {
  const body = Body.parse(await readBody(event).catch(() => ({})))
  if (body.address && !isValidAddress(body.address)) {
    throw createError({ statusCode: 400, statusMessage: 'Malformed wallet address.' })
  }
  const nonce = await issueNonce(body.address)
  return { nonce, expiresInSeconds: 300 }
})
