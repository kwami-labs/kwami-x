import { z } from 'zod'
import { matchSecret, secretPreimage } from '#shared/game/secret'
import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { loadSecret } from '~~/server/utils/kwami-secret'
import { signWinAttestation } from '~~/server/utils/attest'
import { assertNotDemo } from '~~/server/utils/demo'
import { assertSessionOpen, clampTurnOffset, TURN_ARRIVAL_GRACE_MS } from '~~/server/utils/session-window'

const Body = z.object({
  role: z.enum(['player', 'kwami']),
  text: z.string().min(1).max(2000),
  /** Milliseconds since the session's on-chain `started_at`. */
  at: z.number().int().min(0),
  confidence: z.number().min(0).max(1).optional(),
})

/**
 * Record a spoken turn and decide whether it won.
 *
 * This is the only place the secret is compared against anything, and it runs
 * server-side for a reason: shipping the phrase to the browser so the client
 * could check locally would mean every challenger could read it out of memory
 * before saying a word.
 *
 * A win returns the material the player needs to claim on chain — the
 * pre-image for commit-reveal, an oracle signature for attested mode. That is
 * the one and only circumstance under which either leaves this server.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  const user = await requireUser(event)
  const sessionId = getRouterParam(event, 'id')!
  const body = Body.parse(await readBody(event))

  const db = serviceClient()
  const { data: session, error } = await db
    .from('game_sessions')
    .select(
      'id, kwami_id, kwami_mint, player_id, player_wallet, account, nonce, outcome, started_at, expires_at',
    )
    .eq('id', sessionId)
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!session) throw createError({ statusCode: 404, statusMessage: 'No such session.' })
  if (session.player_id !== user.id)
    throw createError({ statusCode: 403, statusMessage: 'Not your session.' })

  // The server's clock closes the session, not the client's `at`. Without this the only
  // deadline check was against a number the browser chose, so reporting `at: 0` forever kept a
  // session open indefinitely — unlimited turns and unlimited reads of the similarity score
  // below, which together give up the secret.
  const window = await assertSessionOpen(db, session, { graceMs: TURN_ARRIVAL_GRACE_MS })
  const at = clampTurnOffset(body.at, window)

  await db.from('transcript_turns').insert({
    session_id: session.id,
    role: body.role,
    text: body.text,
    at_ms: at,
    confidence: body.confidence,
  })

  // Only the player can win.
  if (body.role !== 'player') {
    return { won: false, outcome: session.outcome }
  }

  // The utterance timestamp decides, not arrival time. A phrase spoken at
  // 2:59.4 wins even if the transcript event lands after the clock ran out —
  // network latency is not something a player should lose to.
  if (at > window.deadlineMs) {
    return { won: false, outcome: 'pending', lateBy: at - window.deadlineMs }
  }

  const { secret, salt } = await loadSecret(session.kwami_id)
  const match = matchSecret(body.text, secret)
  if (!match.matched) {
    return { won: false, outcome: 'pending', score: match.score }
  }

  const { data: kwami } = await db
    .from('kwamis')
    .select('resolution_mode')
    .eq('id', session.kwami_id)
    .single()

  await db
    .from('game_sessions')
    .update({ outcome: 'won', matched_text: match.matchedText, match_score: match.score })
    .eq('id', session.id)

  const claim =
    kwami?.resolution_mode === 'attested'
      ? {
          mode: 'attested' as const,
          ...(await signWinAttestation(session.account, session.player_wallet)),
        }
      : {
          mode: 'commit-reveal' as const,
          // Exactly the bytes the program will hash. Handing over the raw
          // secret and salt separately would invite the client to re-derive it
          // and get the encoding subtly wrong.
          preimage: secretPreimage(secret, salt),
        }

  return {
    won: true,
    outcome: 'won',
    score: match.score,
    matchedText: match.matchedText,
    nonce: Number(session.nonce),
    claim,
  }
})
