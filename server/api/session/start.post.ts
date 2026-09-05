import { z } from 'zod'
import { PublicKey } from '@solana/web3.js'
import { assertNotDemo } from '~~/server/utils/demo'
import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { connection, isValidAddress } from '~~/server/utils/solana'
import { findSessionPda } from '#shared/solana/pda'
import { decodeSessionAccount } from '#shared/solana/accounts'
import { clampDuration } from '#shared/game/session'

const Body = z.object({
  mint: z.string(),
  /** The `start_session_*` transaction the player already sent. */
  signature: z.string().min(64).max(120),
  nonce: z.coerce.number().int().min(0),
  asset: z.enum(['SOL', 'USDC']),
})

/**
 * Open a challenge, after the ticket has been paid.
 *
 * The order is deliberate: the player pays on chain *first*, then registers the
 * session here. Doing it the other way — issue the room, collect payment
 * afterwards — would hand out three minutes of paid voice infrastructure to
 * anyone willing to abandon the transaction.
 *
 * The clock the player sees comes from the chain's `started_at`, not from this
 * server's wall time, so the countdown and settlement cannot disagree.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  const user = await requireUser(event)
  const body = Body.parse(await readBody(event))
  const config = useRuntimeConfig()

  if (!isValidAddress(body.mint)) throw createError({ statusCode: 400, statusMessage: 'Malformed mint.' })

  const db = serviceClient()
  const { data: kwami, error } = await db
    .from('kwamis')
    .select('id, mint, state, session_duration, ticket_price_lamports, ticket_price_usdc')
    .eq('mint', body.mint)
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!kwami) throw createError({ statusCode: 404, statusMessage: 'No such Kwami.' })
  if (kwami.state !== 'live') {
    throw createError({ statusCode: 409, statusMessage: 'This Kwami is not accepting challengers.' })
  }

  const tx = await connection().getTransaction(body.signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
  if (!tx) throw createError({ statusCode: 404, statusMessage: 'Ticket transaction not found yet.' })
  if (tx.meta?.err) throw createError({ statusCode: 400, statusMessage: 'The ticket transaction failed.' })

  // The fee payer is always the first static account key, and for a ticket
  // transaction that is the player.
  const feePayer = tx.transaction.message.getAccountKeys().staticAccountKeys[0]
  if (!feePayer) throw createError({ statusCode: 400, statusMessage: 'Malformed ticket transaction.' })
  const player = new PublicKey(feePayer)
  const [sessionPda] = findSessionPda(
    new PublicKey(body.mint),
    player,
    BigInt(body.nonce),
    new PublicKey(config.public.kwamiProgramId as string),
  )

  const keys = tx.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58())
  if (!keys.includes(sessionPda.toBase58())) {
    throw createError({ statusCode: 400, statusMessage: 'That transaction did not open this session.' })
  }

  // Listing the PDA is not proof of payment — any transaction can name a read-only account
  // without calling anything. The Session ACCOUNT is the proof: the program creates it only
  // inside start_session_sol/start_session_usdc, after the transfers have gone through. Read it
  // and believe it over both the client and the index.
  const programId = new PublicKey(config.public.kwamiProgramId as string)
  const sessionInfo = await connection().getAccountInfo(sessionPda, 'confirmed')
  if (!sessionInfo) {
    throw createError({ statusCode: 402, statusMessage: 'No ticket was paid for this session.' })
  }
  if (!sessionInfo.owner.equals(programId)) {
    throw createError({ statusCode: 402, statusMessage: "That session account is not the Kwami program's." })
  }

  const onChain = decodeSessionAccount(new Uint8Array(sessionInfo.data))
  if (onChain.player !== player.toBase58() || onChain.nonce !== BigInt(body.nonce)) {
    throw createError({ statusCode: 403, statusMessage: 'That ticket belongs to a different challenge.' })
  }
  if (onChain.kwami !== body.mint) {
    throw createError({ statusCode: 400, statusMessage: 'That ticket is for a different Kwami.' })
  }
  if (onChain.outcome !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'That challenge has already been settled.' })
  }

  // Window and price come from the chain too. The asset used to be whatever the client
  // declared and the amount was read back out of the index, so both could be falsified.
  const startedAt = Number(onChain.startedAt) * 1000
  const duration = clampDuration(kwami.session_duration)
  const asset = onChain.asset
  const ticketAmount = onChain.ticketAmount

  const { data: session, error: insertError } = await db
    .from('game_sessions')
    .insert({
      kwami_id: kwami.id,
      kwami_mint: kwami.mint,
      player_id: user.id,
      player_wallet: player.toBase58(),
      account: sessionPda.toBase58(),
      nonce: body.nonce,
      asset,
      ticket_amount: ticketAmount.toString(),
      started_at: new Date(startedAt).toISOString(),
      expires_at: new Date(Number(onChain.expiresAt) * 1000).toISOString(),
      outcome: 'pending',
      room: `kwami-${kwami.mint.slice(0, 12)}-${body.nonce}`,
      tx_start: body.signature,
    })
    .select('id, account, started_at, expires_at, room, nonce')
    .single()

  if (insertError) {
    if (insertError.message.includes('duplicate')) {
      throw createError({ statusCode: 409, statusMessage: 'That session is already open.' })
    }
    throw createError({ statusCode: 500, statusMessage: insertError.message })
  }

  return {
    session: {
      id: session.id,
      account: session.account,
      nonce: Number(session.nonce),
      startedAt: Math.floor(new Date(session.started_at).getTime() / 1000),
      expiresAt: Math.floor(new Date(session.expires_at).getTime() / 1000),
      room: session.room,
      durationSecs: duration,
    },
  }
})
