import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { assertNotDemo } from '~~/server/utils/demo'

/**
 * The player's own view of a session, including its transcript.
 *
 * Used to rehydrate after a reload — someone whose tab crashed at 1:40 should
 * come back to the same clock and the same conversation, not a lost ticket.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')!

  const db = serviceClient()
  const { data: session, error } = await db
    .from('game_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!session) throw createError({ statusCode: 404, statusMessage: 'No such session.' })
  if (session.player_id !== user.id) throw createError({ statusCode: 403, statusMessage: 'Not your session.' })

  const { data: turns } = await db
    .from('transcript_turns')
    .select('role, text, at_ms, confidence')
    .eq('session_id', id)
    .order('at_ms', { ascending: true })

  return {
    session: {
      id: session.id,
      kwamiMint: session.kwami_mint,
      account: session.account,
      nonce: Number(session.nonce),
      asset: session.asset,
      startedAt: Math.floor(new Date(session.started_at).getTime() / 1000),
      expiresAt: Math.floor(new Date(session.expires_at).getTime() / 1000),
      outcome: session.outcome,
      room: session.room,
    },
    transcript: (turns ?? []).map((t) => ({
      role: t.role,
      text: t.text,
      at: t.at_ms,
      confidence: t.confidence ?? undefined,
    })),
  }
})
