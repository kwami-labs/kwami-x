import { z } from 'zod'
import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { loadSecret } from '~~/server/utils/kwami-secret'
import { respond } from '~~/server/utils/kwami-brain'
import { assertNotDemo } from '~~/server/utils/demo'
import { assertSessionOpen } from '~~/server/utils/session-window'
import { readVoiceConfig } from '#shared/kwami/voice'
import { spendKwamiEnergy } from '~~/server/utils/energy'

const Body = z.object({
  utterance: z.string().min(1).max(2000),
  /** Milliseconds since the session started, for the clock-aware taunts. */
  at: z.number().int().min(0),
})

/**
 * Ask the Kwami to answer.
 *
 * Runs server-side because the persona prompt contains the secret — the model
 * needs it to steer *around* it, and the browser must never see it.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  const body = Body.parse(await readBody(event))

  const db = serviceClient()
  const { data: session } = await db
    .from('game_sessions')
    .select('id, kwami_id, player_id, outcome, started_at, expires_at')
    .eq('id', id)
    .maybeSingle()

  if (!session) throw createError({ statusCode: 404, statusMessage: 'No such session.' })
  if (session.player_id !== user.id)
    throw createError({ statusCode: 403, statusMessage: 'Not your session.' })
  // Closes the session on the server clock. Answering after time is up is free reconnaissance:
  // the Kwami's replies are the main channel a player reads the secret's shape from.
  await assertSessionOpen(db, session)

  const { data: kwami } = await db.from('kwamis').select('persona, voice').eq('id', session.kwami_id).single()

  /**
   * Charge the Kwami for the reply it is about to give.
   *
   * A refusal does not end the session. The challenger paid for these minutes
   * before anyone knew the pot's owner had underfunded it, and taking the
   * remaining time away from them would be charging one person for another's
   * mistake. Instead the Kwami drops to its scripted deflector — the same thing
   * a model outage does — and, having hit zero, is now `starving`, so it sells
   * nobody else a ticket until it is topped up.
   */
  const spend = await spendKwamiEnergy(session.kwami_id, { kind: 'reply' }, 'reply', { session: id }, db)

  const { data: history } = await db
    .from('transcript_turns')
    .select('role, text')
    .eq('session_id', id)
    .order('at_ms', { ascending: true })
    .limit(30)

  const { secret } = await loadSecret(session.kwami_id)
  const secondsLeft = Math.max(0, (new Date(session.expires_at).getTime() - Date.now()) / 1000)

  const voice = readVoiceConfig(kwami?.voice as Record<string, unknown> | null)

  const text = await respond({
    persona: kwami?.persona ?? '',
    secret,
    gameId: voice.gameId,
    guardStrength: voice.guardStrength,
    history: (history ?? []) as Array<{ role: 'player' | 'kwami'; text: string }>,
    traits: voice.traits,
    utterance: body.utterance,
    secondsLeft,
    forceScripted: !spend.ok,
  })

  await db.from('transcript_turns').insert({
    session_id: id,
    role: 'kwami',
    text,
    at_ms: body.at,
  })

  // `starved` tells the player's UI why the Kwami suddenly went terse, rather
  // than leaving them to conclude it simply got worse at the game.
  return { text, starved: !spend.ok }
})
