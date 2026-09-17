import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { createLiveKitToken, isLiveKitConfigured, livekitAgentName } from '~~/server/utils/livekit'
import { assertNotDemo } from '~~/server/utils/demo'
import { assertSessionOpen } from '~~/server/utils/session-window'
import { kwamiEnergy } from '~~/server/utils/energy'
import { affordableVoiceSeconds } from '#shared/energy/cost'

/**
 * Issue a LiveKit token for a session the caller actually owns.
 *
 * Reports `transport: 'browser'` rather than failing when LiveKit is not
 * configured, so the client falls back to the Web Speech path instead of the
 * session dying. That fallback is what makes the game playable on a fresh
 * clone; LiveKit is the upgrade, not the prerequisite.
 *
 * The token is scoped to this session's room, and its lifetime is the smaller
 * of what is left on the clock and what the Kwami's energy can pay for. That
 * second bound is the only prepaid limit a stream can actually be held to:
 * nothing in this process is watching the room second by second, so the moment
 * to refuse is the moment the credential is issued.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')!

  if (!isLiveKitConfigured()) {
    return { transport: 'browser' as const }
  }

  const db = serviceClient()
  const { data: session } = await db
    .from('game_sessions')
    .select('id, kwami_id, player_id, player_wallet, room, outcome, started_at, expires_at')
    .eq('id', id)
    .maybeSingle()

  if (!session) throw createError({ statusCode: 404, statusMessage: 'No such session.' })
  if (session.player_id !== user.id)
    throw createError({ statusCode: 403, statusMessage: 'Not your session.' })
  const window = await assertSessionOpen(db, session)
  if (!session.room) throw createError({ statusCode: 409, statusMessage: 'Session has no room.' })

  // Scoped to what is LEFT of the session, not a flat five minutes. A token minted at
  // 2:50 used to stay valid for another five, which is voice access after the clock ran
  // out — plus a grace so a token issued at the boundary can still finish connecting.
  const remainingSecs = Math.ceil((window.expiresAt - window.now) / 1000)
  const affordable = affordableVoiceSeconds(await kwamiEnergy(session.kwami_id, db))

  // A starving Kwami sends the player back to the browser path rather than
  // failing. They paid for three minutes; losing them because the *owner*
  // underfunded the Kwami would charge a challenger for someone else's
  // mistake. `reply.post.ts` takes the same position for the same reason.
  if (affordable <= 0) return { transport: 'browser' as const, reason: 'starving' as const }

  const config = useRuntimeConfig()
  return {
    transport: 'livekit' as const,
    url: config.public.livekitUrl as string,
    room: session.room,
    secondsLeft: Math.min(remainingSecs, affordable),
    token: createLiveKitToken({
      room: session.room,
      identity: `player-${session.player_wallet}`,
      name: session.player_wallet.slice(0, 8),
      ttlSeconds: Math.min(remainingSecs, affordable) + 30,
      agentName: livekitAgentName(),
      // The session id and nothing else. The player can decode their own token,
      // so the persona and the phrase it is guarding travel over
      // `/api/internal/kwamis/:id/runtime` instead, where only the worker can read them.
      // A JSON object, not the bare id: `resolve_kwami_id` parses this claim
      // as JSON and reads `kwami_id` from it, and anything else resolves to
      // nothing — a worker that joins the room and never learns what it is
      // guarding.
      agentMetadata: JSON.stringify({ kwami_id: session.id }),
    }),
  }
})
