import { isDemoMode } from '~~/server/utils/demo'
import { requireUser } from '~~/server/utils/supabase'
import { createLiveKitToken, isLiveKitConfigured, livekitAgentName } from '~~/server/utils/livekit'
import { grantTrial } from '~~/server/utils/energy'
import { affordableVoiceSeconds } from '#shared/energy/cost'

/**
 * A voice room for a Kwami that does not exist yet.
 *
 * The studio's whole argument is that nobody should mint a character they have
 * never heard speak, and until now "heard" meant the browser's speech
 * synthesis reading back a reply that arrived over HTTP. This is the same
 * rehearsal over a real streaming connection, paid for out of the same trial
 * allowance `/api/studio/preview` already spends.
 *
 * Unlike the session room, the draft's configuration travels to the worker over
 * the room's data channel rather than a server callback — there is no row to
 * call back about, the draft lives in the browser. That includes the phrase,
 * which is safe here and nowhere else: the only participant is the creator, who
 * typed it.
 *
 * Reports `transport: 'browser'` rather than failing whenever the upgrade is
 * unavailable — unconfigured, in demo mode, or out of trial — so the studio
 * falls back to the path that has always worked instead of the mic going dead.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()

  // A fresh clone with no Supabase has no account to hold an allowance, and the
  // scripted brain it falls back to costs nothing to run.
  if (isDemoMode()) return { transport: 'browser' as const, reason: 'demo' as const }
  if (!isLiveKitConfigured()) return { transport: 'browser' as const, reason: 'unconfigured' as const }

  const user = await requireUser(event)

  // Granted on first use, exactly as `studio/energy.get.ts` does it — an
  // account that never opens the studio never has a balance to account for.
  const affordable = affordableVoiceSeconds(await grantTrial(user.id))
  if (affordable <= 0) return { transport: 'browser' as const, reason: 'exhausted' as const }

  // One rehearsal at a time per account. A creator opening the studio in a
  // second tab lands in the same room rather than paying for two workers.
  const room = `studio-${user.id}`

  return {
    transport: 'livekit' as const,
    url: config.public.livekitUrl as string,
    room,
    secondsLeft: affordable,
    token: createLiveKitToken({
      room,
      identity: `creator-${user.id}`,
      // The credential expires when the allowance would have. Nothing watches
      // this room second by second, so refusing to issue a longer token is the
      // only place the prepaid limit can actually be enforced.
      ttlSeconds: affordable + 30,
      agentName: livekitAgentName(),
      agentMetadata: `studio:${user.id}`,
    }),
  }
})
