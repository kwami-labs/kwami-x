import { z } from 'zod'
import { requireUser } from '~~/server/utils/supabase'
import { isDemoMode } from '~~/server/utils/demo'
import { spendTrialEnergy } from '~~/server/utils/energy'
import { affordableVoiceSeconds } from '#shared/energy/cost'
import { FREE_TRIAL_MICRO, VOICE_TICK_SECONDS } from '#shared/energy/constants'

const Body = z.object({
  /** Seconds of connection since the last successful tick. */
  seconds: z.number().min(0).max(3600),
})

/**
 * Bill a studio rehearsal for the voice time it has run up.
 *
 * The client names the number here, which the session tick deliberately does
 * not allow. The difference is who pays: a creator rehearsing their own draft
 * spends their own allowance, so the worst an over-reporting client achieves is
 * spending its owner's money faster. In a session the payer is somebody else,
 * and that is why `charge_session_voice` reads the clock instead.
 *
 * ponytail: client-reported seconds, bounded by the tick interval and by the
 * affordability-capped token TTL. If this balance ever pays for anything but
 * the payer's own rehearsal, replace it with a server-side room record the way
 * `game_sessions.voice_charged_ms` does it.
 *
 * Fails closed with a 402, unlike the session path. There is nobody else's paid
 * time at stake — the same reasoning the program builder fails closed on — and
 * `TestDrive` already turns a 402 into its "Out of energy / Add fuel" notice.
 */
export default defineEventHandler(async (event) => {
  const body = Body.parse(await readBody(event))

  if (isDemoMode()) {
    return { balance: FREE_TRIAL_MICRO.toString(), secondsLeft: affordableVoiceSeconds(FREE_TRIAL_MICRO) }
  }

  const user = await requireUser(event)

  // A tick can only ever claim one interval's worth. A client that stopped
  // sending them and came back with a large number is charged for one tick and
  // bounded thereafter by its token, which was minted for what it could afford.
  const seconds = Math.min(body.seconds, VOICE_TICK_SECONDS)

  const spend = await spendTrialEnergy(user.id, { kind: 'voice', seconds }, 'voice', { studio: true })
  if (!spend.ok) {
    throw createError({
      statusCode: 402,
      statusMessage:
        'Your free trial energy is spent. Mint this Kwami with fuel and you can keep talking to it.',
    })
  }

  return {
    balance: spend.balance.toString(),
    secondsLeft: affordableVoiceSeconds(spend.balance),
  }
})
