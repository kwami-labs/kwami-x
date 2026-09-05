import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { createLiveKitToken, isLiveKitConfigured } from '~~/server/utils/livekit'
import { assertNotDemo } from '~~/server/utils/demo'
import { assertSessionOpen } from '~~/server/utils/session-window'

/**
 * Issue a LiveKit token for a session the caller actually owns.
 *
 * Reports `transport: 'browser'` rather than failing when LiveKit is not
 * configured, so the client falls back to the Web Speech path instead of the
 * session dying. That fallback is what makes the game playable on a fresh
 * clone; LiveKit is the upgrade, not the prerequisite.
 *
 * The token is scoped to this session's room and expires in five minutes —
 * long enough to connect, short enough that a leaked token is worthless by the
 * time the session it belongs to has ended.
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
    .select('id, player_id, player_wallet, room, outcome, started_at, expires_at')
    .eq('id', id)
    .maybeSingle()

  if (!session) throw createError({ statusCode: 404, statusMessage: 'No such session.' })
  if (session.player_id !== user.id)
    throw createError({ statusCode: 403, statusMessage: 'Not your session.' })
  const window = await assertSessionOpen(db, session)
  if (!session.room) throw createError({ statusCode: 409, statusMessage: 'Session has no room.' })

  const config = useRuntimeConfig()
  return {
    transport: 'livekit' as const,
    url: config.public.livekitUrl as string,
    room: session.room,
    token: createLiveKitToken({
      room: session.room,
      identity: `player-${session.player_wallet}`,
      name: session.player_wallet.slice(0, 8),
      // Scoped to what is LEFT of the session, not a flat five minutes. A token minted at
      // 2:50 used to stay valid for another five, which is voice access after the clock ran
      // out — plus a grace so a token issued at the boundary can still finish connecting.
      ttlSeconds: Math.ceil((window.expiresAt - window.now) / 1000) + 30,
    }),
  }
})
