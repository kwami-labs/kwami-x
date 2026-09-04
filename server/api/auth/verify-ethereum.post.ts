import { z } from 'zod'
import { parseSiweMessage, validateSiweMessage } from '#shared/auth/siwe'
import { consumeNonce } from '~~/server/utils/nonce'
import { recoverEthAddress } from '~~/server/utils/eth'

const Body = z.object({
  message: z.string().min(1).max(4000),
  /** 0x-prefixed 65-byte signature from `personal_sign`. */
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
})

/**
 * Exchange a signed SIWE message for a Supabase session.
 *
 * MetaMask logs a person in but never holds a Kwami — the pot lives on Solana.
 * The session records `chain: 'ethereum'` so the UI can prompt for a Solana
 * wallet at the moment money is actually needed, rather than at the door.
 */
export default defineEventHandler(async (event) => {
  const body = Body.parse(await readBody(event))
  const config = useRuntimeConfig()

  const parsed = parseSiweMessage(body.message)
  if (!parsed) throw createError({ statusCode: 400, statusMessage: 'Malformed sign-in message.' })

  const claimed = body.address.toLowerCase()
  if (parsed.address.toLowerCase() !== claimed) {
    throw createError({ statusCode: 400, statusMessage: 'Address does not match the signed message.' })
  }

  const nonceCheck = await consumeNonce(parsed.nonce, parsed.address)
  if (!nonceCheck.ok) throw createError({ statusCode: 400, statusMessage: nonceCheck.reason })

  const expectedDomain = new URL(config.public.siteUrl as string).host
  const validation = validateSiweMessage(parsed, { expectedDomain, expectedNonce: parsed.nonce })
  if (!validation.valid) throw createError({ statusCode: 400, statusMessage: validation.reason })

  const recovered = recoverEthAddress(body.message, body.signature)
  if (!recovered || recovered.toLowerCase() !== claimed) {
    throw createError({ statusCode: 401, statusMessage: 'Signature does not verify.' })
  }

  return issueWalletSession(event, { chain: 'ethereum', address: claimed })
})
