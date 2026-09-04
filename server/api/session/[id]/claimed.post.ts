import { z } from 'zod'
import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { connection } from '~~/server/utils/solana'
import { assertNotDemo } from '~~/server/utils/demo'

const Body = z.object({ signature: z.string().min(64).max(120) })

/**
 * Record that a win was actually claimed on chain.
 *
 * Bookkeeping only — the money already moved when the program ran. This exists
 * so the receipt page can link to the settlement transaction and the indexer
 * has an anchor point, not because anything here authorises a payout.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  const { signature } = Body.parse(await readBody(event))

  const db = serviceClient()
  const { data: session } = await db
    .from('game_sessions')
    .select('id, player_id')
    .eq('id', id)
    .maybeSingle()

  if (!session) throw createError({ statusCode: 404, statusMessage: 'No such session.' })
  if (session.player_id !== user.id) throw createError({ statusCode: 403, statusMessage: 'Not your session.' })

  const tx = await connection().getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
  if (!tx || tx.meta?.err) {
    throw createError({ statusCode: 400, statusMessage: 'That claim transaction did not succeed.' })
  }

  await db.from('game_sessions').update({ tx_claim: signature }).eq('id', id)
  return { ok: true }
})
