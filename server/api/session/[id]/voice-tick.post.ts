import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { assertNotDemo } from '~~/server/utils/demo'
import { assertSessionOpen } from '~~/server/utils/session-window'
import { kwamiEnergy } from '~~/server/utils/energy'
import { affordableVoiceSeconds } from '#shared/energy/cost'

/**
 * Bill the voice time this session has run up since the last tick.
 *
 * The heartbeat half of the prepaid ceiling. The token's lifetime bounds what
 * an unmetered client could take; this is what actually takes it, so a session
 * that runs its full three minutes has paid for three minutes rather than for
 * whatever its last request happened to admit to.
 *
 * It reads no duration from the body on purpose. The person on the microphone
 * is the challenger and the balance being spent is the *owner's* — a client
 * that could name its own number would be a client that could drain someone
 * else's Kwami by holding down a heartbeat. `charge_session_voice` computes the
 * amount from the session's own start time, which came off the chain.
 *
 * Running dry is a 200, not a 402. The challenger paid for this window and
 * keeps it: `starved` sends them back to the browser voice path, which costs
 * nothing to run, and the game goes on — the same fallback `reply.post.ts`
 * takes when a reply cannot be paid for.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')!

  const db = serviceClient()
  const { data: session } = await db
    .from('game_sessions')
    .select('id, kwami_id, player_id, outcome, started_at, expires_at')
    .eq('id', id)
    .maybeSingle()

  if (!session) throw createError({ statusCode: 404, statusMessage: 'No such session.' })
  if (session.player_id !== user.id)
    throw createError({ statusCode: 403, statusMessage: 'Not your session.' })
  await assertSessionOpen(db, session)

  const { data, error } = await db.rpc('charge_session_voice', { p_session_id: id })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  // Null is the function's way of saying the Kwami could not afford it, which
  // is a normal outcome here and not a failure.
  const balance = data === null ? await kwamiEnergy(session.kwami_id, db) : BigInt(data)

  return {
    // A decimal string, like every other balance on the wire: a micro-energy
    // figure past 2^53 would arrive as a different number than it left as.
    balance: balance.toString(),
    secondsLeft: affordableVoiceSeconds(balance),
    starved: data === null,
  }
})
