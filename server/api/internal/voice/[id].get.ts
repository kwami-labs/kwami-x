import { serviceClient } from '~~/server/utils/supabase'
import { loadSecret } from '~~/server/utils/kwami-secret'
import { assertNotDemo } from '~~/server/utils/demo'
import { readVoiceConfig } from '#shared/kwami/voice'

/**
 * What the voice worker needs in order to speak as a Kwami.
 *
 * The agent is dispatched with a session id and nothing else, because
 * everything else is either private or too long to put in a JWT the player
 * holds. This is where it trades that id for the real configuration.
 *
 * **This route returns a Kwami's secret**, and it is the only one that does so
 * outside a verified win. That is not an oversight: the brain needs the phrase
 * in order to steer around it — `respond()` has always been given it, and
 * `redactSecret` checks every reply against it — and the worker is running the
 * brain. What makes it safe is that this is server-to-server and nothing else:
 * a shared key in a header, never a user's JWT, because the challenger is
 * authenticated on every other session route and must never be able to reach
 * this one by replaying their own credentials.
 *
 * An unset key is a 503 naming the variable, matching how every other
 * unconfigured integration in this codebase refuses. It fails closed: without a
 * key there is no header a caller could send that would be accepted.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()

  const expected = useRuntimeConfig().agentApiKey as string
  if (!expected) {
    throw createError({
      statusCode: 503,
      statusMessage: 'The voice agent callback is not configured. Set NUXT_AGENT_API_KEY.',
    })
  }
  if (getHeader(event, 'x-kwami-agent-key') !== expected) {
    throw createError({ statusCode: 401, statusMessage: 'Bad agent key.' })
  }

  const id = getRouterParam(event, 'id')!
  const db = serviceClient()

  const { data: session } = await db
    .from('game_sessions')
    .select('id, kwami_id, outcome, expires_at')
    .eq('id', id)
    .maybeSingle()

  if (!session) throw createError({ statusCode: 404, statusMessage: 'No such session.' })
  // An expired or decided session has nothing left to say, and handing out a
  // secret for one would be handing it out for free after the clock ran.
  if (session.outcome !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'This session is over.' })
  }

  const { data: kwami } = await db
    .from('kwamis')
    .select('name, persona, voice')
    .eq('id', session.kwami_id)
    .single()

  const voice = readVoiceConfig(kwami?.voice as Record<string, unknown> | null)
  const { secret } = await loadSecret(session.kwami_id)

  return {
    name: kwami?.name ?? '',
    persona: kwami?.persona ?? '',
    secret,
    voiceId: voice.voiceId,
    gameId: voice.gameId,
    language: voice.language,
    guardStrength: voice.guardStrength,
    traits: voice.traits,
    secondsLeft: Math.max(0, (new Date(session.expires_at).getTime() - Date.now()) / 1000),
  }
})
