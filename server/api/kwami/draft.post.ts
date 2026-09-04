import { z } from 'zod'
import { generateSalt, secretHash, validateSecret } from '#shared/game/secret'
import {
  MAX_PAYOUT_BPS,
  MAX_SESSION_DURATION_SECS,
  MIN_PAYOUT_BPS,
  MIN_SESSION_DURATION_SECS,
} from '#shared/game/constants'
import { encryptSecret } from '~~/server/utils/crypto'
import { assertNotDemo } from '~~/server/utils/demo'
import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { isValidAddress } from '~~/server/utils/solana'

const Body = z.object({
  name: z.string().min(2).max(48),
  tagline: z.string().max(160).default(''),
  persona: z.string().max(2000).default(''),
  renderer: z.enum(['blob-xyz', 'crystal-ball', 'orbital-shards', 'stars-genesis', 'black-hole']),
  /** The phrase a challenger has to say. Never stored in plaintext. */
  secret: z.string().min(1).max(200),
  hints: z.array(z.string().max(140)).max(5).default([]),
  ticketPriceLamports: z.coerce.bigint().min(0n),
  ticketPriceUsdc: z.coerce.bigint().min(0n),
  sessionDuration: z.number().int().min(MIN_SESSION_DURATION_SECS).max(MAX_SESSION_DURATION_SECS),
  payoutBps: z.number().int().min(MIN_PAYOUT_BPS).max(MAX_PAYOUT_BPS),
  resolutionMode: z.enum(['commit-reveal', 'attested']),
  authorWallet: z.string(),
  appearance: z.record(z.string(), z.unknown()).default({}),
  voice: z.record(z.string(), z.unknown()).default({}),
})

/**
 * Step 1 of minting: commit to a secret and get back its hash.
 *
 * The plaintext secret is sent here because something server-side has to know
 * it — the voice agent cannot decide that a challenger said the phrase without
 * it. It is encrypted with a key that lives only in the process environment
 * (see `server/utils/crypto.ts`), so a database dump on its own is inert.
 *
 * The salt is generated *here* rather than in the browser. A client-chosen salt
 * would let a malicious author commit to a hash they can later claim was over a
 * different phrase, since only they would know what went into it.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  const user = await requireUser(event)
  const body = Body.parse(await readBody(event))
  const config = useRuntimeConfig()

  if (!isValidAddress(body.authorWallet)) {
    throw createError({ statusCode: 400, statusMessage: 'Malformed author wallet.' })
  }
  if (body.ticketPriceLamports === 0n && body.ticketPriceUsdc === 0n) {
    throw createError({ statusCode: 400, statusMessage: 'Set a ticket price in at least one asset.' })
  }

  const secretCheck = validateSecret(body.secret)
  if (!secretCheck.valid) throw createError({ statusCode: 400, statusMessage: secretCheck.reason })

  if (!config.secretEncryptionKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'NUXT_SECRET_ENCRYPTION_KEY is not configured; refusing to store a secret in plaintext.',
    })
  }

  const salt = generateSalt()
  const hash = await secretHash(body.secret, salt)

  const db = serviceClient()
  const { data: kwami, error } = await db
    .from('kwamis')
    .insert({
      author_id: user.id,
      author_wallet: body.authorWallet,
      owner_wallet: body.authorWallet,
      name: body.name,
      tagline: body.tagline,
      persona: body.persona,
      renderer: body.renderer,
      appearance: body.appearance,
      voice: body.voice,
      hints: body.hints,
      state: 'draft',
      resolution_mode: body.resolutionMode,
      secret_hash: hash,
      ticket_price_lamports: body.ticketPriceLamports.toString(),
      ticket_price_usdc: body.ticketPriceUsdc.toString(),
      session_duration: body.sessionDuration,
      payout_bps: body.payoutBps,
    })
    .select('id')
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const { error: secretError } = await db.from('kwami_secrets').insert({
    kwami_id: kwami.id,
    ciphertext: encryptSecret(body.secret, config.secretEncryptionKey),
    salt,
  })
  if (secretError) {
    // A draft with no secret is unusable and would be silently broken later,
    // so roll it back rather than leave a landmine in the table.
    await db.from('kwamis').delete().eq('id', kwami.id)
    throw createError({ statusCode: 500, statusMessage: secretError.message })
  }

  return { draftId: kwami.id as string, secretHash: hash }
})
